import {
  isJsonObject,
  type JsonSchema,
  type JsonValue,
  modelIdOfRef,
  refsToModelIds,
} from "@shared/json-schema";

/**
 * Pure helpers the schema builder uses to read and edit JSON Schema in place.
 * Edits only touch the keywords they manage, so anything else in the schema
 * (keywords the builder doesn't know, `x-` extensions, …) is kept as is.
 */

export const SCHEMA_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "object",
  "array",
] as const;
export type SchemaType = (typeof SCHEMA_TYPES)[number];

/** How the builder sees a subschema. */
export type NodeInfo =
  | { kind: SchemaType; nullable: boolean }
  | { kind: "ref"; ref: string; modelId: string | null; nullable: boolean }
  /** No type: any JSON value. */
  | { kind: "any" }
  /** Uses JSON Schema features the builder can't edit (oneOf, …). */
  | { kind: "custom" };

/** Path from the root to a subschema, e.g. ["properties", "user", "items"]. */
export type SchemaPath = readonly string[];

const COMBINATOR_KEYWORDS = [
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "const",
];
const ANNOTATION_KEYWORDS = new Set([
  "description",
  "title",
  "examples",
  "default",
  "deprecated",
  "readOnly",
  "writeOnly",
]);

function isSchemaType(value: unknown): value is SchemaType {
  return SCHEMA_TYPES.includes(value as SchemaType);
}

function isOnlyRef(value: JsonValue | undefined): value is { $ref: string } {
  return (
    isJsonObject(value) &&
    typeof value.$ref === "string" &&
    Object.keys(value).length === 1
  );
}

function isOnlyNull(value: JsonValue | undefined) {
  return (
    isJsonObject(value) &&
    value.type === "null" &&
    Object.keys(value).length === 1
  );
}

/** The `$ref` of a nullable reference: `anyOf: [{ $ref }, { type: "null" }]`. */
function nullableRefOf(node: JsonSchema): string | null {
  const { anyOf } = node;
  if (!Array.isArray(anyOf) || anyOf.length !== 2) {
    return null;
  }
  const [first, second] = anyOf;
  if (isOnlyRef(first) && isOnlyNull(second)) {
    return first.$ref;
  }
  if (isOnlyNull(first) && isOnlyRef(second)) {
    return second.$ref;
  }
  return null;
}

function refInfo(ref: string, nullable: boolean): NodeInfo {
  return { kind: "ref", ref, modelId: modelIdOfRef(ref), nullable };
}

export function describeNode(node: JsonValue | undefined): NodeInfo {
  if (!isJsonObject(node)) {
    return { kind: "custom" };
  }
  if (typeof node.$ref === "string") {
    return refInfo(node.$ref, false);
  }
  const nullableRef = nullableRefOf(node);
  if (nullableRef !== null) {
    return refInfo(nullableRef, true);
  }
  if (COMBINATOR_KEYWORDS.some((keyword) => keyword in node)) {
    return { kind: "custom" };
  }

  const { type } = node;
  if (type === undefined) {
    const onlyAnnotations = Object.keys(node).every(
      (key) => ANNOTATION_KEYWORDS.has(key) || key.startsWith("x-"),
    );
    return onlyAnnotations ? { kind: "any" } : { kind: "custom" };
  }
  if (isSchemaType(type)) {
    return { kind: type, nullable: false };
  }
  if (Array.isArray(type) && type.length === 2 && type.includes("null")) {
    const other = type.find((item) => item !== "null");
    if (isSchemaType(other)) {
      return { kind: other, nullable: true };
    }
  }
  return { kind: "custom" };
}

function isNullable(info: NodeInfo) {
  return "nullable" in info && info.nullable;
}

export function getAt(
  root: JsonSchema,
  path: SchemaPath,
): JsonValue | undefined {
  let node: JsonValue | undefined = root;
  for (const segment of path) {
    node = isJsonObject(node) ? node[segment] : undefined;
  }
  return node;
}

/** Returns a copy of `root` with the subschema at `path` replaced by `update(node)`. */
export function updateAt(
  root: JsonSchema,
  path: SchemaPath,
  update: (node: JsonValue | undefined) => JsonValue,
): JsonSchema {
  if (path.length === 0) {
    const updated = update(root);
    return isJsonObject(updated) ? updated : root;
  }
  const [head, ...rest] = path as [string, ...string[]];
  const child = root[head];
  return {
    ...root,
    [head]:
      rest.length === 0
        ? update(child)
        : updateAt(isJsonObject(child) ? child : {}, rest, update),
  };
}

/** Sets a keyword, or removes it when `value` is undefined. */
export function setKeyword(
  node: JsonSchema,
  keyword: string,
  value: JsonValue | undefined,
): JsonSchema {
  if (value === undefined) {
    const { [keyword]: _removed, ...rest } = node;
    return rest;
  }
  return { ...node, [keyword]: value };
}

