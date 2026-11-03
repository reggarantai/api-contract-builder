import { describe, expect, it } from "vitest";
import { generateExample } from "./generate-example";
import type { JsonSchema } from "./json-schema";

const noModels = () => undefined;

describe("generateExample", () => {
  it("prefers examples, const, enum, and default", () => {
    expect(
      generateExample({ type: "string", examples: ["paid"] }, noModels),
    ).toBe("paid");
    expect(generateExample({ const: 3 }, noModels)).toBe(3);
    expect(
      generateExample({ type: "string", enum: ["new", "paid"] }, noModels),
    ).toBe("new");
    expect(generateExample({ type: "integer", default: 10 }, noModels)).toBe(
      10,
    );
  });

  it("uses formats for strings", () => {
    expect(generateExample({ type: "string", format: "email" }, noModels)).toBe(
      "user@example.com",
    );
    expect(
      generateExample({ type: "string", format: "date-time" }, noModels),
    ).toBe("2026-01-01T00:00:00Z");
    expect(generateExample({ type: "string" }, noModels)).toBe("string");
  });

  it("respects number bounds", () => {
    expect(generateExample({ type: "integer" }, noModels)).toBe(0);
    expect(generateExample({ type: "integer", minimum: 5 }, noModels)).toBe(5);
    expect(generateExample({ type: "number", maximum: -1 }, noModels)).toBe(-1);
  });

  it("builds objects and arrays, ignoring null in nullable types", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: ["string", "null"] },
        tags: { type: "array", items: { type: "boolean" }, minItems: 2 },
      },
    };

    expect(generateExample(schema, noModels)).toEqual({
      name: "string",
      tags: [true, true],
    });
  });

  it("resolves model references and stops at cycles", () => {
    const models: Record<string, JsonSchema> = {
      category: {
        type: "object",
        properties: {
          name: { type: "string" },
          parent: { anyOf: [{ $ref: "model:category" }, { type: "null" }] },
        },
      },
    };

    expect(
      generateExample({ $ref: "model:category" }, (id) => models[id]),
    ).toEqual({ name: "string", parent: null });
  });

  it("uses the first option of oneOf and anyOf", () => {
    expect(
      generateExample(
        { oneOf: [{ type: "integer" }, { type: "string" }] },
        noModels,
      ),
    ).toBe(0);
  });

  describe("with references that branch or lists that nest", () => {
    function values(value: unknown): number {
      if (Array.isArray(value)) {
        return (
          1 + value.reduce((total: number, item) => total + values(item), 0)
        );
      }
      if (value !== null && typeof value === "object") {
        return (
          1 +
          Object.values(value).reduce(
            (total: number, item) => total + values(item),
            0,
          )
        );
      }
      return 1;
    }

    it("stops at 10,000 values, however references branch", () => {
      const models = new Map<string, JsonSchema>();
      for (let index = 0; index < 20; index++) {
        const next = { $ref: `model:m${index + 1}` };
        models.set(`m${index}`, {
          type: "object",
          properties: { a: next, b: next, c: next },
        });
      }
      const value = generateExample({ $ref: "model:m0" }, (id) =>
        models.get(id),
      );
      expect(values(value)).toBeLessThanOrEqual(10_000);
    });

    it("counts every value, schemas that are true or false included", () => {
      // JSON Schema allows `true` for "anything"; each still adds a value.
      const inner = Object.fromEntries(
        Array.from({ length: 1000 }, (_, index) => [`f${index}`, true]),
      );
      const outer = Object.fromEntries(
        Array.from({ length: 1000 }, (_, index) => [
          `g${index}`,
          { $ref: "model:inner" },
        ]),
      );
      const value = generateExample(
        { type: "object", properties: outer },
        (id) =>
          id === "inner"
            ? ({ type: "object", properties: inner } as JsonSchema)
            : undefined,
      );
      expect(values(value)).toBeLessThanOrEqual(10_001);
    });

    /** An object of `count` properties, each a reference to `model`. */
    function manyRefs(count: number, model: string): JsonSchema {
      return {
        type: "object",
        properties: Object.fromEntries(
          Array.from({ length: count }, (_, index) => [
            `p${index}`,
            { $ref: `model:${model}` },
          ]),
        ),
      };
    }

    const large = "x".repeat(100_000);
    it.each([
      ["examples", { examples: [large] }],
      ["const", { const: { text: large } }],
      ["enum", { enum: [[large]] }],
      ["default", { default: large }],
    ])(
      "stops at about a million characters, however often a large %s value repeats",
      (_, schema) => {
        const value = generateExample(manyRefs(1000, "big"), (id) =>
          id === "big" ? (schema as JsonSchema) : undefined,
        );
        const length = JSON.stringify(value).length;
        expect(length).toBeGreaterThan(900_000);
        expect(length).toBeLessThan(1_100_000);
      },
    );

    it("counts the names of properties too", () => {
      const wide: JsonSchema = {
        type: "object",
        properties: { [large]: { type: "boolean" } },
      };
      const value = generateExample(manyRefs(1000, "wide"), (id) =>
        id === "wide" ? wide : undefined,
      );
      expect(JSON.stringify(value).length).toBeLessThan(1_100_000);
    });

    it("measures a large value once, past the limit, in objects and in lists", () => {
      const huge = {
        rows: Array.from({ length: 30_000 }, (_, index) => ({ index })),
      };
      const resolve = (id: string) =>
        id === "huge" ? { examples: [huge] } : undefined;
      // Lists repeat it with no property names to count: 5 × 5 × 5 × 5 × 5.
      let lists: JsonSchema = { $ref: "model:huge" };
      for (let level = 0; level < 5; level++) {
        lists = { type: "array", minItems: 5, items: lists };
      }
      const started = performance.now();
      generateExample(manyRefs(5000, "huge"), resolve);
      generateExample(lists, resolve);
      expect(performance.now() - started).toBeLessThan(1000);
    });

    it("stops at 10,000 values in lists of lists", () => {
      let schema: JsonSchema = { type: "string" };
      for (let index = 0; index < 8; index++) {
        schema = { type: "array", minItems: 5, items: schema };
      }
      expect(
        JSON.stringify(generateExample(schema, noModels)).length,
      ).toBeLessThan(200_000);
    });
  });
});
