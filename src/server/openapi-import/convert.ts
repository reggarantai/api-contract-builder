import type { ApiIssue } from "../../shared/api-error";
import {
  compareEndpoints,
  type EndpointExample,
  type EndpointFields,
  type EndpointSecurity,
  suggestOperationId,
} from "../../shared/endpoints";
import type { JsonSchema } from "../../shared/json-schema";
import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
} from "../project-file/format";
import {
  Context,
  isObject,
  own,
  type Raw,
  type Segments,
  type SourceText,
  Stop,
  shortened,
  shown,
  shownValue,
  type Version,
} from "./context";
import { reconstructErrorTypes } from "./error-types";
import { textOf } from "./exports";
import { counted, listed } from "./notices";
import { readEndpoints } from "./operations";
import { buildPages } from "./pages";
import { jsonPointer } from "./pointer";
import { readProject, readSecurity } from "./project";
import { OPENAPI_LIMITS } from "./read";
import { References } from "./references";
import { isSameDialect, Models, Schemas } from "./schemas";

// An OpenAPI 3.0, 3.1, or 3.2 document as a project file document, which
// the project file import then checks and writes. Whatever a project can't
// hold is reported as a notice with its place; the converter repairs or
// leaves out the smallest part that breaks a rule, so the rules never
// refuse what it makes. What it can't read at all is refused.

export type ConvertResult =
  | {
      document: Record<string, unknown>;
      notices: ApiIssue[];
      /** The JSON Pointer of the part a path of the document (models.2.schema) came from. */
      sourceOf: (path: string) => string;
    }
  | { error: string; issues: ApiIssue[] };

/** The kinds of components the app reads, when operations refer to them. */
const READ_COMPONENTS = new Set([
  "responses",
  "parameters",
  "examples",
  "requestBodies",
  "headers",
  "pathItems",
  "mediaTypes",
]);

/** The app's own extensions, which come back as what they were. */
const APP_EXTENSIONS = new Set([
  "x-status",
  "x-notes-fe",
  "x-notes-be",
  "x-pages",
]);

function versionOf(doc: Raw): { version: Version } | { error: string } {
  const swagger = own(doc, "swagger");
  if (swagger !== undefined) {
    const version =
      typeof swagger === "string" || typeof swagger === "number"
        ? ` ${shownValue(swagger, 20)}`
        : "";
    return {
      error: `This is a Swagger${version} document. Convert it to OpenAPI 3 first (for example with swagger2openapi), then import that.`,
    };
  }
  if (own(doc, "format") === PROJECT_FILE_FORMAT) {
    return {
      error:
        "This is a project.json, from inside a project file. Import the whole .project.zip instead.",
    };
  }
  const openapi = own(doc, "openapi");
  if (openapi === undefined) {
    return {
      error:
        "This isn't an OpenAPI document: it has no openapi field. Choose an OpenAPI 3.0, 3.1, or 3.2 document, or a project file (.project.zip).",
    };
  }
  if (typeof openapi !== "string") {
    return {
      error: `openapi must be the version as text, like "3.1.0"; this document has ${shown(JSON.stringify(openapi), 20)}`,
    };
  }
  const match = /^3\.([0-2])\.\d+$/.exec(openapi);
  if (!match) {
    return {
      error: `This is an OpenAPI ${shown(openapi, 20)} document; the app reads OpenAPI 3.0, 3.1, and 3.2`,
    };
  }
  return { version: `3.${match[1]}` as Version };
}

class Converter {
  readonly ctx: Context;
  readonly refs: References;
  readonly schemas: Schemas;
  readonly models = new Models();
  /** Security schemes the project keeps, by key. */
  readonly schemeIds = new Map<string, string>();
  /** Component parts used through a reference, by kind, to report the unused ones. */
  private readonly usedParts = new Map<string, Set<string>>();

  /** Notes that `components.<kind>.<name>` is used. */
  markUsed(kind: string, name: string) {
    let names = this.usedParts.get(kind);
    if (!names) {
      names = new Set();
      this.usedParts.set(kind, names);
    }
    names.add(name);
  }

  isUsed(kind: string, name: string) {
    return this.usedParts.get(kind)?.has(name) ?? false;
  }
  /**
   * Where each example of a body came from: `catalog` names the component
   * example it refers to under that same name, as this app's export writes
   * an error type's example.
   */
  /** Examples whose description the app has no place for, until it's known whether they stay examples. */
  readonly describedExamples = new WeakMap<
    EndpointExample,
    { at: Segments; shown: string }
  >();

