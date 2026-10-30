import { describe, expect, it } from "vitest";
import {
  collectRefs,
  type JsonSchema,
  refsToComponentNames,
  refsToModelIds,
} from "./json-schema";

const stored: JsonSchema = {
  type: "object",
  properties: {
    customer: { $ref: "model:c1" },
    items: { type: "array", items: { $ref: "model:i1" } },
    // A property named like a data keyword is still a subschema.
    examples: { $ref: "model:c1" },
    note: {
      anyOf: [{ $ref: "model:c1" }, { type: "null" }],
      // Data keywords hold values, not references.
      examples: [{ $ref: "model:c1" }],
    },
  },
  "x-vendor": "kept",
};

describe("refs", () => {
  it("collects references from subschemas only", () => {
    expect(collectRefs(stored)).toEqual([
      "model:c1",
      "model:i1",
      "model:c1",
      "model:c1",
    ]);
  });

  it("converts model IDs to component names and back without loss", () => {
    const names = new Map([
      ["c1", "Customer"],
      ["i1", "Item"],
    ]);
    const ids = new Map([...names].map(([id, name]) => [name, id]));

    const display = refsToComponentNames(stored, (id) => names.get(id));
    expect(collectRefs(display)).toEqual([
      "#/components/schemas/Customer",
      "#/components/schemas/Item",
      "#/components/schemas/Customer",
      "#/components/schemas/Customer",
    ]);

    const back = refsToModelIds(display, (name) => ids.get(name));
    expect(back.unknownNames).toEqual([]);
    expect(back.schema).toEqual(stored);
  });

  it("reports component names without a model", () => {
    const result = refsToModelIds(
      { $ref: "#/components/schemas/Missing" },
      () => undefined,
    );

    expect(result.unknownNames).toEqual(["Missing"]);
  });
});
