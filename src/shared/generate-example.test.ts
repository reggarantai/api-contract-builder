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
});
