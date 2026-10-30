import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../../shared/json-schema";
import { type FieldRow, fieldRows, typeLabel } from "./markdown";

const models: Record<string, { name: string; schema: JsonSchema }> = {
  category: {
    name: "Category",
    schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        parent: { anyOf: [{ $ref: "model:category" }, { type: "null" }] },
      },
    },
  },
  stock: {
    name: "Stock",
    schema: {
      type: "object",
      required: ["sku"],
      properties: {
        sku: { type: "string" },
        category: { $ref: "model:category" },
      },
    },
  },
};

const context = {
  model: (id: string) => models[id],
  modelLink: (name: string) => `../models.md#${name.toLowerCase()}`,
};

function rows(schema: JsonSchema): string[][] {
  return fieldRows(schema, context).map((row: FieldRow) => [
    row.field,
    row.type,
    row.required ? "Yes" : "",
    row.description,
    row.rules,
  ]);
}

describe("fieldRows", () => {
  it("flattens nested objects and arrays into field paths", () => {
    expect(
      rows({
        type: "object",
        required: ["id"],
        properties: {
          id: { type: "string", format: "uuid", description: "Item ID" },
          tags: { type: "array", items: { type: "string" }, uniqueItems: true },
          address: {
            type: "object",
            properties: { street: { type: "string" } },
          },
          lines: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["qty"],
              properties: { qty: { type: "integer", minimum: 1 } },
            },
          },
        },
      }),
    ).toEqual([
      ["id", "string (uuid)", "Yes", "Item ID", ""],
      ["tags", "array of string", "", "", "unique items"],
      ["address", "object", "", "", ""],
      ["address.street", "string", "", "", ""],
      ["lines", "array of object", "", "", "at least 1 item"],
      ["lines[].qty", "integer", "Yes", "", "≥ 1"],
    ]);
  });

  it("describes nullability, allowed values, lengths, and patterns", () => {
    expect(
      rows({
        type: "object",
        properties: {
          status: { type: ["string", "null"], enum: ["new", "paid"] },
          name: { type: "string", minLength: 1, maxLength: 80 },
          code: { type: "string", pattern: "^[A-Z]+$" },
          price: { type: "number", minimum: 0, maximum: 100, examples: [9.5] },
          scheme: { type: "string", enum: ["Bearer"] },
        },
      }),
    ).toEqual([
      ["status", "string or null", "", "", "one of `new`, `paid`"],
      ["name", "string", "", "", "1–80 characters"],
      ["code", "string", "", "", "pattern `^[A-Z]+$`"],
      ["price", "number", "", "", "0–100"],
      ["scheme", "string", "", "", "always `Bearer`"],
    ]);
  });

  it("mentions defaults among the rules and keeps the first example", () => {
    const [page, cursor, legacy] = fieldRows(
      {
        type: "object",
        properties: {
          page: { type: "integer", minimum: 1, default: 1, examples: [2, 3] },
          cursor: { type: "string", examples: ["a|b"] },
          legacy: { type: "boolean", example: true },
        },
      },
      context,
    );

    expect(page).toMatchObject({ rules: "≥ 1; default `1`", example: "`2`" });
    expect(cursor?.example).toBe("`a\\|b`");
    expect(legacy?.example).toBe("`true`");
  });

  it("expands model references in place, linking to the model, and stops at cycles", () => {
    expect(rows({ $ref: "model:stock" })).toEqual([
      ["sku", "string", "Yes", "", ""],
      ["category", "[Category](../models.md#category)", "", "", ""],
      ["category.name", "string", "", "", ""],
      [
        "category.parent",
        "[Category](../models.md#category) or null",
        "",
        "",
        "",
      ],
    ]);
  });

  it("prefixes the fields of a root array with []", () => {
    expect(rows({ type: "array", items: { $ref: "model:stock" } })).toEqual([
      ["[].sku", "string", "Yes", "", ""],
      ["[].category", "[Category](../models.md#category)", "", "", ""],
      ["[].category.name", "string", "", "", ""],
      [
        "[].category.parent",
        "[Category](../models.md#category) or null",
        "",
        "",
        "",
      ],
    ]);
  });

  it("keeps table cells on one line and escapes pipes", () => {
    expect(
      rows({
        type: "object",
        properties: { note: { type: "string", description: "a | b\nc" } },
      }),
    ).toEqual([["note", "string", "", "a \\| b c", ""]]);
  });
});

describe("typeLabel", () => {
  it.each<[JsonSchema, string]>([
    [
      { type: "array", items: { $ref: "model:stock" } },
      "array of [Stock](../models.md#stock)",
    ],
    [{ type: ["integer", "null"] }, "integer or null"],
    [
      { oneOf: [{ type: "string" }, { type: "integer" }] },
      "one of string, integer",
    ],
    [{}, "any"],
  ])("%j → %s", (schema, label) => {
    expect(typeLabel(schema, context)).toBe(label);
  });
});

describe("fieldRows without expanding", () => {
  it("links referenced models without repeating their fields", () => {
    const linkOnly = {
      ...context,
      modelLink: (name: string) => `#${name.toLowerCase()}`,
      expand: false,
    };

    expect(
      fieldRows(models.stock?.schema ?? {}, linkOnly).map((row) => [
        row.field,
        row.type,
      ]),
    ).toEqual([
      ["sku", "string"],
      ["category", "[Category](#category)"],
    ]);
  });
});
