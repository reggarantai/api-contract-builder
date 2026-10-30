import { isJsonObject, type JsonValue } from "@shared/json-schema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import golden from "../../../../test/golden/inventory.openapi.yaml?raw";
import { describeNode } from "./schema-ops";

type Operation = {
  parameters?: { name: string; schema: JsonValue }[];
  requestBody?: { content: Record<string, { schema: JsonValue }> };
  responses: Record<
    string,
    {
      headers?: Record<string, { schema: JsonValue }>;
      content?: Record<string, { schema: JsonValue }>;
    }
  >;
};

// The sample project shows what the builder can do, so none of its schemas
// should need JSON mode. Its export is pinned in test/golden.
describe("the sample project", () => {
  it("has no schema the builder shows as Custom", () => {
    const doc = parse(golden) as {
      paths: Record<string, Record<string, Operation>>;
      components: { schemas: Record<string, JsonValue> };
    };
    const custom: string[] = [];
    const walk = (label: string, node: JsonValue | undefined) => {
      if (describeNode(node).kind === "custom") {
        custom.push(label);
        return;
      }
      if (!isJsonObject(node)) {
        return;
      }
      if (isJsonObject(node.properties)) {
        for (const [name, child] of Object.entries(node.properties)) {
          walk(`${label}.${name}`, child);
        }
      }
      if (node.items !== undefined) {
        walk(`${label}[]`, node.items);
      }
    };

    for (const [name, schema] of Object.entries(doc.components.schemas)) {
      walk(name, schema);
    }
    for (const [path, item] of Object.entries(doc.paths)) {
      for (const [method, op] of Object.entries(item)) {
        const label = `${method.toUpperCase()} ${path}`;
        for (const parameter of op.parameters ?? []) {
          walk(`${label} ${parameter.name}`, parameter.schema);
        }
        for (const media of Object.values(op.requestBody?.content ?? {})) {
          walk(`${label} request body`, media.schema);
        }
        for (const [status, response] of Object.entries(op.responses)) {
          for (const [name, header] of Object.entries(response.headers ?? {})) {
            walk(`${label} ${status} ${name}`, header.schema);
          }
          for (const media of Object.values(response.content ?? {})) {
            walk(`${label} ${status}`, media.schema);
          }
        }
      }
    }

    expect(custom).toEqual([]);
  });
});
