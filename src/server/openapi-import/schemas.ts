import {
  DATA_KEYWORDS,
  type JsonSchema,
  type JsonValue,
  modelRef,
  SCHEMA_MAP_KEYWORDS,
} from "../../shared/json-schema";
import {
  type Context,
  isObject,
  own,
  type Raw,
  type Segments,
  Stop,
  setOwn,
  shown,
  shownValue,
} from "./context";
import { counted } from "./notices";
import { pointerSegments, shownPointer, valueAt } from "./pointer";
import type { Located, References } from "./references";
import { UniqueNames } from "./unique-names";

// Schemas as the app stores them: JSON Schema 2020-12, with references to
// models as `model:<id>`. OpenAPI 3.0's Schema Objects are converted (as
// 3.0.3 defines them); 3.1's are taken as they are. Anything else a schema
// refers to with a pointer is copied in, and a pointer that comes back to
// itself makes its schema a model of its own.

/** Keywords whose values are data: copied, never followed. */
const DATA = new Set(["examples", "example", "default", "enum", "const"]);
/** Keywords whose values map names to schemas. */
const MAPS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);
/** Keywords whose value is one schema (or, for items, a list of them). */
const SINGLE = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "items",
  "contains",
  "propertyNames",
  "if",
  "then",
  "else",
  "not",
  "contentSchema",
  "additionalItems",
]);
/** Keywords whose value is a list of schemas. */
const LISTS = new Set(["allOf", "anyOf", "oneOf", "prefixItems"]);
/** OpenAPI's own keywords, which hold data. */
const OAS_DATA = new Set(["discriminator", "xml", "externalDocs"]);

/** Every keyword of OpenAPI 3.0's Schema Object. */
const OAS30_KEYWORDS = new Set([
  "title",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "maxLength",
  "minLength",
  "pattern",
  "maxItems",
  "minItems",
  "uniqueItems",
  "maxProperties",
  "minProperties",
  "required",
  "enum",
  "type",
  "allOf",
  "oneOf",
  "anyOf",
  "not",
  "items",
  "properties",
  "additionalProperties",
  "description",
  "format",
  "default",
  "nullable",
  "discriminator",
  "readOnly",
  "writeOnly",
  "xml",
  "externalDocs",
  "example",
  "deprecated",
  "$ref",
]);

/**
 * What 3.0 keeps beside a `$ref`: it ignores every sibling, but these only
 * annotate, so keeping them changes no validation.
 */
const REF_ANNOTATIONS_30 = new Set([
  "description",
  "title",
  "example",
  "externalDocs",
  "$comment",
  "readOnly",
  "writeOnly",
  "deprecated",
  "default",
]);

/** The JSON Schema keywords of 2020-12 that 3.0 lacks; they're kept and now apply. */
const KEYWORDS_2020 = new Set([
  "const",
  "if",
  "then",
  "else",
  "prefixItems",
  "$defs",
  "contains",
  "minContains",
  "maxContains",
  "dependentRequired",
  "dependentSchemas",
  "propertyNames",
  "patternProperties",
  "unevaluatedProperties",
  "unevaluatedItems",
  "contentEncoding",
  "contentMediaType",
  "contentSchema",
  "$id",
  "$anchor",
  "$dynamicRef",
  "$dynamicAnchor",
  "$comment",
  "examples",
]);

export function isSameDialect(uri: string) {
  return (
    uri === "https://json-schema.org/draft/2020-12/schema" ||
    uri === "https://json-schema.org/draft/2020-12/schema#" ||
    /^https:\/\/spec\.openapis\.org\/oas\/3\.[12]\/dialect\//.test(uri)
  );
}

/** "draft-07" for `http://json-schema.org/draft-07/schema#`, else the URI. */
function dialectName(uri: string) {
  return (
    /json-schema\.org\/(?:draft\/)?(draft-0\d|20\d\d-\d\d)\//.exec(uri)?.[1] ??
    shown(uri, 80)
  );
}

type Scope = {
  /** Levels of objects and lists above what's being written. */
  depth: number;
  oas30: boolean;
  base: string | undefined;
  resource: Segments;
};

