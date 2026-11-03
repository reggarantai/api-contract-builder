import { describe, expect, it } from "vitest";
import {
  collectRefs,
  type JsonSchema,
  type JsonValue,
  MAX_NESTING,
  mapRefs,
  modelRefIssues,
  nestingIssues,
  nestsDeeperThan,
  refsToComponentNames,
  refsToModelIds,
  replaceRefsInPlace,
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

  it("keeps keys named like the object prototype as data", () => {
    // JSON.parse makes "__proto__" an own key; assigning it would set the
    // prototype instead and drop the key.
    const schema = JSON.parse(
      '{"__proto__": {"$ref": "model:a"}, "properties": {"__proto__": {"$ref": "model:a"}}}',
    ) as JsonSchema;

    const mapped = mapRefs(schema, (ref) => ref.replace("model:a", "model:b"));

    expect(Object.getPrototypeOf(mapped)).toBe(Object.prototype);
    expect(JSON.stringify(mapped)).toBe(
      '{"__proto__":{"$ref":"model:b"},"properties":{"__proto__":{"$ref":"model:b"}}}',
    );
  });
});

describe("modelRefIssues", () => {
  const ids = new Set(["m1"]);

  it("accepts references to the project's models and local ones", () => {
    expect(
      modelRefIssues(
        {
          type: "object",
          properties: {
            a: { $ref: "model:m1" },
            b: { $ref: "#/$defs/b" },
            c: { examples: [{ $ref: "https://example.com/x" }] },
          },
          $defs: { b: { type: "string" } },
        },
        ids,
        "schema",
      ),
    ).toEqual([]);
  });

  it("reports missing models and references it can't follow, once each", () => {
    expect(
      modelRefIssues(
        {
          anyOf: [
            { $ref: "model:gone" },
            { $ref: "model:gone" },
            { $ref: "#/components/schemas/User" },
            { $ref: "https://example.com/schema.json" },
          ],
        },
        ids,
        "body.schema",
      ),
    ).toEqual([
      {
        path: "body.schema",
        message: "References a model that doesn't exist: model:gone",
      },
      {
        path: "body.schema",
        message:
          'Unsupported reference "#/components/schemas/User"; reference a model of this project instead',
      },
      {
        path: "body.schema",
        message:
          'Unsupported reference "https://example.com/schema.json"; reference a model of this project instead',
      },
    ]);
  });

  it("refuses a schema nested more than 256 levels deep, before following it", () => {
    const deep = (levels: number) => {
      let schema: JsonSchema = { $ref: "model:m1" };
      for (let level = 1; level < levels; level++) {
        schema = { type: "array", items: schema };
      }
      return schema;
    };
    const tooDeep = [
      {
        path: "schema",
        message: "This schema is nested more than 256 levels deep",
      },
    ];
    expect(modelRefIssues(deep(256), ids, "schema")).toEqual([]);
    expect(modelRefIssues(deep(257), ids, "schema")).toEqual(tooDeep);
    // Far past where following references would run out of stack.
    expect(modelRefIssues(deep(200_000), ids, "schema")).toEqual(tooDeep);
  });

  it("only counts the model IDs it's given, not names on Object.prototype", () => {
    expect(
      modelRefIssues({ $ref: "model:constructor" }, new Set(), "schema"),
    ).toHaveLength(1);
  });
});

describe("walking references without copying", () => {
  /** What mapRefs, which copies, sees: the reference of record. */
  function refsSeenByMapRefs(schema: JsonSchema) {
    const refs: string[] = [];
    mapRefs(schema, (ref) => {
      refs.push(ref);
      return ref;
    });
    return refs;
  }

  const schemas: JsonSchema[] = [
    stored,
    {
      $ref: "model:a",
      properties: {
        $ref: { $ref: "model:b" },
        examples: { items: [{ $ref: "model:c" }] },
      },
      $defs: { x: { $ref: "model:d" }, y: "not a schema" },
      allOf: [{ $ref: "model:e" }, [{ $ref: "model:f" }]],
      default: { $ref: "model:data" },
      enum: [{ $ref: "model:data" }],
      const: { $ref: "model:data" },
      example: { $ref: "model:data" },
      examples: [{ $ref: "model:data" }],
      dependentSchemas: { a: { $ref: "model:g" } },
      patternProperties: { "^x": { $ref: "model:h" } },
      definitions: { z: { not: { $ref: "model:i" } } },
      if: { $ref: 3 as unknown as JsonValue },
    },
    JSON.parse(
      '{"__proto__": {"$ref": "model:p"}, "items": {"$ref": "model:q"}}',
    ),
  ];

  it("finds the references mapRefs finds, in the same order", () => {
    for (const schema of schemas) {
      expect(collectRefs(schema)).toEqual(refsSeenByMapRefs(schema));
    }
  });

  it("replaces references in place, leaving data alone", () => {
    const schema = structuredClone(schemas[1]) as JsonSchema;
    const expected = mapRefs(schema, (ref) => `${ref}!`);

    replaceRefsInPlace(schema, (ref) => `${ref}!`);

    expect(schema).toEqual(expected);
    expect(JSON.stringify(schema)).toContain('"default":{"$ref":"model:data"}');
  });
});

describe("nesting", () => {
  /** A value `levels` deep: lists in lists around a number. */
  function nested(levels: number): JsonValue {
    let value: JsonValue = 0;
    for (let level = 0; level < levels; level++) {
      value = [value];
    }
    return value;
  }

  it("counts the levels of objects and lists, the value itself the first", () => {
    expect(nestsDeeperThan("text", 0)).toBe(false);
    expect(nestsDeeperThan({}, 0)).toBe(true);
    expect(nestsDeeperThan({}, 1)).toBe(false);
    expect(nestsDeeperThan({ a: [1, { b: null }] }, 3)).toBe(false);
    expect(nestsDeeperThan({ a: [1, { b: {} }] }, 3)).toBe(true);
    expect(nestsDeeperThan(nested(256), 256)).toBe(false);
    expect(nestsDeeperThan(nested(257), 256)).toBe(true);
  });

  it("finds the deep part anywhere, without running out of stack", () => {
    expect(nestsDeeperThan({ a: 1, b: [2, nested(300)] }, 256)).toBe(true);
    expect(nestsDeeperThan([nested(10), nested(1_000_000)], 256)).toBe(true);
    // A key named __proto__ is data like any other.
    expect(nestsDeeperThan(JSON.parse('{"__proto__": [[[]]]}'), 3)).toBe(true);
  });

  it("is quick on wide values", () => {
    const wide = Array.from({ length: 200_000 }, (_, index) => ({
      [`k${index}`]: [index, { x: [null] }],
    }));
    const started = performance.now();
    expect(nestsDeeperThan(wide, MAX_NESTING)).toBe(false);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("names schemas and examples nested more than 256 levels deep", () => {
    expect(MAX_NESTING).toBe(256);
    expect(nestingIssues(nested(256), "body.example", "example")).toEqual([]);
    expect(nestingIssues(nested(257), "body.example", "example")).toEqual([
      {
        path: "body.example",
        message: "This example is nested more than 256 levels deep",
      },
    ]);
  });
});