  /**
   * Notes the descriptions of examples that stay examples: one that became
   * an error type's (from components.examples) keeps it there.
   */
  noteExampleDescriptions(endpoints: (EndpointFields & { id: string })[]) {
    for (const endpoint of endpoints) {
      const bodies = [
        endpoint.requestBody?.examples ?? [],
        ...endpoint.responses.flatMap((response) => [
          response.body?.examples ?? [],
          ...response.errors.map((usage) => usage.examples),
        ]),
      ];
      for (const example of bodies.flat()) {
        const described = this.describedExamples.get(example);
        if (!described) continue;
        this.note(
          "example-descriptions",
          described.at,
          (count, examples) =>
            `Examples have no description in the app, so ${counted(count, "description wasn't", "descriptions weren't")} kept: ${examples}`,
          described.shown,
        );
      }
    }
  }

  /** The operation object each endpoint came from, by endpoint ID. */
  readonly operationSources = new Map<string, Raw>();
  /** Where each endpoint's operation is in the document, by endpoint ID. */
  readonly operationAt = new Map<string, string[]>();
  readonly exampleSources = new WeakMap<
    EndpointExample,
    { key: string; catalog: string | undefined }
  >();

  constructor(doc: Raw, version: Version, sourceText: SourceText | undefined) {
    this.ctx = new Context(doc, version, sourceText);
    this.refs = new References(this.ctx);
    this.schemas = new Schemas(this.ctx, this.refs, this.models);
  }

  note(
    kind: string,
    at: Segments,
    render: (count: number, examples: string) => string,
    example?: string,
    options?: { distinct?: boolean },
  ) {
    this.ctx.note(kind, at, render, example, options);
  }

  /**
   * Reports the fields of `value` the reader didn't take. Each field read
   * counts against the value limit, since a part a reference brings in is
   * read again for each reference.
   */
  rest(value: Raw, at: Segments, known: readonly string[], what: string) {
    const keys = Object.keys(value);
    this.ctx.count(keys.length);
    for (const key of keys) {
      if (known.includes(key)) continue;
      // One notice for all extensions, and one for each kind of part,
      // with a few of the names: a document may have a million of them.
      if (key.startsWith("x-")) {
        if (APP_EXTENSIONS.has(key)) continue;
        this.note(
          "extensions",
          [...at, key],
          (count, examples) =>
            `Extensions aren't kept (${counted(count, "place")}: ${examples})`,
          shown(key, 60),
          { distinct: true },
        );
      } else {
        this.note(
          `fields ${what}`,
          [...at, key],
          (count, examples) =>
            `Fields the app doesn't keep from ${what} were left out (${counted(count, "place")}: ${examples})`,
          shown(key, 60),
          { distinct: true },
        );
      }
    }
  }

  /** A text field, trimmed, shortened to `max` with a notice. */
  text(value: Raw, key: string, at: Segments, max: number, what: string) {
    const raw = this.ctx.text(value, key, at);
    if (raw === undefined) return "";
    const trimmed = raw.trim();
    if (trimmed.length <= max) return trimmed;
    this.note(
      "shortened",
      [...at, key],
      (count, examples) =>
        `${counted(count, "text")} ${count === 1 ? "was" : "were"} longer than the app keeps, so ${count === 1 ? "it was" : "they were"} shortened: ${examples}`,
      `${what} (${max.toLocaleString("en-US")} characters)`,
    );
    return shortened(trimmed, max);
  }

  /** Follows a Reference Object, noting the component it uses. */
  follow(value: unknown, at: Segments, what?: "a path item") {
    const followed = this.refs.follow(value, at, what);
    if (
      followed &&
      followed.at !== at &&
      followed.at[0] === "components" &&
      followed.at.length >= 3
    ) {
      this.markUsed(followed.at[1] as string, followed.at[2] as string);
    }
    return followed;
  }

  // --- Models -----------------------------------------------------------------