/** A schema copied into itself: the copy that's at it makes it a model. */
class Cycle extends Error {
  readonly target: object;
  constructor(target: object) {
    super("A schema refers to itself through a pointer");
    this.target = target;
  }
}

/** A schema that's nothing but a reference. */
function isPureRef(value: unknown): value is Raw & { $ref: string } {
  return (
    isObject(value) &&
    typeof own(value, "$ref") === "string" &&
    Object.keys(value).length === 1
  );
}

/** The models of a conversion: component schemas, and promoted pointers. */
export type ModelEntry = {
  id: string;
  name: string;
  /** Where its schema is in the document. */
  segments: string[];
  /** The component name, before any renaming. */
  original: string;
};

export class Models {
  readonly entries: ModelEntry[] = [];
  private readonly byComponent = new Map<string, ModelEntry>();
  /** Models by the schema object they are, a place however long its pointer. */
  private readonly bySchema = new WeakMap<object, ModelEntry>();
  /** Names taken, ignoring case, as the app compares model names. */
  private readonly names = new UniqueNames({
    max: 64,
    separator: "-",
    fold: (name) => name.toLowerCase(),
  });
  /** Promoted pointers whose schema is still to be converted. */
  readonly pending: ModelEntry[] = [];

  /** A name the app takes, unique ignoring case: `Page«User»` → `Page-User-`. */
  private nameFor(wanted: string) {
    return this.names.claim(
      wanted.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 64) || "Schema",
    );
  }

  addComponent(original: string, schema: unknown) {
    const entry: ModelEntry = {
      id: `m${this.entries.length + 1}`,
      name: this.nameFor(original),
      segments: ["components", "schemas", original],
      original,
    };
    this.entries.push(entry);
    this.byComponent.set(original, entry);
    if (isObject(schema)) this.bySchema.set(schema, entry);
    return entry;
  }

  /** A model for a schema that refers to itself through a pointer. */
  promote(segments: string[], schema: object) {
    const structural = new Set([
      "components",
      "schemas",
      "properties",
      "items",
      "$defs",
      "definitions",
      "paths",
      "content",
      "schema",
      "responses",
      "requestBody",
      "requestBodies",
      "parameters",
      "headers",
      "allOf",
      "anyOf",
      "oneOf",
      "prefixItems",
      "additionalProperties",
      "patternProperties",
      "not",
    ]);
    const lists = new Set([
      "allOf",
      "anyOf",
      "oneOf",
      "prefixItems",
      "items",
      "parameters",
    ]);
    const words = segments
      .filter(
        (segment, index) =>
          !structural.has(segment) &&
          // An index into a list says nothing; a status code does.
          !(/^\d+$/.test(segment) && lists.has(segments[index - 1] ?? "")),
      )
      .map((segment) =>
        segment.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, ""),
      )
      .filter(Boolean);
    const entry: ModelEntry = {
      id: `m${this.entries.length + 1}`,
      name: this.nameFor(words.join(".") || "Schema"),
      segments,
      original: "",
    };
    this.entries.push(entry);
    this.bySchema.set(schema, entry);
    this.pending.push(entry);
    return entry;
  }

  component(name: string) {
    return this.byComponent.get(name);
  }

  /** The model a schema object of the document is, if it is one. */
  of(schema: unknown) {
    return isObject(schema) ? this.bySchema.get(schema) : undefined;
  }
}

export class Schemas {
  private readonly ctx: Context;
  private readonly refs: References;
  readonly models: Models;
  /** Schemas being copied in, to tell when one comes back. */
  private readonly copying = new Set<object>();
  /** Where each schema's `$ref` points, worked out once however often it's copied. */
  private readonly located = new WeakMap<object, Located | undefined>();

  constructor(ctx: Context, refs: References, models: Models) {
    this.ctx = ctx;
    this.refs = refs;
    this.models = models;
  }

  private note(
    kind: string,
    at: Segments,
    render: (count: number, examples: string) => string,
    example?: string,
  ) {
    this.ctx.note(kind, at, render, example);
  }