/** What a field can be switched to in the builder. */
export type KindTarget = SchemaType | "any" | { ref: string };

/**
 * Switches a subschema to another type. Keeps the description and whether
 * it's nullable; drops keywords that belonged to the old type.
 */
export function changeKind(
  node: JsonValue | undefined,
  target: KindTarget,
): JsonSchema {
  const info = describeNode(node);
  const nullable = isNullable(info);
  const kept: JsonSchema =
    isJsonObject(node) && typeof node.description === "string"
      ? { description: node.description }
      : {};

  if (target === "any") {
    return kept;
  }
  if (typeof target === "object") {
    return nullable
      ? { ...kept, anyOf: [{ $ref: target.ref }, { type: "null" }] }
      : { ...kept, $ref: target.ref };
  }

  const typed: JsonSchema = {
    ...kept,
    type: nullable ? [target, "null"] : target,
  };
  if (target === "object") {
    typed.properties = {};
  } else if (target === "array") {
    typed.items = { type: "string" };
  }
  return typed;
}

export function setNullable(node: JsonSchema, nullable: boolean): JsonSchema {
  const info = describeNode(node);
  if (info.kind === "ref") {
    if (nullable === info.nullable) {
      return node;
    }
    const { $ref: _ref, anyOf: _anyOf, ...rest } = node;
    return nullable
      ? { ...rest, anyOf: [{ $ref: info.ref }, { type: "null" }] }
      : { ...rest, $ref: info.ref };
  }
  if (isSchemaType(info.kind)) {
    return { ...node, type: nullable ? [info.kind, "null"] : info.kind };
  }
  return node;
}

// --- Object properties ------------------------------------------------------

function propertiesOf(node: JsonValue | undefined): JsonSchema {
  return isJsonObject(node) && isJsonObject(node.properties)
    ? node.properties
    : {};
}

function requiredOf(node: JsonValue | undefined): string[] {
  return isJsonObject(node) && Array.isArray(node.required)
    ? node.required.filter((name): name is string => typeof name === "string")
    : [];
}

function withRequired(node: JsonSchema, required: string[]): JsonSchema {
  return setKeyword(
    node,
    "required",
    required.length > 0 ? required : undefined,
  );
}

export function propertyNames(node: JsonValue | undefined): string[] {
  return Object.keys(propertiesOf(node));
}

export function isRequired(node: JsonValue | undefined, name: string) {
  return requiredOf(node).includes(name);
}

/** "field", or "field2", "field3", … when taken. */
export function uniquePropertyName(
  node: JsonValue | undefined,
  base = "field",
) {
  const names = new Set(propertyNames(node));
  if (!names.has(base)) {
    return base;
  }
  for (let n = 2; ; n++) {
    if (!names.has(`${base}${n}`)) {
      return `${base}${n}`;
    }
  }
}

export function addProperty(
  node: JsonSchema,
  name: string,
  schema: JsonSchema = { type: "string" },
): JsonSchema {
  return { ...node, properties: { ...propertiesOf(node), [name]: schema } };
}

/** Renames a property in place, keeping its position and required flag. */
export function renameProperty(
  node: JsonSchema,
  from: string,
  to: string,
): JsonSchema {
  if (from === to) {
    return node;
  }
  const properties = Object.fromEntries(
    Object.entries(propertiesOf(node)).map(([name, schema]) => [
      name === from ? to : name,
      schema,
    ]),
  );
  const required = requiredOf(node).map((name) => (name === from ? to : name));
  return withRequired({ ...node, properties }, required);
}

export function removeProperty(node: JsonSchema, name: string): JsonSchema {
  const { [name]: _removed, ...properties } = propertiesOf(node);
  return withRequired(
    { ...node, properties },
    requiredOf(node).filter((required) => required !== name),
  );
}

export function moveProperty(
  node: JsonSchema,
  name: string,
  offset: -1 | 1,
): JsonSchema {
  const entries = Object.entries(propertiesOf(node));
  const from = entries.findIndex(([key]) => key === name);
  const to = from + offset;
  if (from === -1 || to < 0 || to >= entries.length) {
    return node;
  }
  const [moved] = entries.splice(from, 1);
  if (moved) {
    entries.splice(to, 0, moved);
  }
  return { ...node, properties: Object.fromEntries(entries) };
}

export function setRequired(
  node: JsonSchema,
  name: string,
  required: boolean,
): JsonSchema {
  const current = requiredOf(node).filter((item) => item !== name);
  return withRequired(node, required ? [...current, name] : current);
}

// --- Examples ---------------------------------------------------------------

export function exampleOf(node: JsonValue | undefined): JsonValue | undefined {
  return isJsonObject(node) && Array.isArray(node.examples)
    ? node.examples[0]
    : undefined;
}