  registerModels() {
    const components = own(this.ctx.doc, "components");
    if (components !== undefined && !isObject(components)) {
      this.ctx.refuse(["components"], "Expected an object");
      return;
    }
    const schemas = isObject(components)
      ? own(components, "schemas")
      : undefined;
    if (schemas === undefined) return;
    if (!isObject(schemas)) {
      this.ctx.refuse(
        ["components", "schemas"],
        "Expected an object of schemas",
      );
      return;
    }
    const renamed: string[] = [];
    for (const name of Object.keys(schemas)) {
      const entry = this.models.addComponent(name, schemas[name]);
      if (entry.name !== name) {
        renamed.push(`${shown(name, 40)} → ${entry.name}`);
      }
    }
    if (renamed.length > 0) {
      this.note(
        "renamed-models",
        ["components", "schemas"],
        () =>
          `${counted(renamed.length, "model was", "models were")} renamed to names the app takes (letters, numbers, dots, hyphens, and underscores, 64 at most, unique ignoring case); references follow: ${listed(renamed.slice(0, 3), renamed.length)}`,
      );
    }
  }

  modelsDocument() {
    const out: {
      id: string;
      name: string;
      description: string;
      schema: JsonSchema;
    }[] = [];
    for (const entry of [...this.models.entries]) {
      if (entry.original === "") continue;
      const schema = this.schemas.modelSchema(entry);
      let description = "";
      const own_ = schema.description;
      if (typeof own_ === "string") {
        const trimmed = own_.trim();
        if (trimmed.length > 0 && trimmed.length <= 2000) {
          description = trimmed;
          delete schema.description;
        }
      }
      out.push({ id: entry.id, name: entry.name, description, schema });
    }
    for (const { entry, schema } of this.schemas.drain()) {
      out.push({ id: entry.id, name: entry.name, description: "", schema });
    }
    return out;
  }

  defaultSecurity: EndpointSecurity = { type: "default" };

  // --- Unused components ----------------------------------------------------------

  unusedComponents() {
    const components = own(this.ctx.doc, "components");
    if (!isObject(components)) return;
    for (const kind of Object.keys(components)) {
      if (
        kind === "schemas" ||
        kind === "securitySchemes" ||
        kind.startsWith("x-") ||
        !READ_COMPONENTS.has(kind)
      )
        continue;
      const group = components[kind];
      if (!isObject(group)) continue;
      for (const name of Object.keys(group)) {
        if (this.isUsed(kind, name)) continue;
        this.note(
          `unused ${kind}`,
          ["components", kind, name],
          (count, examples) =>
            `${counted(count, `part of components.${kind}`, `parts of components.${kind}`)} that no operation uses ${count === 1 ? "isn't" : "aren't"} imported: ${examples}`,
          shown(name, 40),
        );
      }
    }
    // What the app has no place for at all, used or not.
    for (const kind of ["callbacks", "links"]) {
      const group = own(components, kind);
      if (!isObject(group)) continue;
      const names = Object.keys(group);
      if (names.length === 0) continue;
      this.note(
        `components ${kind}`,
        ["components", kind],
        () =>
          `${kind === "callbacks" ? "Callbacks" : "Links"} aren't kept, so components.${kind} isn't imported: ${listed(
            names.slice(0, 3).map((name) => shown(name, 40)),
            names.length,
          )}`,
      );
    }
  }
}

/**
 * Empties the operation IDs the export would derive the same way, so they
 * follow later path changes as IDs of endpoints made in the app do. The
 * export keeps explicit IDs, then gives each other endpoint, in path order,
 * the first of base, base2, base3, … that isn't taken. In that order: an
 * ID that looks derived is emptied when deriving gives it back, and kept
 * (taken from then on) when deriving gives another. An endpoint without an
 * ID gets one no endpoint has; an ID it passes over on the way, of an
 * endpoint after it, is kept, since emptied it would be free for this one.
 * That's what emptying them all and keeping the first that comes out
 * differently, again and again, ends with, in one pass: each base
 * remembers how far its candidates are taken.
 */
