import type { ApiIssue } from "./api-error";

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** A JSON Schema (2020-12) document or subschema. */
export type JsonSchema = { [key: string]: JsonValue };

/** How a schema references a model when stored: `model:<model id>`. */
export const MODEL_REF_PREFIX = "model:";
/** How the same reference looks in OpenAPI and in the JSON editor. */
export const COMPONENT_REF_PREFIX = "#/components/schemas/";

// Keywords whose values are data, not subschemas: a `$ref` inside an example
// is just a string.
export const DATA_KEYWORDS: ReadonlySet<string> = new Set([
  "examples",
  "example",
  "default",
  "enum",
  "const",
]);
// Keywords whose values map names to subschemas: their keys are names, not
// keywords (a property may well be called "examples").
export const SCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

/**
 * How many levels of objects and lists a schema or an example may have. Real
 * ones stay under 30; exports and editors follow them recursively, and the
 * stack lasts far longer than this in any engine, so what saves exports.
 */
export const MAX_NESTING = 256;

/**
 * Whether objects and lists in `value` nest more than `levels` deep (`{}` is
 * one level). Found without recursion, so any depth is safe to check.
 */
export function nestsDeeperThan(value: unknown, levels: number): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  if (levels < 1) {
    return true;
  }
  const pending: [object, number][] = [[value, 1]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [container, level] = next;
    for (const child of Object.values(container)) {
      if (typeof child === "object" && child !== null) {
        if (level === levels) {
          return true;
        }
        pending.push([child, level + 1]);
      }
    }
  }
  return false;
}

function nestingMessage(what: "schema" | "example") {
  return `This ${what} is nested more than ${MAX_NESTING} levels deep`;
}

/** The issue for a schema or an example nested more than MAX_NESTING levels deep. */
export function nestingIssues(
  value: JsonValue,
  path: string,
  what: "schema" | "example",
): ApiIssue[] {
  return nestsDeeperThan(value, MAX_NESTING)
    ? [{ path, message: nestingMessage(what) }]
    : [];
}

/** Whether an issue is one of nestingIssues'. */
export function isNestingIssue(issue: ApiIssue) {
  return (
    issue.message === nestingMessage("schema") ||
    issue.message === nestingMessage("example")
  );
}

export function isJsonObject(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns a copy of the schema with every `$ref` replaced by `replace(ref)`. */
export function mapRefs(
  schema: JsonSchema,
  replace: (ref: string) => string,
): JsonSchema {
  function walk(value: JsonValue): JsonValue {
    if (Array.isArray(value)) {
      return value.map(walk);
    }
    if (!isJsonObject(value)) {
      return value;
    }
    const result: JsonSchema = {};
    for (const [key, child] of Object.entries(value)) {
      let mapped: JsonValue;
      if (key === "$ref" && typeof child === "string") {
        mapped = replace(child);
      } else if (DATA_KEYWORDS.has(key)) {
        mapped = child;
      } else if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(child)) {
        mapped = Object.fromEntries(
          Object.entries(child).map(([name, sub]) => [name, walk(sub)]),
        );
      } else {
        mapped = walk(child);
      }
      if (key === "__proto__") {
        // Assigning it would set the prototype instead, losing the key.
        Object.defineProperty(result, key, {
          value: mapped,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } else {
        result[key] = mapped;
      }
    }
    return result;
  }
  return walk(schema) as JsonSchema;
}

/**
 * Calls `visit` with each `$ref` in a schema, where mapRefs looks, and the
 * object holding it. Nothing is copied, so large schemas stay cheap.
 */
function visitRefs(
  value: JsonValue,
  visit: (holder: JsonSchema, ref: string) => void,
) {
  if (Array.isArray(value)) {
    for (const item of value) {
      visitRefs(item, visit);
    }
    return;
  }
  if (!isJsonObject(value)) {
    return;
  }
  for (const key in value) {
    if (!Object.hasOwn(value, key)) {
      continue;
    }
    const child = value[key] as JsonValue;
    if (key === "$ref" && typeof child === "string") {
      visit(value, child);
    } else if (DATA_KEYWORDS.has(key)) {
      // Data, not subschemas.
    } else if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(child)) {
      for (const name in child) {
        if (Object.hasOwn(child, name)) {
          visitRefs(child[name] as JsonValue, visit);
        }
      }
    } else {
      visitRefs(child, visit);
    }
  }
}

export function collectRefs(schema: JsonSchema): string[] {
  const refs: string[] = [];
  visitRefs(schema, (_holder, ref) => {
    refs.push(ref);
  });
  return refs;
}

/** Like mapRefs, but changes the schema itself instead of copying it. */
export function replaceRefsInPlace(
  schema: JsonSchema,
  replace: (ref: string) => string,
) {
  visitRefs(schema, (holder, ref) => {
    holder.$ref = replace(ref);
  });
}

export function modelRef(modelId: string) {
  return `${MODEL_REF_PREFIX}${modelId}`;
}

/** The model ID of a `model:<id>` reference, or null for other references. */
export function modelIdOfRef(ref: string): string | null {
  return ref.startsWith(MODEL_REF_PREFIX)
    ? ref.slice(MODEL_REF_PREFIX.length)
    : null;
}

/** `model:<id>` → `#/components/schemas/<Name>`. Unknown IDs are left alone. */
export function refsToComponentNames(
  schema: JsonSchema,
  nameOf: (modelId: string) => string | undefined,
): JsonSchema {
  return mapRefs(schema, (ref) => {
    const id = modelIdOfRef(ref);
    const name = id === null ? undefined : nameOf(id);
    return name === undefined ? ref : `${COMPONENT_REF_PREFIX}${name}`;
  });
}

/** `#/components/schemas/<Name>` → `model:<id>`, reporting names with no model. */
export function refsToModelIds(
  schema: JsonSchema,
  idOf: (modelName: string) => string | undefined,
): { schema: JsonSchema; unknownNames: string[] } {
  const unknownNames = new Set<string>();
  const converted = mapRefs(schema, (ref) => {
    if (!ref.startsWith(COMPONENT_REF_PREFIX)) {
      return ref;
    }
    const name = ref.slice(COMPONENT_REF_PREFIX.length);
    const id = idOf(name);
    if (id === undefined) {
      unknownNames.add(name);
      return ref;
    }
    return modelRef(id);
  });
  return { schema: converted, unknownNames: [...unknownNames] };
}

function shownRef(ref: string) {
  return ref.length > 200 ? `${ref.slice(0, 197)}…` : ref;
}

/**
 * Issues for `$ref`s that don't point at one of `modelIds`: models that don't
 * exist, and references the app can't follow (other documents, URLs, and
 * component names, which only JSON views and exports use). Local references
 * like `#/$defs/x` are fine. A schema nested too deeply to follow is refused
 * first.
 */
export function modelRefIssues(
  schema: JsonSchema,
  modelIds: ReadonlySet<string>,
  issuePath: string,
): ApiIssue[] {
  const nesting = nestingIssues(schema, issuePath, "schema");
  if (nesting.length > 0) {
    return nesting;
  }
  const messages = new Set<string>();
  for (const ref of collectRefs(schema)) {
    const id = modelIdOfRef(ref);
    if (id !== null) {
      if (!modelIds.has(id)) {
        messages.add(`References a model that doesn't exist: ${shownRef(ref)}`);
      }
    } else if (!ref.startsWith("#") || ref.startsWith(COMPONENT_REF_PREFIX)) {
      messages.add(
        `Unsupported reference "${shownRef(ref)}"; reference a model of this project instead`,
      );
    }
  }
  return [...messages].map((message) => ({ path: issuePath, message }));
}
