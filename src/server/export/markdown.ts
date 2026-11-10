import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  MAX_NESTING,
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
    // As written, though not every item is a type name: what join() always
    // made of each, and JSON for one whose text can't be had.
    return type.map(asWritten).join(" or ");
  }
  return isJsonObject(schema.properties) ? "object" : "any";
}

/** A value as join() and String() write it, or as JSON when that throws (`{"toString": 1}`). */
function asWritten(value: unknown) {
  if (value === null || value === undefined) return "";
  try {
    return String(value);
  } catch {
    return JSON.stringify(value);
  }
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

/** About the most Markdown text one bundle holds. */
export const MAX_MARKDOWN_TEXT = 128 * 1024 * 1024;

/** A bundle whose text would grow past MAX_MARKDOWN_TEXT. */
export class MarkdownTooLargeError extends Error {
  constructor() {
    super(
      `This contract is too large to export as Markdown: its files would hold more than ${MAX_MARKDOWN_TEXT / (1024 * 1024)} MB of text.`,
    );
  }
}

// Page files stand alone, so each repeats the endpoints it calls, and a small
// project can ask for far more text than it holds. Text is counted where it's
// made (table rows, examples, endpoint sections, files), so a bundle that
// grows too large stops early. A piece is counted at most three times on its
// way into a file, which the budget allows for.
let textBudget: { left: number } | undefined;

/** Runs `build` with the bundle's text budget. */
export function withTextBudget<T>(
  build: () => T,
  /** Characters it may count; a piece is counted up to three times. */
  budget = 3 * MAX_MARKDOWN_TEXT,
): T {
  const outer = textBudget;
  textBudget = { left: budget };
  try {
    return build();
  } finally {
    textBudget = outer;
  }
}

function spendChars(count: number) {
  if (textBudget) {
    textBudget.left -= count;
    if (textBudget.left < 0) {
      throw new MarkdownTooLargeError();
    }
  }
}

/** The text, counted against the bundle's budget. */
export function spendText(text: string) {
  spendChars(text.length);
  return text;
}

/**
 * Rows of models a table already showed, at most. Models that refer to each
 * other many times, without a cycle, would otherwise multiply the rows (and
 * the work) with every model. A model's first expansion in a table doesn't
 * count, so a table that shows each model once is never cut.
 */
const MAX_REPEATED_ROWS = 500;

/**
 * Levels a table goes into, across the models it expands: one schema nests
 * at most MAX_NESTING levels, but a chain of models, each referring to the
 * next, could go on until expanding ran out of stack (a few thousand levels
 * down). Twice a schema's limit, so only such chains reach it.
 */
const MAX_TABLE_DEPTH = 2 * MAX_NESTING;

type ExpansionBudget = {
  left: number;
  stopped: boolean;
  /** Models expanded in the table so far. */
  expanded: Set<string>;
};

/**
 * One row per field of a schema, nested fields included (`address.street`,
 * `lines[].qty`). Model references are expanded in place, except inside
 * themselves, where expanding would never end, and past 500 rows of models
 * the table already showed, where a last row says the rest is in models.md.
 */
export function fieldRows(
  schema: JsonSchema,
  context: FieldContext,
  prefix = "",
  expanding: readonly string[] = [],
): FieldRow[] {
  const budget = {
    left: MAX_REPEATED_ROWS,
    stopped: false,
    expanded: new Set<string>(),
  };
  const rows = rowsOf(schema, context, prefix, expanding, budget, false, 0);
  return budget.stopped
    ? [
        ...rows,
        {
          field: "…",
          type: "",
          required: false,
          description: "More fields of the models above are in models.md",
          rules: "",
          example: "",
        },
      ]
    : rows;
}

/**
 * `repeated`: inside a model the table already showed, where rows count.
 * `depth`: how many levels the table has gone into.
 */
function rowsOf(
  schema: JsonSchema,
  context: FieldContext,
  prefix: string,
  expanding: readonly string[],
  budget: ExpansionBudget,
  repeated: boolean,
  depth: number,
): FieldRow[] {
  if (depth > MAX_TABLE_DEPTH) {
    budget.stopped = true;
    return [];
  }
  const { schema: inner } = unwrapNullable(schema);
  const model = referencedModel(inner, context);
  if (model) {
    if (context.expand === false || expanding.includes(model.id)) {
      return [];
    }
    const again = repeated || budget.expanded.has(model.id);
    if (again && budget.left <= 0) {
      budget.stopped = true;
      return [];
    }
    budget.expanded.add(model.id);
    return rowsOf(
      model.schema,
      context,
      prefix,
      [...expanding, model.id],
      budget,
      again,
      depth + 1,
    );
  }
  if (inner.type === "array") {
    return rowsOf(
      asSchema(inner.items),
      context,
      `${prefix}[]`,
      expanding,
      budget,
      repeated,
      depth + 1,
    );
  }
  if (!isJsonObject(inner.properties)) {
    return [];
  }
  const requiredNames = new Set(
    Array.isArray(inner.required) ? inner.required : [],
  );
  const rows: FieldRow[] = [];
  for (const [name, value] of Object.entries(inner.properties)) {
    if (repeated) {
      if (budget.left <= 0) {
        budget.stopped = true;
        break;
      }
      budget.left--;
    }
    const property = asSchema(value);
    const field = joinPath(prefix, name);
    const inner = unwrapNullable(property).schema.description;
    let description: string;
    if (typeof property.description === "string") {
      description = property.description;
    } else {
      // As String() always wrote it, and nothing when it throws.
      try {
        description = String(inner ?? "");
      } catch {
        description = "";
      }
    }
    const row = {
      field,
      type: typeLabel(property, context),
      required: requiredNames.has(name),
      description: cell(description),
      rules: cell(rulesOf(property)),
      example: cell(exampleOf(property)),
    };
    spendChars(
      row.field.length +
        row.type.length +
        row.description.length +
        row.rules.length +
        row.example.length,
    );
    rows.push(
      row,
      ...rowsOf(
        property,
        context,
        field,
        expanding,
        budget,
        repeated,
        depth + 1,
      ),
    );
  }
  return rows;
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
  return spendText(
    ["```json", JSON.stringify(value, null, 2), "```"].join("\n"),
  );
}

/** Joins Markdown blocks with blank lines, skipping empty ones. */
export function blocks(...parts: (string | null | undefined | false)[]) {
  return `${parts.filter(Boolean).join("\n\n")}\n`;
}