function clearDerivedOperationIds(
  endpoints: (EndpointFields & { id: string })[],
) {
  type Endpoint = EndpointFields & { id: string };
  const sorted = [...endpoints].sort(compareEndpoints);
  const position = new Map(sorted.map((endpoint, index) => [endpoint, index]));
  const bases = new Map(
    sorted.map((endpoint) => [
      endpoint,
      suggestOperationId(endpoint.method, endpoint.path),
    ]),
  );
  const looksDerived = (endpoint: Endpoint) => {
    const base = bases.get(endpoint) as string;
    const id = endpoint.operationId;
    return (
      id !== "" &&
      id.startsWith(base) &&
      /^(?:|[2-9]|[1-9][0-9]+)$/.test(id.slice(base.length))
    );
  };
  const owners = new Map<string, Endpoint>();
  /** IDs the export won't give: explicit ones, and those given so far. */
  const used = new Set<string>();
  for (const endpoint of endpoints) {
    if (endpoint.operationId === "") continue;
    owners.set(endpoint.operationId, endpoint);
    if (!looksDerived(endpoint)) used.add(endpoint.operationId);
  }
  const kept = new Set<Endpoint>();
  const derived = new Set<Endpoint>();
  /** Per base, the first candidate not known to be used… */
  const next = new Map<string, number>();
  /** …and, for endpoints without an ID, not used nor any endpoint's. */
  const nextFree = new Map<string, number>();
  const candidate = (base: string, n: number) =>
    n === 1 ? base : `${base}${n}`;

  for (const endpoint of sorted) {
    const base = bases.get(endpoint) as string;
    if (endpoint.operationId === "") {
      const here = position.get(endpoint) as number;
      let n = nextFree.get(base) ?? 1;
      for (; ; n++) {
        const id = candidate(base, n);
        const owner = owners.get(id);
        if (!owner && !used.has(id)) {
          used.add(id);
          break;
        }
        if (
          owner &&
          (position.get(owner) as number) > here &&
          looksDerived(owner) &&
          !kept.has(owner)
        ) {
          kept.add(owner);
          used.add(id);
        }
      }
      nextFree.set(base, n + 1);
      continue;
    }
    if (!looksDerived(endpoint) || kept.has(endpoint)) continue;
    let n = next.get(base) ?? 1;
    while (used.has(candidate(base, n))) n++;
    if (candidate(base, n) === endpoint.operationId) {
      derived.add(endpoint);
      n++;
    } else {
      kept.add(endpoint);
    }
    used.add(endpoint.operationId);
    next.set(base, n);
  }
  for (const endpoint of endpoints) {
    if (derived.has(endpoint)) endpoint.operationId = "";
  }
}

/**
 * The project file document of an OpenAPI document, with notices of what it
 * changed, or why it can't be imported.
 */