/** Sets the first entry of `examples` (OpenAPI 3.1 style), keeping any others. */
export function setExample(
  node: JsonSchema,
  value: JsonValue | undefined,
): JsonSchema {
  const rest = Array.isArray(node.examples) ? node.examples.slice(1) : [];
  const examples = value === undefined ? rest : [value, ...rest];
  return setKeyword(
    node,
    "examples",
    examples.length > 0 ? examples : undefined,
  );
}

// --- Summary ----------------------------------------------------------------

function numberKeyword(node: JsonSchema, keyword: string) {
  const value = node[keyword];
  return typeof value === "number" ? value : undefined;
}

function rangeText(
  min: number | undefined,
  max: number | undefined,
  unit?: string,
) {
  const suffix = unit ? ` ${unit}` : "";
  if (min !== undefined && max !== undefined) {
    return min === max ? `${min}${suffix}` : `${min}–${max}${suffix}`;
  }
  if (min !== undefined) {
    return `≥ ${min}${suffix}`;
  }
  if (max !== undefined) {
    return `≤ ${max}${suffix}`;
  }
  return null;
}

/** Short labels for the constraints set on a subschema, shown next to its type. */
export function summarizeNode(node: JsonValue | undefined): string[] {
  const info = describeNode(node);
  if (!isJsonObject(node)) {
    return [];
  }
  const labels: string[] = [];
  if (isNullable(info)) {
    labels.push("nullable");
  }
  if (typeof node.format === "string") {
    labels.push(node.format);
  }
  if (Array.isArray(node.enum)) {
    const [only] = node.enum;
    labels.push(
      node.enum.length === 1
        ? `always ${typeof only === "string" ? only : JSON.stringify(only)}`
        : `${node.enum.length} values`,
    );
  }
  const ranges = [
    rangeText(
      numberKeyword(node, "minLength"),
      numberKeyword(node, "maxLength"),
      "chars",
    ),
    rangeText(numberKeyword(node, "minimum"), numberKeyword(node, "maximum")),
    rangeText(
      numberKeyword(node, "minItems"),
      numberKeyword(node, "maxItems"),
      "items",
    ),
  ];
  for (const range of ranges) {
    if (range) {
      labels.push(range);
    }
  }
  if (node.uniqueItems === true) {
    labels.push("unique");
  }
  if (typeof node.pattern === "string") {
    labels.push("pattern");
  }
  return labels;
}

// --- JSON mode --------------------------------------------------------------

/**
 * Parses the JSON editor's text. References are written as
 * `#/components/schemas/<Model name>` there and stored as `model:<id>`.
 */
export function parseSchemaJson(
  text: string,
  modelIdOf: (name: string) => string | undefined,
): { schema: JsonSchema } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { error: `Invalid JSON: ${(error as Error).message}` };
  }
  if (!isJsonObject(parsed)) {
    return { error: "The schema must be a JSON object" };
  }
  const { schema, unknownNames } = refsToModelIds(parsed, modelIdOf);
  if (unknownNames.length > 0) {
    return {
      error: `Unknown model${unknownNames.length > 1 ? "s" : ""}: ${unknownNames.join(", ")}`,
    };
  }
  return { schema };
}

// --- Detail inputs ----------------------------------------------------------

/** Result of parsing a text input; `value: undefined` removes the keyword. */
export type ParsedInput = { value: JsonValue | undefined } | { error: string };

export function parseNumberInput(
  text: string,
  { nonNegativeInteger = false } = {},
): ParsedInput {
  const trimmed = text.trim();
  if (trimmed === "") {
    return { value: undefined };
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return { error: "Enter a number" };
  }
  if (nonNegativeInteger && (!Number.isInteger(value) || value < 0)) {
    return { error: "Enter a whole number, 0 or more" };
  }
  return { value };
}

export function parseJsonInput(text: string): ParsedInput {
  if (text.trim() === "") {
    return { value: undefined };
  }
  try {
    return { value: JSON.parse(text) as JsonValue };
  } catch {
    return { error: 'Enter valid JSON, e.g. 42, true, or {"a": 1}' };
  }
}

export function parsePatternInput(text: string): ParsedInput {
  if (text === "") {
    return { value: undefined };
  }
  try {
    new RegExp(text, "u");
    return { value: text };
  } catch {
    return { error: "Not a valid regular expression" };
  }
}

/** One value per line; numbers for numeric types. */
export function parseEnumInput(text: string, numeric: boolean): ParsedInput {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (lines.length === 0) {
    return { value: undefined };
  }
  if (!numeric) {
    return { value: lines };
  }
  const numbers = lines.map(Number);
  return numbers.every(Number.isFinite)
    ? { value: numbers }
    : { error: "Enter one number per line" };
}

/** Text for an input showing `value`, the inverse of the parsers above. */
export function formatInput(
  value: JsonValue | undefined,
  as: "text" | "json" | "lines",
) {
  if (value === undefined) {
    return "";
  }
  if (as === "lines" && Array.isArray(value)) {
    return value.map((item) => String(item)).join("\n");
  }
  return as === "json" ? JSON.stringify(value) : String(value);
}
