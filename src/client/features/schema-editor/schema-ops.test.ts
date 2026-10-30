import {
  type JsonSchema,
  type JsonValue,
  refsToComponentNames,
} from "@shared/json-schema";
import { describe, expect, it } from "vitest";
import {
  addProperty,
  changeKind,
  describeNode,
  formatInput,
  getAt,
  isRequired,
  moveProperty,
  type NodeInfo,
  parseEnumInput,
  parseJsonInput,
  parseNumberInput,
  parsePatternInput,
  parseSchemaJson,
  propertyNames,
  removeProperty,
  renameProperty,
  setExample,
  setKeyword,
  setNullable,
  setRequired,
  summarizeNode,
  uniquePropertyName,
  updateAt,
} from "./schema-ops";

describe("describeNode", () => {
  it.each<[JsonValue, NodeInfo]>([
    [{ type: "string" }, { kind: "string", nullable: false }],
    [{ type: ["integer", "null"] }, { kind: "integer", nullable: true }],
    [{ type: ["null", "object"] }, { kind: "object", nullable: true }],
    [
      { $ref: "model:u1", description: "Owner" },
      { kind: "ref", ref: "model:u1", modelId: "u1", nullable: false },
    ],
    [
      { anyOf: [{ $ref: "model:u1" }, { type: "null" }] },
      { kind: "ref", ref: "model:u1", modelId: "u1", nullable: true },
    ],
    [{ description: "Anything", "x-note": 1 }, { kind: "any" }],
    [{ oneOf: [{ type: "string" }, { type: "integer" }] }, { kind: "custom" }],
    [{ type: ["string", "integer"] }, { kind: "custom" }],
    [{ properties: { a: {} } }, { kind: "custom" }],
  ])("%j", (node, expected) => {
    expect(describeNode(node)).toEqual(expected);
  });
});

describe("changeKind", () => {
  it("keeps description and nullability, drops old type keywords", () => {
    const node = {
      type: ["string", "null"],
      description: "Email",
      format: "email",
      examples: ["a@example.com"],
    };

    expect(changeKind(node, "integer")).toEqual({
      type: ["integer", "null"],
      description: "Email",
    });
    expect(changeKind(node, { ref: "model:u1" })).toEqual({
      description: "Email",
      anyOf: [{ $ref: "model:u1" }, { type: "null" }],
    });
  });

  it("gives objects and arrays an empty structure", () => {
    expect(changeKind({ type: "string" }, "object")).toEqual({
      type: "object",
      properties: {},
    });
    expect(changeKind({ type: "string" }, "array")).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });
});

describe("setNullable", () => {
  it("toggles null in the type", () => {
    expect(setNullable({ type: "string", maxLength: 3 }, true)).toEqual({
      type: ["string", "null"],
      maxLength: 3,
    });
    expect(setNullable({ type: ["string", "null"] }, false)).toEqual({
      type: "string",
    });
  });

  it("wraps and unwraps references", () => {
    const nullable = setNullable(
      { $ref: "model:u1", description: "Owner" },
      true,
    );
    expect(nullable).toEqual({
      description: "Owner",
      anyOf: [{ $ref: "model:u1" }, { type: "null" }],
    });
    expect(setNullable(nullable, false)).toEqual({
      description: "Owner",
      $ref: "model:u1",
    });
  });
});

describe("object properties", () => {
  const user: JsonSchema = {
    type: "object",
    properties: {
      id: { type: "string" },
      email: { type: "string" },
      age: { type: "integer" },
    },
    required: ["id", "email"],
    "x-table": "users",
  };

  it("renames in place and updates required", () => {
    const renamed = renameProperty(user, "email", "mail");

    expect(propertyNames(renamed)).toEqual(["id", "mail", "age"]);
    expect(renamed.required).toEqual(["id", "mail"]);
    expect(renamed["x-table"]).toBe("users");
  });

  it("removes properties and empty required lists", () => {
    const removed = removeProperty(removeProperty(user, "id"), "email");

    expect(propertyNames(removed)).toEqual(["age"]);
    expect(removed).not.toHaveProperty("required");
  });

  it("moves properties within bounds", () => {
    expect(propertyNames(moveProperty(user, "age", -1))).toEqual([
      "id",
      "age",
      "email",
    ]);
    expect(moveProperty(user, "id", -1)).toBe(user);
  });

  it("toggles required", () => {
    expect(isRequired(setRequired(user, "age", true), "age")).toBe(true);
    expect(
      setRequired(setRequired(user, "id", false), "email", false),
    ).not.toHaveProperty("required");
  });

  it("suggests unused names", () => {
    const withField = addProperty(user, uniquePropertyName(user));
    expect(uniquePropertyName(withField)).toBe("field2");
  });
});

describe("updateAt", () => {
  it("updates nested subschemas without touching siblings", () => {
    const root: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", items: { type: "string" } },
        other: { type: "boolean" },
      },
    };
    const path = ["properties", "tags", "items"];

    const updated = updateAt(root, path, (node) =>
      setKeyword(node as JsonSchema, "maxLength", 20),
    );

    expect(getAt(updated, path)).toEqual({ type: "string", maxLength: 20 });
    expect(getAt(updated, ["properties", "other"])).toBe(
      getAt(root, ["properties", "other"]),
    );
  });
});

