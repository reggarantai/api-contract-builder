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
 * Values in one generated example, at most: models that refer to each other
 * many times, or lists of lists, would otherwise multiply them. Examples of
 * real schemas are far smaller.
 */
const MAX_VALUES = 10_000;

/**
 * Characters of property names and given values (`examples`, `const`,
 * `enum`, `default`) in one generated example, at most: a long one, repeated
 * by references, would otherwise multiply too.
 */
const MAX_TEXT = 1_000_000;

type Budget = { values: number; text: number };

/**
 * A plausible value for a schema, used to prefill examples. Model references
 * are expanded with `resolveModel`; a model inside itself becomes null, and
 * so does anything past 10,000 values or a million characters of names and
 * given values.
 */
export function generateExample(
  schema: JsonValue | undefined,
  resolveModel: (modelId: string) => JsonSchema | undefined,
): JsonValue {
  return generate(schema, resolveModel, new Set(), {
    values: MAX_VALUES,
    text: MAX_TEXT,
  });
}

/** About how many characters `value` takes as JSON. */
function lengthOf(value: JsonValue) {
  if (typeof value === "string") {
    return value.length + 2;
  }
  if (typeof value !== "object" || value === null) {
    return String(value).length;
  }
  try {
    return JSON.stringify(value).length;
  } catch {
    // Too deep or too long to write out.
    return Number.POSITIVE_INFINITY;
  }
}

/** Whether `count` more characters fit; once they don't, nothing does. */
function spendText(budget: Budget, count: number) {
  budget.text -= count;
  return budget.text >= 0;
}

/** A value the schema gives, if it fits in what's left. */
function given(value: JsonValue | undefined, budget: Budget): JsonValue {
  const result = value ?? null;
  return spendText(budget, lengthOf(result)) ? result : null;
}

function generate(
  schema: JsonValue | undefined,
  resolveModel: (modelId: string) => JsonSchema | undefined,
  expanding: ReadonlySet<string>,
  budget: Budget,
): JsonValue {
  // Every value counts, a null for a schema like `true` too.
  if (budget.values <= 0 || budget.text < 0) {
    return null;
  }
  budget.values--;
  if (!isJsonObject(schema) || expanding.size > MAX_DEPTH) {
    return null;
  }
  const next = (sub: JsonValue | undefined, nextExpanding = expanding) =>
    generate(sub, resolveModel, nextExpanding, budget);

  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return given(schema.examples[0], budget);
  }
  if ("const" in schema) {
    return given(schema.const, budget);
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return given(schema.enum[0], budget);
  }
  if ("default" in schema) {
    return given(schema.default, budget);
  }

  if (typeof schema.$ref === "string") {
    const modelId = modelIdOfRef(schema.$ref);
    if (modelId === null || expanding.has(modelId)) {
      return null;
    }
    return next(resolveModel(modelId), new Set([...expanding, modelId]));
  }

  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    const options = schema[keyword];
    if (Array.isArray(options)) {
      const option =
        options.find((item) => isJsonObject(item) && item.type !== "null") ??
        options[0];
      return next(option);
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
      // One at a time, so each item counts against the budget.
      return Array.from({ length: Math.min(count, 5) }, () =>
        next(schema.items),
      );
    }
    case "object":
    case undefined: {
      if (type === undefined && !isJsonObject(schema.properties)) {
        return null;
      }
      const properties = isJsonObject(schema.properties)
        ? schema.properties
        : {};
      const value: { [key: string]: JsonValue } = {};
      for (const [name, sub] of Object.entries(properties)) {
        if (budget.values <= 0 || !spendText(budget, name.length + 4)) {
          break;
        }
        // Defined, not assigned, so a property called "__proto__" stays one.
        Object.defineProperty(value, name, {
          value: next(sub),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      return value;
    }
    default:
      return null;
  }
}