export function convertOpenApi(
  value: unknown,
  { sourceText }: { sourceText?: SourceText },
): ConvertResult {
  if (!isObject(value)) {
    return {
      error:
        "This file isn't a project file (.project.zip) or an OpenAPI document (JSON or YAML). Choose one of those to import.",
      issues: [],
    };
  }
  const detected = versionOf(value);
  if ("error" in detected) {
    return { error: detected.error, issues: [] };
  }
  let ctx: Context | undefined;
  try {
    const converter = new Converter(value, detected.version, sourceText);
    ctx = converter.ctx;
    converter.registerModels();
    const project = readProject(converter);
    const topSecurity = readSecurity(converter, own(value, "security"), [
      "security",
    ]);
    if (topSecurity?.type === "schemes" && topSecurity.schemeIds.length === 1) {
      project.defaultSecuritySchemeId = topSecurity.schemeIds[0] ?? null;
    } else if (topSecurity) {
      // Several alternatives, or none: every operation without its own says so.
      converter.defaultSecurity = topSecurity;
    }
    const models = converter.modelsDocument();
    const endpoints = readEndpoints(converter);
    clearDerivedOperationIds(endpoints);
    // Pointers promoted while converting endpoints.
    for (const { entry, schema } of converter.schemas.drain()) {
      models.push({ id: entry.id, name: entry.name, description: "", schema });
    }
    // Measured while each response still has its own body and headers:
    // an error type holds them once, but the exports write them into every
    // response that uses it, so this is what they'd write. Measured before
    // error types are made, whose comparisons cost that much again.
    if (
      textOf({ project, models, endpoints }, OPENAPI_LIMITS.maxText) >
      OPENAPI_LIMITS.maxText
    ) {
      return tooMuchText();
    }
    const errorTypes = reconstructErrorTypes(converter, endpoints);
    converter.noteExampleDescriptions(endpoints);
    const pages = buildPages(converter, endpoints);
    for (const key of ["webhooks", "externalDocs", "jsonSchemaDialect"]) {
      const part = own(value, key);
      if (part === undefined) continue;
      if (
        key === "jsonSchemaDialect" &&
        typeof part === "string" &&
        isSameDialect(part)
      )
        continue;
      const names = Object.keys(isObject(part) ? part : {});
      converter.note(`top-${key}`, [key], () =>
        key === "webhooks"
          ? `Webhooks aren't kept: ${listed(
              names.slice(0, 3).map((name) => shown(name, 40)),
              names.length,
            )}`
          : key === "externalDocs"
            ? "The document's external docs aren't kept"
            : `The document's schemas are read as JSON Schema 2020-12, not its jsonSchemaDialect ${shownValue(part, 80)}`,
      );
    }
    converter.unusedComponents();
    converter.rest(
      value,
      [],
      [
        "openapi",
        "info",
        "jsonSchemaDialect",
        "servers",
        "paths",
        "webhooks",
        "components",
        "security",
        "tags",
        "externalDocs",
        "$self",
      ],
      "the document",
    );
    const components = own(value, "components");
    if (isObject(components)) {
      converter.rest(
        components,
        ["components"],
        [
          "schemas",
          "responses",
          "parameters",
          "examples",
          "requestBodies",
          "headers",
          "securitySchemes",
          "links",
          "callbacks",
          "pathItems",
          "mediaTypes",
        ],
        "components",
      );
    }
    if (!ctx.problems.empty) {
      return refusalOf(ctx.issues, ctx.problems.more);
    }
    const document = {
      format: PROJECT_FILE_FORMAT,
      formatVersion: PROJECT_FILE_VERSION,
      project,
      models,
      errorTypes,
      endpoints,
      pages,
    };
    if (textOf(document, OPENAPI_LIMITS.maxText) > OPENAPI_LIMITS.maxText) {
      return tooMuchText();
    }
    return {
      document,
      notices: ctx.notices.list(),
      sourceOf: (path) => {
        const [kind, index] = path.split(".");
        const at = Number(index);
        if (kind === "models") {
          const entry = converter.models.entries.find(
            (item) => item.id === models[at]?.id,
          );
          return entry ? jsonPointer(entry.segments) : "/components/schemas";
        }
        if (kind === "endpoints") {
          const id = endpoints[at]?.id;
          return jsonPointer(
            (id && converter.operationAt.get(id)) || ["paths"],
          );
        }
        if (kind === "errorTypes") {
          return jsonPointer([
            "components",
            "examples",
            errorTypes[at]?.name ?? "",
          ]);
        }
        if (kind === "pages") return "/tags";
        if (kind === "project") return "/info";
        return "";
      },
    };
  } catch (error) {
    if (error instanceof Stop) {
      const issues = ctx?.issues ?? [];
      if (error.message === "") {
        return refusalOf(issues, true);
      }
      return { error: error.message, issues };
    }
    // A mistake in the app, not in the document: the import is refused,
    // with what to report, rather than failing.
    console.error("Converting an OpenAPI document failed:", error);
    return {
      error: `The app couldn't convert this document${
        error instanceof RangeError && /call stack/i.test(error.message)
          ? ", which nests deeper than it can follow"
          : ""
      }. This is a problem in the app: please report it, with the document if you can share it.`,
      issues: [],
    };
  }
}

function tooMuchText(): ConvertResult {
  return {
    error: `This document makes a project of more than ${Math.round(OPENAPI_LIMITS.maxText / 1024 / 1024)} MB of text once its references are copied in, more than a document may have: each part a reference points at (a response, a parameter, a header, an example, a schema that isn't a model) is copied into every place that uses it, as the exports write it. Refer to schemas as models (components.schemas), which aren't copied, and to large parts from fewer places.`,
    issues: [],
  };
}

function refusalOf(issues: ApiIssue[], more: boolean): ConvertResult {
  const external = issues.some((issue) =>
    /another file or URL/.test(issue.message),
  );
  const count = more
    ? `more than ${issues.length} problems (the first ${issues.length} are listed)`
    : counted(issues.length, "problem");
  return {
    error: external
      ? `This OpenAPI document refers to other files, which the app never reads. Bundle it into one file first (for example with npx @redocly/cli bundle), then import that. It has ${count}.`
      : `This OpenAPI document can't be imported: it has ${count}.`,
    issues,
  };
}

export type { Converter };
