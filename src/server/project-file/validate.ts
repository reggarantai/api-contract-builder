import { z } from "zod";
import type { ApiIssue } from "../../shared/api-error";
import {
  type EndpointFields,
  endpointFieldsSchema,
  endpointLabel,
  endpointSchema,
  examplesOfEndpoint,
  pathMatchKey,
  repairEndpointFields,
  schemasOfEndpoint,
} from "../../shared/endpoints";
import {
  checkResponseErrors,
  errorTypeFieldsSchema,
  schemasOfErrorType,
} from "../../shared/error-types";
import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  modelRefIssues,
  nestingIssues,
} from "../../shared/json-schema";
import { modelFieldsSchema } from "../../shared/models";
import { checkPageStates } from "../../shared/page-states";
import { pageFieldsSchema, updateMockupInputSchema } from "../../shared/pages";
import { projectSettingsSchema } from "../../shared/projects";
import {
  MAX_ZIP_ENTRIES,
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  type ProjectFile,
  type ProjectFileMockup,
  UPGRADES,
  type Upgrade,
  upgradeDocument,
} from "./format";

// A project file must pass the rules the API applies when the same things
// are saved through it, checked on the whole document before anything is
// written: first each part's fields (the shared Zod rules, after the repairs
// reading stored data makes), then what the routes check against the
// database (unique names, references), here against the document. Only the
// first problems are listed, and checking stops once it has them, so a
// small file can't make it do unbounded work.

const MAX_LISTED_ISSUES = 50;

/** The first problems found, and whether there are more. */
export class IssueList {
  readonly list: ApiIssue[] = [];
  more = false;

  add(path: string, message: string) {
    if (this.list.length < MAX_LISTED_ISSUES) {
      this.list.push({ path, message });
    } else {
      this.more = true;
    }
  }

  /** Whether checking can stop: every problem it can list is there. */
  get full() {
    return this.more;
  }

  get empty() {
    return this.list.length === 0;
  }
}

/** Keys only tie the file's parts together; any short string will do. */
const keySchema = z.string().min(1).max(64);

const envelopeSchema = z.object({
  /** Lets editors validate the file; nothing reads it here. */
  $schema: z.string().max(2000).optional(),
  format: z.literal(PROJECT_FILE_FORMAT),
  formatVersion: z.number().int(),
  generator: z.string().max(200).optional(),
  project: z.custom<Record<string, unknown>>(
    isJsonObject,
    "Expected an object",
  ),
  // Their items are checked one at a time, below.
  models: z.array(z.unknown()),
  errorTypes: z.array(z.unknown()),
  endpoints: z.array(z.unknown()),
  pages: z.array(z.unknown()),
});
const ENVELOPE_FIELDS = new Set(Object.keys(envelopeSchema.shape));

/** A relative path inside the zip, like `mockups/login.png`. */
const filePathSchema = z
  .string()
  .max(255)
  .refine((file) => {
    const parts = file.split("/");
    return (
      file !== "" &&
      // biome-ignore lint/suspicious/noControlCharactersInRegex: they're what's refused.
      !/[\u0000-\u001f\u007f\\]/.test(file) &&
      !/^[A-Za-z]:/.test(file) &&
      parts.every((part) => part !== "" && part !== "." && part !== "..")
    );
  }, "Use a path inside the zip, from project.json's folder, like mockups/login.png")
  .transform((file) => file.normalize("NFC"));

const mockupSchema = z.object({
  id: keySchema,
  file: filePathSchema,
  // As an upload keeps it: the browser's file name, at most 255 characters.
  originalName: z.string().max(255),
  caption: updateMockupInputSchema.shape.caption,
});

function join(...parts: (string | number)[]) {
  return parts.filter((part) => part !== "").join(".");
}

function shown(value: string, length = 60) {
  return value.length > length ? `${value.slice(0, length - 3)}…` : value;
}

function nameOr(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() !== ""
    ? shown(value.trim())
    : fallback;
}

/**
 * Fields of `input` the schema's output doesn't have: the shared schemas,
 * like the API, drop fields they don't know, which a file must not do
 * silently. User JSON (schemas, example values) comes back as the same
 * object, so it's left alone. Stops once `report` says to.
 */