  /**
   * A schema where the app keeps one (a model, a body, a parameter or a
   * header): always an object, so `true` becomes `{}` and `false`
   * `{not: {}}`. `depth` is the levels the app stores above it (2 for a
   * property of a parameters object).
   */
  slot(value: unknown, at: Segments, depth = 0): JsonSchema {
    const { base, resource } = this.refs.baseAt(at);
    const scope: Scope = {
      depth,
      oas30: this.ctx.version === "3.0",
      base,
      resource,
    };
    const converted = this.schema(value, at, scope);
    // The place itself became a model (it refers to itself): refer to it.
    const promoted = this.models.of(value);
    if (promoted && promoted.original === "") {
      return { $ref: modelRef(promoted.id) };
    }
    if (converted === true) return {};
    if (converted === false) return { not: {} };
    return isObject(converted) ? (converted as JsonSchema) : {};
  }

  /** The schema of a model, with its own references to itself kept as model references. */
  modelSchema(entry: ModelEntry): JsonSchema {
    const { base, resource } = this.refs.baseAt(entry.segments);
    const value = valueAt(this.ctx.doc, entry.segments);
    const converted = this.schema(value, entry.segments, {
      depth: 0,
      oas30: this.ctx.version === "3.0",
      base,
      resource,
    });
    if (converted === true) return {};
    if (converted === false) return { not: {} };
    return isObject(converted) ? (converted as JsonSchema) : {};
  }

  /** Data inside a schema (examples, defaults…), copied and counted. */
  data(value: unknown, at: Segments, depth: number): JsonValue {
    this.ctx.count();
    if (Array.isArray(value)) {
      this.ctx.depth(depth + 1, at);
      return value.map((item, index) =>
        this.data(item, [...at, String(index)], depth + 1),
      );
    }
    if (isObject(value)) {
      this.ctx.depth(depth + 1, at);
      const out: Record<string, JsonValue> = {};
      for (const key of Object.keys(value)) {
        setOwn(out, key, this.data(value[key], [...at, key], depth + 1));
      }
      return out;
    }
    return value as JsonValue;
  }

  /**
   * Data that may hold references the app follows (an unknown keyword or an
   * extension inside a schema: the app looks for `$ref` there too).
   */
  private refData(value: unknown, at: Segments, scope: Scope): JsonValue {
    if (isObject(value) && typeof own(value, "$ref") === "string") {
      return this.schema(value, at, scope);
    }
    if (Array.isArray(value)) {
      this.ctx.count();
      this.ctx.depth(scope.depth + 1, at);
      return value.map((item, index) =>
        this.refData(item, [...at, String(index)], {
          ...scope,
          depth: scope.depth + 1,
        }),
      );
    }
    if (isObject(value)) {
      this.ctx.count();
      this.ctx.depth(scope.depth + 1, at);
      const inner = { ...scope, depth: scope.depth + 1 };
      const out: Record<string, JsonValue> = {};
      for (const key of Object.keys(value)) {
        const child = value[key];
        const here = [...at, key];
        // Where the app looks for references: never in data, and in maps
        // of schemas by name (a property may be called "examples").
        if (DATA_KEYWORDS.has(key)) {
          setOwn(out, key, this.data(child, here, inner.depth));
        } else if (SCHEMA_MAP_KEYWORDS.has(key) && isObject(child)) {
          this.ctx.count();
          this.ctx.depth(inner.depth + 1, here);
          const map: Record<string, JsonValue> = {};
          for (const name of Object.keys(child)) {
            setOwn(
              map,
              name,
              this.refData(child[name], [...here, name], {
                ...inner,
                depth: inner.depth + 1,
              }),
            );
          }
          setOwn(out, key, map);
        } else {
          setOwn(out, key, this.refData(child, here, inner));
        }
      }
      return out;
    }
    return this.data(value, at, scope.depth);
  }

  /** Where the `$ref` of `holder` points, located once for that schema. */
  private locate(holder: object, ref: string, at: Segments, scope: Scope) {
    if (this.located.has(holder)) {
      return this.located.get(holder);
    }
    const located = this.refs.locate(ref, at, scope.base, scope.resource, true);
    this.located.set(holder, located);
    return located;
  }

