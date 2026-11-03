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

describe("fieldRows with references that branch", () => {
  // Each model refers twice to the next: all of it would double per model.
  function chain(length: number) {
    const chained: Record<string, { name: string; schema: JsonSchema }> = {};
    for (let index = 0; index < length; index++) {
      const next: JsonSchema =
        index + 1 < length
          ? { $ref: `model:m${index + 1}` }
          : { type: "string" };
      chained[`m${index}`] = {
        name: `M${index}`,
        schema: { type: "object", properties: { left: next, right: next } },
      };
    }
    return chained;
  }

  it("expands at most 500 rows of models in a table, and says the rest is in models.md", () => {
    const chained = chain(14);
    let lookups = 0;
    const counting = {
      model: (id: string) => {
        lookups++;
        return chained[id];
      },
      modelLink: (name: string) => `../models.md#${name.toLowerCase()}`,
    };

    const result = fieldRows({ $ref: "model:m0" }, counting);

    // Each model's first expansion (14 × 2 rows), 500 rows of models shown
    // again, and the last row.
    expect(result.length).toBeLessThanOrEqual(28 + 500 + 1);
    expect(result.at(-1)).toEqual({
      field: "…",
      type: "",
      required: false,
      description: "More fields of the models above are in models.md",
      rules: "",
      example: "",
    });
    // The work stops too, not only the table.
    expect(lookups).toBeLessThan(2000);
  });

  it("lists every field of models a table shows once, however many", () => {
    // 30 properties, each a different model of 20 fields: 630 rows.
    const distinct: Record<string, { name: string; schema: JsonSchema }> = {};
    for (let index = 0; index < 30; index++) {
      distinct[`d${index}`] = {
        name: `D${index}`,
        schema: {
          type: "object",
          properties: Object.fromEntries(
            Array.from({ length: 20 }, (_, field) => [
              `f${field}`,
              { type: "string" },
            ]),
          ),
        },
      };
    }
    const lookup = {
      model: (id: string) => distinct[id],
      modelLink: (name: string) => `../models.md#${name.toLowerCase()}`,
    };
    const body: JsonSchema = {
      type: "object",
      properties: Object.fromEntries(
        Object.keys(distinct).map((id) => [id, { $ref: `model:${id}` }]),
      ),
    };

    const rows = fieldRows(body, lookup);
    expect(rows).toHaveLength(630);
    expect(rows.at(-1)?.field).toBe("d29.f19");

    // One model of 600 fields, as a whole body.
    distinct.wide = {
      name: "Wide",
      schema: {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: 600 }, (_, field) => [
            `f${field}`,
            { type: "string" },
          ]),
        ),
      },
    };
    expect(fieldRows({ $ref: "model:wide" }, lookup)).toHaveLength(600);
  });

  it("stops a long chain of models before expanding it would run out of stack", () => {
    const lookupOf = (
      chained: Record<string, { name: string; schema: JsonSchema }>,
    ) => ({
      model: (id: string) => chained[id],
      modelLink: (name: string) => `../models.md#${name.toLowerCase()}`,
    });
    const last = {
      field: "…",
      type: "",
      required: false,
      description: "More fields of the models above are in models.md",
      rules: "",
      example: "",
    };
    // Each model refers once to the next: nothing repeats, but it goes deep.
    const chain: Record<string, { name: string; schema: JsonSchema }> = {};
    // Each model nests its reference in lists, which add no rows.
    const lists: Record<string, { name: string; schema: JsonSchema }> = {};
    for (let index = 0; index < 5000; index++) {
      const next = { $ref: `model:c${index + 1}` };
      chain[`c${index}`] = {
        name: `C${index}`,
        schema: { type: "object", properties: { next } },
      };
      let schema: JsonSchema = next;
      for (let level = 0; level < 50; level++) {
        schema = { type: "array", items: schema };
      }
      lists[`c${index}`] = { name: `C${index}`, schema };
    }

    const rows = fieldRows({ $ref: "model:c0" }, lookupOf(chain));
    expect(rows.length).toBeLessThan(600);
    expect(rows.at(-1)).toEqual(last);
    expect(fieldRows({ $ref: "model:c0" }, lookupOf(lists))).toEqual([last]);
  });

  it("lists every field of a model's own schema, however many", () => {
    const properties = Object.fromEntries(
      Array.from({ length: 700 }, (_, index) => [
        `f${index}`,
        { type: "string" },
      ]),
    );
    expect(fieldRows({ type: "object", properties }, context)).toHaveLength(
      700,
    );
  });
});
