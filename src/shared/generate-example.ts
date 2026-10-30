import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  modelIdOfRef,
} from "./json-schema";

const STRING_FORMAT_EXAMPLES: Record<string, string> = {
  email: "user@example.com",
  uri: "https://example.com",
  url: "https://example.com",
  uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  date: "2026-01-01",
  "date-time": "2026-01-01T00:00:00Z",
  time: "12:00:00",
  hostname: "example.com",
  ipv4: "192.0.2.1",
  ipv6: "2001:db8::1",
  password: "********",
  byte: "U3dhZ2dlciByb2Nrcw==",
};

const MAX_DEPTH = 12;

function numberFor(schema: JsonSchema) {
  const { minimum, maximum } = schema;
  if (typeof minimum === "number") {
    return minimum;
  }
  if (typeof maximum === "number" && maximum < 0) {
    return maximum;
  }
  return 0;
}

/**
 * A plausible value for a schema, used to prefill examples. Model references
 * are expanded with `resolveModel`; a model inside itself becomes null.
 */
export function generateExample(
  schema: JsonValue | undefined,
  resolveModel: (modelId: string) => JsonSchema | undefined,
  expanding: ReadonlySet<string> = new Set(),
): JsonValue {
  if (!isJsonObject(schema) || expanding.size > MAX_DEPTH) {
    return null;
  }
  const generate = (sub: JsonValue | undefined, nextExpanding = expanding) =>
    generateExample(sub, resolveModel, nextExpanding);

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0] ?? null;
  }
  if ("const" in schema) {
    return schema.const ?? null;
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0] ?? null;
  }
  if ("default" in schema) {
    return schema.default ?? null;
  }

  if (typeof schema.$ref === "string") {
    const modelId = modelIdOfRef(schema.$ref);
    if (modelId === null || expanding.has(modelId)) {
      return null;
    }
    return generate(resolveModel(modelId), new Set([...expanding, modelId]));
  }

  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    const options = schema[keyword];
    if (Array.isArray(options)) {
      const option =
        options.find((item) => isJsonObject(item) && item.type !== "null") ??
        options[0];
      return generate(option);
    }
  }

  const type = Array.isArray(schema.type)
    ? schema.type.find((item) => item !== "null")
    : schema.type;

  switch (type) {
    case "string":
      return (
        (typeof schema.format === "string"
          ? STRING_FORMAT_EXAMPLES[schema.format]
          : undefined) ?? "string"
      );
    case "integer":
      return Math.ceil(numberFor(schema));
    case "number":
      return numberFor(schema);
    case "boolean":
      return true;
    case "null":
      return null;
    case "array": {
      const count =
        typeof schema.minItems === "number" ? Math.max(1, schema.minItems) : 1;
      const item = generate(schema.items);
      return Array.from({ length: Math.min(count, 5) }, () => item);
    }
    case "object":
    case undefined: {
      if (type === undefined && !isJsonObject(schema.properties)) {
        return null;
      }
      const properties = isJsonObject(schema.properties)
        ? schema.properties
        : {};
      return Object.fromEntries(
        Object.entries(properties).map(([name, sub]) => [name, generate(sub)]),
      );
    }
    default:
      return null;
  }
}