  /**
   * What the `$ref` of `holder` becomes: a model reference, or a copy of
   * what it points at. A chain of schemas that are only references is
   * followed here, without recursion, so its length takes no stack; each
   * one passed counts as a value copied in.
   */
  private ref(
    holder: Raw,
    written: string,
    at: Segments,
    scope: Scope,
    /** Levels above where a copy would go. */
    copyDepth: number,
  ): { ref: string } | { copy: JsonValue } {
    /** What this chain is copying: each target, how many references before it, and where. */
    const chain = new Map<object, { hops: number; segments: string[] }>();
    /** A reference after `hops` references only: as the copies before would have it. */
    const result = (to: string, hops: number) => {
      if (hops === 0) {
        return { ref: to };
      }
      this.ctx.count();
      return { copy: { $ref: to } };
    };
    const promote = (target: object) => {
      const { hops, segments } = chain.get(target) as {
        hops: number;
        segments: string[];
      };
      const entry = this.models.promote([...segments], target);
      this.note(
        "promoted",
        segments,
        (count, examples) =>
          `${counted(count, "schema")} that ${count === 1 ? "refers" : "refer"} to ${count === 1 ? "itself" : "themselves"} through a pointer ${count === 1 ? "is a model" : "are models"} now: ${examples}`,
        entry.name,
      );
      return result(modelRef(entry.id), hops);
    };
    let ref = written;
    let located = this.locate(holder, ref, at, scope);
    try {
      for (let hops = 0; ; hops++) {
        if (!located || "keep" in located) {
          // Refused (the import stops), or kept as written.
          return result(ref, hops);
        }
        const segments = [...located.segments];
        if (
          segments.length === 3 &&
          segments[0] === "components" &&
          segments[1] === "schemas"
        ) {
          const entry = this.models.component(segments[2] as string);
          if (entry) {
            return result(modelRef(entry.id), hops);
          }
        }
        const target = valueAt(this.ctx.doc, segments);
        const promoted = this.models.of(target);
        if (promoted) {
          return result(modelRef(promoted.id), hops);
        }
        if (isObject(target)) {
          if (this.copying.has(target)) {
            if (chain.has(target)) {
              return promote(target);
            }
            throw new Cycle(target);
          }
          this.copying.add(target);
          chain.set(target, { hops, segments });
        }
        const base = this.refs.baseAt(segments);
        if (isPureRef(target)) {
          this.ctx.count();
          ref = target.$ref;
          located = this.locate(target, ref, [...segments, "$ref"], {
            ...scope,
            base: base.base,
            resource: base.resource,
          });
          continue;
        }
        return {
          copy: this.schema(target, segments, {
            depth: copyDepth,
            oas30: this.ctx.version === "3.0",
            base: base.base,
            resource: base.resource,
          }),
        };
      }
    } catch (error) {
      if (error instanceof Cycle && chain.has(error.target)) {
        return promote(error.target);
      }
      throw error;
    } finally {
      for (const target of chain.keys()) {
        this.copying.delete(target);
      }
    }
  }

