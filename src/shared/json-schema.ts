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
const DATA_KEYWORDS = new Set([
  "examples",
  "example",
  "default",
  "enum",
  "const",
]);
// Keywords whose values map names to subschemas: their keys are names, not
// keywords (a property may well be called "examples").
const SCHEMA_MAP_KEYWORDS = new Set([
  "properties",
  "patternProperties",
  "$defs",
  "definitions",
  "dependentSchemas",
]);

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
      if (key === "$ref" && typeof child === "string") {
        result[key] = replace(child);
      } else if (DATA_KEYWORDS.has(key)) {
        result[key] = child;
      } else if (SCHEMA_MAP_KEYWORDS.has(key) && isJsonObject(child)) {
        result[key] = Object.fromEntries(
          Object.entries(child).map(([name, sub]) => [name, walk(sub)]),
        );
      } else {
        result[key] = walk(child);
      }
    }
    return result;
  }
  return walk(schema) as JsonSchema;
}

export function collectRefs(schema: JsonSchema): string[] {
  const refs: string[] = [];
  mapRefs(schema, (ref) => {
    refs.push(ref);
    return ref;
  });
  return refs;
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
