import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  modelIdOfRef,
} from "../../shared/json-schema";

// --- Field tables -----------------------------------------------------------

export type FieldContext = {
  model: (id: string) => { name: string; schema: JsonSchema } | undefined;
  /** Link to a model's section in models.md, relative to the file being written. */
  modelLink: (name: string) => string;
  /** Repeat referenced models' fields in place (default), or only link them. */
  expand?: boolean;
};

export type FieldRow = {
  /** Path like `data.items[].name`. */
  field: string;
  type: string;
  required: boolean;
  description: string;
  rules: string;
  /** The first example, as inline code, or "". */
  example: string;
};

/** Text safe for one Markdown table cell. */
export function cell(text: string) {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

function asSchema(value: JsonValue | undefined): JsonSchema {
  return isJsonObject(value) ? value : {};
}

/** The schema without its "or null", and whether null is allowed. */
function unwrapNullable(schema: JsonSchema): {
  schema: JsonSchema;
  nullable: boolean;
} {
  const { type } = schema;
  if (Array.isArray(type) && type.includes("null")) {
    const others = type.filter((item) => item !== "null");
    return {
      schema: {
        ...schema,
        type: others.length === 1 ? (others[0] ?? null) : others,
      },
      nullable: true,
    };
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const options = schema[keyword];
    if (Array.isArray(options) && options.length === 2) {
      const nonNull = options.filter(
        (option) => !(isJsonObject(option) && option.type === "null"),
      );
      if (nonNull.length === 1) {
        const { [keyword]: _options, ...rest } = schema;
        return { schema: { ...rest, ...asSchema(nonNull[0]) }, nullable: true };
      }
    }
  }
  return { schema, nullable: false };
}

function referencedModel(schema: JsonSchema, context: FieldContext) {
  const id = typeof schema.$ref === "string" ? modelIdOfRef(schema.$ref) : null;
  const model = id === null ? undefined : context.model(id);
  return id !== null && model ? { id, ...model } : undefined;
}

/** A readable type: "string (email)", "array of [Stock](…)", "integer or null". */
export function typeLabel(schema: JsonSchema, context: FieldContext): string {
  const { schema: inner, nullable } = unwrapNullable(schema);
  const label = baseTypeLabel(inner, context);
  return nullable ? `${label} or null` : label;
}

function baseTypeLabel(schema: JsonSchema, context: FieldContext): string {
  const model = referencedModel(schema, context);
  if (model) {
    return `[${model.name}](${context.modelLink(model.name)})`;
  }
  if (typeof schema.$ref === "string") {
    return "reference";
  }
  for (const [keyword, word] of [
    ["oneOf", "one of"],
    ["anyOf", "any of"],
    ["allOf", "all of"],
  ] as const) {
    const options = schema[keyword];
    if (Array.isArray(options)) {
      return `${word} ${options.map((option) => typeLabel(asSchema(option), context)).join(", ")}`;
    }
  }
  const { type } = schema;
  if (type === "array") {
    return `array of ${typeLabel(asSchema(schema.items), context)}`;
  }
  if (type === "string" && typeof schema.format === "string") {
    return `string (${schema.format})`;
  }
  if (typeof type === "string") {
    return type;
  }
  if (Array.isArray(type)) {
    return type.join(" or ");
  }
  return isJsonObject(schema.properties) ? "object" : "any";
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function range(min: unknown, max: unknown, unit?: string) {
  const suffix = unit ? ` ${unit}` : "";
  const hasMin = typeof min === "number";
  const hasMax = typeof max === "number";
  if (hasMin && hasMax) {
    return min === max ? `exactly ${min}${suffix}` : `${min}–${max}${suffix}`;
  }
  if (hasMin) {
    return unit
      ? `at least ${plural(min, unit.replace(/s$/, ""))}`
      : `≥ ${min}`;
  }
  if (hasMax) {
    return unit ? `at most ${plural(max, unit.replace(/s$/, ""))}` : `≤ ${max}`;
  }
  return null;
}

function code(value: JsonValue) {
  return `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
}

/** Constraints in words: "1–80 characters", "one of `new`, `paid`", … */
function rulesOf(schema: JsonSchema): string {
  const { schema: inner } = unwrapNullable(schema);
  const rules = [
    Array.isArray(inner.enum)
      ? inner.enum.length === 1
        ? `always ${code(inner.enum[0] ?? null)}`
        : `one of ${inner.enum.map(code).join(", ")}`
      : null,
    "const" in inner ? `always ${code(inner.const ?? null)}` : null,
    range(inner.minLength, inner.maxLength, "characters"),
    range(inner.minimum, inner.maximum),
    typeof inner.exclusiveMinimum === "number"
      ? `> ${inner.exclusiveMinimum}`
      : null,
    typeof inner.exclusiveMaximum === "number"
      ? `< ${inner.exclusiveMaximum}`
      : null,
    range(inner.minItems, inner.maxItems, "items"),
    inner.uniqueItems === true ? "unique items" : null,
    typeof inner.pattern === "string" ? `pattern ${code(inner.pattern)}` : null,
    "default" in inner ? `default ${code(inner.default ?? null)}` : null,
  ];
  return rules.filter(Boolean).join("; ");
}

/** The first of `examples`, or `example` (the OpenAPI 3.0 keyword). */
function exampleOf(schema: JsonSchema): string {
  const { schema: inner } = unwrapNullable(schema);
  if (Array.isArray(inner.examples) && inner.examples.length > 0) {
    return code(inner.examples[0] ?? null);
  }
  return "example" in inner ? code(inner.example ?? null) : "";
}

function joinPath(prefix: string, name: string) {
  return prefix ? `${prefix}.${name}` : name;
}

/**
 * One row per field of a schema, nested fields included (`address.street`,
 * `lines[].qty`). Model references are expanded in place, except inside
 * themselves, where expanding would never end.
 */
export function fieldRows(
  schema: JsonSchema,
  context: FieldContext,
  prefix = "",
  expanding: readonly string[] = [],
): FieldRow[] {
  const { schema: inner } = unwrapNullable(schema);
  const model = referencedModel(inner, context);
  if (model) {
    return context.expand === false || expanding.includes(model.id)
      ? []
      : fieldRows(model.schema, context, prefix, [...expanding, model.id]);
  }
  if (inner.type === "array") {
    return fieldRows(asSchema(inner.items), context, `${prefix}[]`, expanding);
  }
  if (!isJsonObject(inner.properties)) {
    return [];
  }
  const required = Array.isArray(inner.required) ? inner.required : [];
  return Object.entries(inner.properties).flatMap(([name, value]) => {
    const property = asSchema(value);
    const field = joinPath(prefix, name);
    const description =
      typeof property.description === "string"
        ? property.description
        : String(unwrapNullable(property).schema.description ?? "");
    return [
      {
        field,
        type: typeLabel(property, context),
        required: required.includes(name),
        description: cell(description),
        rules: cell(rulesOf(property)),
        example: cell(exampleOf(property)),
      },
      ...fieldRows(property, context, field, expanding),
    ];
  });
}

// --- Files ------------------------------------------------------------------

/** GitHub-style heading anchor. */
export function anchorOf(heading: string) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9 _-]/g, "")
    .replace(/ /g, "-");
}

export function table(headers: string[], rows: string[][]) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ].join("\n");
}

export function fieldTable(rows: FieldRow[]) {
  return table(
    ["Field", "Type", "Required", "Description", "Rules"],
    rows.map((row) => [
      `\`${row.field}\``,
      row.type,
      row.required ? "Yes" : "",
      row.description,
      row.rules,
    ]),
  );
}

export function jsonBlock(value: JsonValue) {
  return ["```json", JSON.stringify(value, null, 2), "```"].join("\n");
}

/** Joins Markdown blocks with blank lines, skipping empty ones. */
export function blocks(...parts: (string | null | undefined | false)[]) {
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}