  private schema(value: unknown, at: Segments, scope: Scope): JsonValue {
    if (typeof value === "boolean") {
      this.ctx.count();
      return value;
    }
    if (!isObject(value)) {
      // Not a schema: kept as written, for the export's checks to name.
      // A list may still hold references, which the app follows.
      return Array.isArray(value)
        ? this.refData(value, at, scope)
        : this.data(value, at, scope.depth);
    }
    const depth = scope.depth + 1;
    this.ctx.depth(depth, at);
    this.ctx.count();

    let { oas30, base, resource } = scope;
    const dialect = own(value, "$schema");
    let dropSchema = false;
    if (dialect !== undefined) {
      if (oas30) {
        dropSchema = true;
        this.note(
          "schema-30",
          [...at, "$schema"],
          (count) =>
            `$schema was left out of ${counted(count, "schema")}: OpenAPI 3.0's schemas don't have it, and are read as OpenAPI 3.0 defines them`,
        );
      } else if (typeof dialect !== "string") {
        this.note(
          "schema-not-uri",
          [...at, "$schema"],
          (count, examples) =>
            `${counted(count, "schema")} ${count === 1 ? "has" : "have"} a $schema that isn't a URI (${examples}): the Export tab lists ${count === 1 ? "it" : "them"} until $schema is removed`,
          shownValue(dialect, 20),
        );
      } else if (isSameDialect(dialect)) {
        // Kept: it says what the schema is anyway, and the export checks it so.
      } else {
        this.note(
          "schema-other",
          [...at, "$schema"],
          (count, examples) =>
            `${counted(count, "schema")} ${count === 1 ? "says it's" : "say they're"} ${examples}, not JSON Schema 2020-12, which OpenAPI 3.1 and this app use: the Export tab lists ${count === 1 ? "it" : "them"} until $schema is removed`,
          dialectName(dialect),
        );
      }
    }
    if (!oas30) {
      const id = own(value, "$id");
      if (typeof id === "string") {
        try {
          const url = base === undefined ? new URL(id) : new URL(id, base);
          url.hash = "";
          base = url.href;
          resource = at;
        } catch {
          // A relative $id without a base: refs inside resolve as before.
        }
      }
    }
    const inner: Scope = { depth, oas30, base, resource };

    const keys = Object.keys(value);
    const refValue = own(value, "$ref");
    const hasRef = typeof refValue === "string";
    const nullable = oas30 && own(value, "nullable") === true;
    const typeValue = own(value, "type");

    // 3.0 ignores a $ref's siblings: annotations stay, the rest is reported.
    let kept = keys;
    if (oas30 && hasRef) {
      const dropped = keys.filter(
        (key) =>
          key !== "$ref" &&
          key !== "nullable" &&
          !key.startsWith("x-") &&
          !REF_ANNOTATIONS_30.has(key),
      );
      if (dropped.length > 0) {
        this.note(
          "ref-siblings-30",
          [...at, dropped[0] as string],
          (count, examples) =>
            `${counted(count, "keyword")} beside a $ref ${count === 1 ? "was" : "were"} left out, since OpenAPI 3.0 ignores ${count === 1 ? "it" : "them"} there: ${examples}`,
          `${shown(dropped.join(", "), 100)} (${shownPointer(at, 200)})`,
        );
      }
      kept = keys.filter((key) => !dropped.includes(key));
    }
    if (
      oas30 &&
      own(value, "nullable") === true &&
      typeof typeValue !== "string" &&
      !Array.isArray(typeValue)
    ) {
      this.note(
        "nullable-untyped",
        [...at, "nullable"],
        (count, examples) =>
          `nullable: true without type has no effect in OpenAPI 3.0.3, so null isn't allowed in ${counted(count, "place")} (${examples}). To allow it, put the schema in anyOf with {type: "null"}.`,
        shownPointer(at, 200),
      );
    }
    if (
      nullable &&
      (typeof typeValue === "string" || Array.isArray(typeValue)) &&
      Array.isArray(own(value, "enum")) &&
      !(own(value, "enum") as unknown[]).includes(null)
    ) {
      this.note(
        "nullable-enum",
        [...at, "enum"],
        (count, examples) =>
          `${counted(count, "schema")} with nullable: true and an enum without null ${count === 1 ? "doesn't" : "don't"} allow null, as OpenAPI 3.0.3 reads ${count === 1 ? "it" : "them"} (${examples})`,
        shownPointer(at, 200),
      );
    }

    const out: Record<string, JsonValue> = {};
    let copied: JsonValue | undefined;
    /** A copy beside other keywords, which allOf puts with what they add. */
    let alongside: JsonValue | undefined;
    const exclusive = (
      key: "exclusiveMinimum" | "exclusiveMaximum",
      bound: "minimum" | "maximum",
    ) => {
      const flag = own(value, key);
      if (typeof flag !== "boolean") {
        return undefined;
      }
      const limit = own(value, bound);
      if (!oas30) {
        this.note(
          "exclusive-31",
          [...at, key],
          (count, examples) =>
            `${counted(count, "schema")} had a true or false ${count === 1 ? "bound" : "bounds"} as OpenAPI 3.0 writes them (${examples}); OpenAPI 3.1 gives the bound itself as ${count === 1 ? "its" : "their"} value, so ${count === 1 ? "it was" : "they were"} rewritten that way`,
          flag && typeof limit === "number"
            ? `${key}: true with ${bound}: ${limit} → ${key}: ${limit}`
            : `${key}: ${flag} → left out`,
        );
      }
      if (flag && typeof limit === "number") {
        return limit;
      }
      if (flag) {
        this.note(
          "exclusive-unbounded",
          [...at, key],
          (count, examples) =>
            `${counted(count, "schema")} had ${examples} without ${bound}, which has no effect, so it was left out`,
          `${key}: true`,
        );
      }
      return null;
    };
    const exclusiveMinimum = exclusive("exclusiveMinimum", "minimum");
    const exclusiveMaximum = exclusive("exclusiveMaximum", "maximum");

    for (const key of kept) {
      const child = value[key];
      const here = [...at, key];
      if (key === "$schema" && dropSchema) {
        continue;
      }
      if (key === "$ref" && hasRef) {
        const others = kept.some(
          (other) => other !== "$ref" && !(other === "$schema" && dropSchema),
        );
        const result = this.ref(
          value,
          refValue as string,
          here,
          inner,
          others ? depth + 1 : scope.depth,
        );
        if ("ref" in result) {
          this.ctx.count();
          setOwn(out, "$ref", result.ref);
        } else if (others) {
          // allOf keeps what the siblings add to the copied schema, first
          // of what an allOf beside it has (put together below).
          alongside = result.copy;
          if (own(out, "allOf") === undefined) setOwn(out, "allOf", []);
        } else {
          copied = result.copy;
        }
        continue;
      }
      if (oas30 && key === "nullable") {
        continue;
      }
      if (key === "nullable" && !oas30) {
        this.note(
          "nullable-31",
          here,
          (count) =>
            `nullable isn't a keyword of OpenAPI 3.1, so it has no effect in ${counted(count, "schema")}; use type: [..., "null"] instead`,
        );
      }
      if (key === "exclusiveMinimum" && exclusiveMinimum !== undefined) {
        if (exclusiveMinimum !== null) {
          this.ctx.count();
          setOwn(out, key, exclusiveMinimum);
        }
        continue;
      }
      if (key === "exclusiveMaximum" && exclusiveMaximum !== undefined) {
        if (exclusiveMaximum !== null) {
          this.ctx.count();
          setOwn(out, key, exclusiveMaximum);
        }
        continue;
      }
      if (key === "minimum" && typeof exclusiveMinimum === "number") continue;
      if (key === "maximum" && typeof exclusiveMaximum === "number") continue;
      if (
        key === "type" &&
        nullable &&
        (typeof child === "string" || Array.isArray(child))
      ) {
        this.ctx.count(2);
        const types = typeof child === "string" ? [child] : [...child];
        setOwn(out, key, types.includes("null") ? types : [...types, "null"]);
        continue;
      }
      if (
        oas30 &&
        !OAS30_KEYWORDS.has(key) &&
        !key.startsWith("x-") &&
        KEYWORDS_2020.has(key)
      ) {
        this.note(
          "keywords-2020",
          here,
          (_count, examples) =>
            `Keywords OpenAPI 3.0 doesn't have were kept, and now apply as JSON Schema 2020-12 defines them: ${examples}`,
          key,
        );
      }
      if (key === "example" && oas30) {
        if (!Object.hasOwn(value, "examples")) {
          this.ctx.count();
          setOwn(out, "examples", [this.data(child, here, depth + 1)]);
        } else {
          setOwn(out, key, this.data(child, here, depth));
        }
        continue;
      }
      if (DATA.has(key)) {
        setOwn(out, key, this.data(child, here, depth));
      } else if (MAPS.has(key) && isObject(child)) {
        this.ctx.count();
        this.ctx.depth(depth + 1, here);
        const map: Record<string, JsonValue> = {};
        for (const name of Object.keys(child)) {
          setOwn(
            map,
            name,
            this.schema(child[name], [...here, name], {
              ...inner,
              depth: depth + 1,
            }),
          );
        }
        setOwn(out, key, map);
      } else if (
        SINGLE.has(key) &&
        (isObject(child) || typeof child === "boolean")
      ) {
        setOwn(out, key, this.schema(child, here, inner));
      } else if (
        (LISTS.has(key) || key === "items" || key === "additionalItems") &&
        Array.isArray(child)
      ) {
        this.ctx.count();
        this.ctx.depth(depth + 1, here);
        setOwn(
          out,
          key,
          child.map((item, index) =>
            this.schema(item, [...here, String(index)], {
              ...inner,
              depth: depth + 1,
            }),
          ),
        );
      } else if (key === "discriminator") {
        setOwn(out, key, this.discriminator(child, value, here, inner));
      } else if (OAS_DATA.has(key)) {
        // Data to OpenAPI, but the app looks for references in them too.
        setOwn(out, key, this.refData(child, here, inner));
      } else {
        setOwn(out, key, this.refData(child, here, inner));
      }
    }
    if (copied !== undefined) {
      return copied;
    }
    if (alongside !== undefined) {
      this.ctx.count();
      const all = own(out, "allOf");
      setOwn(
        out,
        "allOf",
        !Object.hasOwn(value, "allOf")
          ? [alongside]
          : Array.isArray(all)
            ? [alongside, ...all]
            : // Not a list, as a schema's allOf must be: kept as written, inside.
              [alongside, { allOf: all as JsonValue }],
      );
    }
    return out;
  }