function strayFields(
  input: unknown,
  output: unknown,
  path: string,
  report: (path: string) => boolean,
): boolean {
  if (
    input === output ||
    typeof input !== "object" ||
    input === null ||
    typeof output !== "object" ||
    output === null
  ) {
    return true;
  }
  if (Array.isArray(input)) {
    if (Array.isArray(output)) {
      for (const [index, item] of input.entries()) {
        if (!strayFields(item, output[index], join(path, index), report)) {
          return false;
        }
      }
    }
    return true;
  }
  for (const key in input) {
    if (!Object.hasOwn(input, key)) {
      continue;
    }
    const value = (input as Record<string, unknown>)[key];
    const keyPath = join(path, shown(key, 40));
    const more = Object.hasOwn(output, key)
      ? strayFields(
          value,
          (output as Record<string, unknown>)[key],
          keyPath,
          report,
        )
      : report(keyPath);
    if (!more) {
      return false;
    }
  }
  return true;
}

/** Major, minor, and patch of "1.2.3" or "API Contract Builder 1.2.3", or null. */
function versionOf(text: string | undefined) {
  const match = text && /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

function isNewer(generator: string | undefined, appVersion: string) {
  const made = versionOf(generator);
  const running = versionOf(appVersion);
  if (!made || !running || !generator?.startsWith("API Contract Builder")) {
    return false;
  }
  for (let index = 0; index < 3; index++) {
    const difference = (made[index] ?? 0) - (running[index] ?? 0);
    if (difference !== 0) {
      return difference > 0;
    }
  }
  return false;
}

/**
 * Why a file can't be imported: how many problems it has, the first ones,
 * and whether a newer version of the app made it.
 */
export function describeProblems(
  issues: IssueList,
  { generator, appVersion }: { generator?: string; appVersion: string },
) {
  const count = issues.more
    ? `more than ${MAX_LISTED_ISSUES} problems (the first ${MAX_LISTED_ISSUES} are listed)`
    : `${issues.list.length} problem${issues.list.length === 1 ? "" : "s"}`;
  const shownGenerator =
    generator === undefined ? undefined : shown(generator, 100);
  const newer = isNewer(shownGenerator, appVersion)
    ? ` It was made by ${shownGenerator}, newer than this one (${appVersion}): updating the app may help.`
    : "";
  return {
    error: `This project file can't be imported: it has ${count}.${newer}`,
    issues: issues.list,
  };
}

export type ProjectFileCheck =
  | { document: ProjectFile }
  | { error: string; issues: ApiIssue[] };

/**
 * The project file, with text trimmed as the API trims it, or why it can't
 * be imported. `raw` is project.json as parsed. Issues name places in the
 * file as upgraded to the current format; for files of that format, the
 * file itself.
 */
export function validateProjectFile(
  raw: unknown,
  {
    appVersion,
    format = { current: PROJECT_FILE_VERSION, upgrades: UPGRADES },
  }: {
    appVersion: string;
    /** The format to read into; tests pretend to be later versions. */
    format?: { current: number; upgrades: Readonly<Record<number, Upgrade>> };
  },
): ProjectFileCheck {
  if (!isJsonObject(raw) || raw.format !== PROJECT_FILE_FORMAT) {
    return {
      error: `This isn't an API Contract Builder project file: its project.json doesn't say "format": "${PROJECT_FILE_FORMAT}"`,
      issues: [],
    };
  }
  const version = raw.formatVersion;
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version < 1
  ) {
    return {
      error:
        "This project file's formatVersion must be a whole number, 1 or more",
      issues: [],
    };
  }
  const generator =
    typeof raw.generator === "string" ? shown(raw.generator, 100) : undefined;
  if (version > format.current) {
    return {
      error: `This project file is from a newer version of API Contract Builder (format ${version}${generator ? `, made by ${generator}` : ""}). This version reads format ${format.current} and older: update the app to import it.`,
      issues: [],
    };
  }

  // Upgrades read files from outside too: one that trips over an odd file
  // refuses it instead of failing the request.
  let document: Record<string, unknown>;
  try {
    document = upgradeDocument(raw, version, format);
  } catch (error) {
    return {
      error: `This project file of format ${version} couldn't be upgraded to format ${format.current}: ${shown(error instanceof Error ? error.message : String(error), 200)}`,
      issues: [],
    };
  }

  const issues = new IssueList();
  const failed = () => describeProblems(issues, { generator, appVersion });

  const envelope = envelopeSchema.safeParse(document);
  if (!envelope.success) {
    for (const issue of envelope.error.issues) {
      issues.add(issue.path.join("."), issue.message);
    }
  }
  for (const key of Object.keys(document)) {
    if (!ENVELOPE_FIELDS.has(key)) {
      issues.add(shown(key, 40), "Not a field of project files");
    }
  }
  if (!envelope.success || !issues.empty) {
    return failed();
  }

  // --- Each part's fields -------------------------------------------------------

  /** Parses `fields` with `schema`, reporting issues and stray fields at `prefix`. */
  function parse<T extends z.ZodType>(
    schema: T,
    fields: unknown,
    prefix: string,
    owner: string,
  ): z.output<T> | undefined {
    const result = schema.safeParse(fields);
    if (!result.success) {
      for (const issue of result.error.issues) {
        issues.add(
          join(prefix, issue.path.join(".")),
          `${owner}: ${issue.message}`,
        );
        if (issues.full) {
          break;
        }
      }
      return undefined;
    }
    strayFields(fields, result.data, prefix, (path) => {
      issues.add(path, `${owner}: Not a field of project files`);
      return !issues.full;
    });
    return result.data;
  }

  const kinds = {
    model: new Set<string>(),
    "error type": new Set<string>(),
    endpoint: new Set<string>(),
    page: new Set<string>(),
    mockup: new Set<string>(),
  };
  function claimKey(
    kind: keyof typeof kinds,
    id: unknown,
    path: string,
    owner: string,
  ) {
    const key = keySchema.safeParse(id);
    if (!key.success) {
      issues.add(
        path,
        `${owner}: ${key.error.issues[0]?.message ?? "Invalid ID"}`,
      );
      return undefined;
    }
    if (kinds[kind].has(key.data)) {
      issues.add(path, `${owner}: Another ${kind} has this ID`);
    }
    kinds[kind].add(key.data);
    return key.data;
  }

  /** The parts of one kind that are objects, until there are enough problems. */
  function* objectsOf(
    items: unknown[],
    prefix: string,
    owner: (item: Record<string, unknown>, index: number) => string,
    kind: string,
  ) {
    for (const [index, item] of items.entries()) {
      if (issues.full) {
        return;
      }
      if (!isJsonObject(item)) {
        issues.add(
          `${prefix}.${index}`,
          `${kind} #${index + 1}: Expected an object`,
        );
        continue;
      }
      yield { item, index, owner: owner(item, index) };
    }
  }

  const { data } = envelope;
  const { id: projectId, ...projectFields } = data.project;
  const projectKey = keySchema.safeParse(projectId);
  if (!projectKey.success) {
    issues.add(
      "project.id",
      `Project settings: ${projectKey.error.issues[0]?.message ?? "Invalid ID"}`,
    );
  }
  const settings = parse(
    projectSettingsSchema,
    projectFields,
    "project",
    "Project settings",
  );

  const models: ProjectFile["models"] = [];
  for (const { item, index, owner } of objectsOf(
    data.models,
    "models",
    (model, at) => `Model ${nameOr(model.name, `#${at + 1}`)}`,
    "Model",
  )) {
    const { id, ...fields } = item;
    const key = claimKey("model", id, `models.${index}.id`, owner);
    const parsed = parse(modelFieldsSchema, fields, `models.${index}`, owner);
    if (key !== undefined && parsed !== undefined) {
      models.push({ id: key, ...parsed });
    }
  }

  const errorTypes: ProjectFile["errorTypes"] = [];
  for (const { item, index, owner } of objectsOf(
    data.errorTypes,
    "errorTypes",
    (errorType, at) => `Error type ${nameOr(errorType.name, `#${at + 1}`)}`,
    "Error type",
  )) {
    const { id, ...fields } = item;
    const key = claimKey("error type", id, `errorTypes.${index}.id`, owner);
    const parsed = parse(
      errorTypeFieldsSchema,
      fields,
      `errorTypes.${index}`,
      owner,
    );
    if (key !== undefined && parsed !== undefined) {
      errorTypes.push({ id: key, ...parsed });
    }
  }

  const endpoints: ProjectFile["endpoints"] = [];
  for (const { item, index, owner } of objectsOf(
    data.endpoints,
    "endpoints",
    (endpoint, at) =>
      typeof endpoint.method === "string" && typeof endpoint.path === "string"
        ? `${shown(endpoint.method, 10)} ${shown(endpoint.path)}`
        : `Endpoint #${at + 1}`,
    "Endpoint",
  )) {
    const { id, ...fields } = item;
    const key = claimKey("endpoint", id, `endpoints.${index}.id`, owner);
    // The one list the shared rules don't cap: Zod would report each wrong
    // item of it, so wrong ones are reported once, before Zod reads it.
    const security = fields.security;
    if (
      isJsonObject(security) &&
      Array.isArray(security.schemeIds) &&
      security.schemeIds.some((id) => typeof id !== "string")
    ) {
      issues.add(
        `endpoints.${index}.security.schemeIds`,
        `${owner}: Scheme IDs must be text`,
      );
      continue;
    }
    const parsed = parse(
      endpointFieldsSchema,
      fields,
      `endpoints.${index}`,
      owner,
    );
    if (parsed === undefined) {
      continue;
    }
    // As stored endpoints are read: repaired first, then checked as a whole.
    const whole = endpointSchema.safeParse(repairEndpointFields(parsed));
    if (!whole.success) {
      for (const issue of whole.error.issues) {
        issues.add(
          join(`endpoints.${index}`, issue.path.join(".")),
          `${owner}: ${issue.message}`,
        );
      }
      continue;
    }
    if (key !== undefined) {
      endpoints.push({ id: key, ...whole.data });
    }
  }

  const pages: ProjectFile["pages"] = [];
  for (const { item, index, owner } of objectsOf(
    data.pages,
    "pages",
    (page, at) => `Page ${nameOr(page.name, `#${at + 1}`)}`,
    "Page",
  )) {
    const { id, mockups, ...fields } = item;
    const key = claimKey("page", id, `pages.${index}.id`, owner);
    const parsed = parse(pageFieldsSchema, fields, `pages.${index}`, owner);
    const parsedMockups = parse(
      z.array(mockupSchema).max(MAX_ZIP_ENTRIES),
      mockups,
      `pages.${index}.mockups`,
      owner,
    );
    for (const [mockupIndex, mockup] of (parsedMockups ?? []).entries()) {
      claimKey(
        "mockup",
        mockup.id,
        `pages.${index}.mockups.${mockupIndex}.id`,
        owner,
      );
    }
    if (
      key !== undefined &&
      parsed !== undefined &&
      parsedMockups !== undefined
    ) {
      pages.push({
        id: key,
        ...parsed,
        mockups: parsedMockups as ProjectFileMockup[],
      });
    }
  }
  if (!issues.empty || !settings || !projectKey.success) {
    return failed();
  }

  const file: ProjectFile = {
    ...(data.$schema === undefined ? {} : { $schema: data.$schema }),
    format: PROJECT_FILE_FORMAT,
    formatVersion: format.current,
    ...(data.generator === undefined ? {} : { generator: data.generator }),
    project: { id: projectKey.data, ...settings },
    models,
    errorTypes,
    endpoints,
    pages,
  };

  // --- What the routes check against the database ------------------------------

  const add = (path: string, owner: string, message: string) =>
    issues.add(path, `${owner}: ${message}`);
  const modelIds = new Set(file.models.map((model) => model.id));
  /** References in a schema, checked as the API checks them. */
  const checkRefs = (schema: JsonSchema, path: string, owner: string) => {
    for (const issue of modelRefIssues(schema, modelIds, path)) {
      add(issue.path, owner, issue.message);
    }
  };
  const checkNesting = (example: JsonValue, path: string, owner: string) => {
    for (const issue of nestingIssues(example, path, "example")) {
      add(issue.path, owner, issue.message);
    }
  };

  const modelNames = new Set<string>();
  for (const [index, model] of file.models.entries()) {
    if (issues.full) break;
    const owner = `Model ${shown(model.name)}`;
    const name = model.name.toLowerCase();
    if (modelNames.has(name)) {
      add(`models.${index}.name`, owner, "Another model has this name");
    }
    modelNames.add(name);
    checkRefs(model.schema, `models.${index}.schema`, owner);
  }

  const errorTypeNames = new Set<string>();
  for (const [index, errorType] of file.errorTypes.entries()) {
    if (issues.full) break;
    const owner = `Error type ${shown(errorType.name)}`;
    const name = errorType.name.toLowerCase();
    if (errorTypeNames.has(name)) {
      add(
        `errorTypes.${index}.name`,
        owner,
        "Another error type has this name",
      );
    }
    errorTypeNames.add(name);
    for (const [path, schema] of schemasOfErrorType(errorType)) {
      checkRefs(schema, `errorTypes.${index}.${path}`, owner);
    }
    checkNesting(
      errorType.body.example,
      `errorTypes.${index}.body.example`,
      owner,
    );
  }

  const schemeIds = new Set(
    file.project.securitySchemes.map((scheme) => scheme.id),
  );
  const catalog = file.errorTypes.map(({ id, name, status }) => ({
    id,
    name,
    status,
  }));
  const byPath = new Map<string, EndpointFields>();
  const byOperationId = new Map<string, EndpointFields>();
  for (const [index, endpoint] of file.endpoints.entries()) {
    if (issues.full) break;
    const owner = shown(endpointLabel(endpoint), 80);
    const at = (path: string) => join(`endpoints.${index}`, path);
    const { security } = endpoint;
    if (
      security.type === "schemes" &&
      security.schemeIds.some((id) => !schemeIds.has(id))
    ) {
      add(
        at("security.schemeIds"),
        owner,
        "Pick schemes from the project's authentication settings",
      );
    }
    for (const [path, schema] of schemasOfEndpoint(endpoint)) {
      checkRefs(schema, at(path), owner);
    }
    for (const [path, value] of examplesOfEndpoint(endpoint)) {
      checkNesting(value, at(path), owner);
    }
    for (const issue of checkResponseErrors(endpoint, catalog)) {
      add(at(issue.path), owner, issue.message);
    }
    const pathKey = `${endpoint.method} ${pathMatchKey(endpoint.path)}`;
    const samePath = byPath.get(pathKey);
    if (samePath) {
      add(
        at("path"),
        owner,
        `${endpointLabel(samePath)} is already in this file`,
      );
    } else {
      byPath.set(pathKey, endpoint);
    }
    if (endpoint.operationId !== "") {
      const first = byOperationId.get(endpoint.operationId);
      if (first) {
        add(
          at("operationId"),
          owner,
          `Already used by ${endpointLabel(first)}`,
        );
      } else {
        byOperationId.set(endpoint.operationId, endpoint);
      }
    }
  }

  const endpointsById = new Map(
    file.endpoints.map((endpoint) => [endpoint.id, endpoint]),
  );
  const errorTypesById = new Map(
    file.errorTypes.map((errorType) => [errorType.id, errorType]),
  );
  const slugs = new Set<string>();
  const files = new Set<string>();
  for (const [index, page] of file.pages.entries()) {
    if (issues.full) break;
    const owner = `Page ${shown(page.name)}`;
    const at = (path: string) => join(`pages.${index}`, path);
    if (slugs.has(page.slug)) {
      add(at("slug"), owner, "Another page has this slug");
    }
    slugs.add(page.slug);
    let linksFound = true;
    for (const [linkIndex, link] of page.endpoints.entries()) {
      if (!endpointsById.has(link.endpointId)) {
        linksFound = false;
        add(
          at(`endpoints.${linkIndex}.endpointId`),
          owner,
          "Pick an endpoint of this project",
        );
      }
    }
    // Like the route, states are checked once the page's calls are there.
    if (linksFound) {
      const stateIssues = checkPageStates(page, {
        endpointsById,
        errorTypesById,
        mockupIds: new Set(page.mockups.map((mockup) => mockup.id)),
      });
      for (const issue of stateIssues) {
        add(at(issue.path), owner, issue.message);
      }
    }
    for (const [mockupIndex, mockup] of page.mockups.entries()) {
      if (files.has(mockup.file)) {
        add(
          at(`mockups.${mockupIndex}.file`),
          owner,
          `Another mockup uses ${shown(mockup.file, 100)}; each mockup has a file of its own`,
        );
      }
      files.add(mockup.file);
    }
  }

  return issues.empty ? { document: file } : failed();
}