describe("examples", () => {
  it("replaces the first example and keeps the rest", () => {
    expect(setExample({ examples: ["a", "b"] }, "c")).toEqual({
      examples: ["c", "b"],
    });
    expect(setExample({ examples: ["a"] }, undefined)).toEqual({});
  });
});

describe("summarizeNode", () => {
  it("lists constraints", () => {
    expect(
      summarizeNode({
        type: ["string", "null"],
        format: "email",
        minLength: 3,
        maxLength: 50,
        pattern: "^.+$",
      }),
    ).toEqual(["nullable", "email", "3–50 chars", "pattern"]);
    expect(summarizeNode({ type: "integer", minimum: 0 })).toEqual(["≥ 0"]);
    expect(
      summarizeNode({ type: "array", minItems: 1, uniqueItems: true }),
    ).toEqual(["≥ 1 items", "unique"]);
  });
});

describe("builder ↔ JSON round trip", () => {
  const models = new Map([
    ["u1", "User"],
    ["p1", "Product"],
  ]);
  const nameOf = (id: string) => models.get(id);
  const idOf = (name: string) =>
    [...models].find(([, modelName]) => modelName === name)?.[0];

  // Every kind of edit the builder makes, applied in sequence.
  function buildOrderSchema(): JsonSchema {
    let schema: JsonSchema = { type: "object", properties: {}, "x-kept": true };
    schema = addProperty(schema, "id", { type: "string", format: "uuid" });
    schema = setRequired(schema, "id", true);
    schema = addProperty(
      schema,
      "customer",
      changeKind(undefined, { ref: "model:u1" }),
    );
    schema = updateAt(schema, ["properties", "customer"], (node) =>
      setNullable(node as JsonSchema, true),
    );
    schema = addProperty(schema, "lines", changeKind(undefined, "array"));
    schema = updateAt(schema, ["properties", "lines", "items"], () =>
      addProperty(changeKind(undefined, "object"), "product", {
        $ref: "model:p1",
      }),
    );
    schema = updateAt(schema, ["properties", "lines"], (node) =>
      setKeyword(node as JsonSchema, "minItems", 1),
    );
    schema = addProperty(schema, "status", {
      type: "string",
      enum: ["new", "paid"],
    });
    schema = updateAt(schema, ["properties", "status"], (node) =>
      setExample(node as JsonSchema, "new"),
    );
    return schema;
  }

  it("shows what the builder made in JSON and parses it back unchanged", () => {
    const built = buildOrderSchema();

    const text = JSON.stringify(refsToComponentNames(built, nameOf), null, 2);
    expect(text).toContain('"$ref": "#/components/schemas/User"');
    expect(text).not.toContain("model:");

    expect(parseSchemaJson(text, idOf)).toEqual({ schema: built });
  });

  it("keeps keywords the builder doesn't know through edits", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string", "x-label": "Full name", deprecated: true },
      },
      additionalProperties: false,
    };

    const edited = updateAt(schema, ["properties", "name"], (node) =>
      setKeyword(node as JsonSchema, "maxLength", 80),
    );

    expect(edited.additionalProperties).toBe(false);
    expect(getAt(edited, ["properties", "name"])).toEqual({
      type: "string",
      "x-label": "Full name",
      deprecated: true,
      maxLength: 80,
    });
  });

  it("reports JSON problems", () => {
    expect(parseSchemaJson("{", idOf)).toHaveProperty("error");
    expect(parseSchemaJson("[]", idOf)).toEqual({
      error: "The schema must be a JSON object",
    });
    expect(
      parseSchemaJson('{"$ref": "#/components/schemas/Missing"}', idOf),
    ).toEqual({ error: "Unknown model: Missing" });
  });
});

describe("detail inputs", () => {
  it("parses numbers", () => {
    expect(parseNumberInput("")).toEqual({ value: undefined });
    expect(parseNumberInput("-1.5")).toEqual({ value: -1.5 });
    expect(parseNumberInput("-")).toHaveProperty("error");
    expect(
      parseNumberInput("2.5", { nonNegativeInteger: true }),
    ).toHaveProperty("error");
  });

  it("parses JSON examples", () => {
    expect(parseJsonInput('{"a": 1}')).toEqual({ value: { a: 1 } });
    expect(parseJsonInput("{")).toHaveProperty("error");
  });

  it("parses enums per line", () => {
    expect(parseEnumInput("new\n\n paid \n", false)).toEqual({
      value: ["new", "paid"],
    });
    expect(parseEnumInput("1\n2", true)).toEqual({ value: [1, 2] });
    expect(parseEnumInput("1\ntwo", true)).toHaveProperty("error");
  });

  it("checks patterns", () => {
    expect(parsePatternInput("^[a-z]+$")).toEqual({ value: "^[a-z]+$" });
    expect(parsePatternInput("(")).toHaveProperty("error");
  });

  it("formats values back for inputs", () => {
    expect(formatInput(["new", "paid"], "lines")).toBe("new\npaid");
    expect(formatInput({ a: 1 }, "json")).toBe('{"a":1}');
    expect(formatInput(undefined, "text")).toBe("");
  });
});