  /**
   * A discriminator, with its mapping pointing at models by their new names,
   * and written out for renamed models it would otherwise match by name.
   */
  private discriminator(
    child: unknown,
    schema: Record<string, unknown>,
    at: Segments,
    scope: Scope,
  ): JsonValue {
    const copy = this.refData(child, at, scope);
    if (!isObject(copy)) {
      return copy;
    }
    const mapping = isObject(copy.mapping) ? { ...copy.mapping } : undefined;
    const prefix = "#/components/schemas/";
    /** The component a mapping value or `$ref` names: a schema name, or a pointer to one. */
    const componentOf = (target: string) => {
      if (!target.startsWith(prefix)) return target;
      const segments = pointerSegments(target.slice(1));
      return segments?.length === 3 ? segments[2] : undefined;
    };
    const renamed = (name: string | undefined) => {
      const entry =
        name === undefined ? undefined : this.models.component(name);
      return entry && entry.name !== name ? entry.name : undefined;
    };
    let changed = false;
    if (mapping) {
      for (const [key, target] of Object.entries(mapping)) {
        if (typeof target !== "string") continue;
        const next = renamed(componentOf(target));
        if (next !== undefined) {
          setOwn(
            mapping,
            key,
            target.startsWith(prefix) ? `${prefix}${next}` : next,
          );
          changed = true;
        }
      }
    }
    // Implicit mappings match a schema's name, which renaming changes.
    const targets = new Set(
      Object.values(mapping ?? {}).map((target) =>
        typeof target === "string" ? componentOf(target) : undefined,
      ),
    );
    const explicit: Record<string, JsonValue> = {};
    for (const key of ["oneOf", "anyOf"]) {
      const options = own(schema, key);
      if (!Array.isArray(options)) continue;
      for (const option of options) {
        const ref = isObject(option) ? own(option, "$ref") : undefined;
        if (typeof ref !== "string" || !ref.startsWith(prefix)) continue;
        const name = componentOf(ref);
        const next = renamed(name);
        if (
          name !== undefined &&
          next !== undefined &&
          !targets.has(next) &&
          !targets.has(name)
        ) {
          setOwn(explicit, name, `${prefix}${next}`);
        }
      }
    }
    if (Object.keys(explicit).length > 0) {
      this.ctx.count(Object.keys(explicit).length);
      return { ...copy, mapping: { ...(mapping ?? {}), ...explicit } };
    }
    return changed && mapping ? { ...copy, mapping } : copy;
  }

  /** Converts the schemas of promoted pointers, until none is pending. */
  drain(): { entry: ModelEntry; schema: JsonSchema }[] {
    const done: { entry: ModelEntry; schema: JsonSchema }[] = [];
    for (
      let entry = this.models.pending.shift();
      entry;
      entry = this.models.pending.shift()
    ) {
      done.push({ entry, schema: this.modelSchema(entry) });
    }
    return done;
  }
}

export { Stop };
