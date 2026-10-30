import { describe, expect, it } from "vitest";
import { buildMarkdownFiles } from "./markdown-files";
import { testEndpoint, testInput, testPage } from "./test-input";

describe("buildMarkdownFiles", () => {
  const noHeaders = { type: "object", properties: {} };

  function pageFile(input: ReturnType<typeof testInput>) {
    const files = buildMarkdownFiles(
      input,
      {},
      { readImage: () => undefined, openApi: null },
    );
    return files["pages/add-stock.md"] as string;
  }

  it("lists a response's headers in a table before its body", () => {
    const page = pageFile(
      testInput({
        endpoints: [
          testEndpoint("e1", "POST", "/stocks", {
            responses: [
              {
                id: "r1",
                status: "201",
                description: "Created",
                headers: {
                  type: "object",
                  properties: {
                    Location: {
                      type: "string",
                      format: "uri-reference",
                      description: "Where the new item lives",
                    },
                  },
                  required: ["Location"],
                },
                body: {
                  contentType: "application/json",
                  schema: { type: "object", properties: {} },
                  examples: [],
                },
              },
              {
                id: "r2",
                status: "429",
                description: "Too Many Requests",
                headers: {
                  type: "object",
                  properties: {
                    "Retry-After": {
                      type: "integer",
                      minimum: 1,
                      description: "Seconds to wait",
                    },
                  },
                },
                body: null,
              },
              {
                id: "r3",
                status: "409",
                description: "Conflict",
                headers: noHeaders,
                body: null,
              },
            ],
          }),
        ],
        pages: [
          testPage("p1", "Add stock", [
            { endpointId: "e1", trigger: "on_submit", note: "" },
          ]),
        ],
      }),
    );

    expect(page).toContain(
      [
        "##### 201 Created",
        "",
        "| Header | Type | Required | Description | Rules |",
        "| --- | --- | --- | --- | --- |",
        "| `Location` | string (uri-reference) | Yes | Where the new item lives |  |",
        "",
        "`application/json` — object",
      ].join("\n"),
    );
    expect(page).toContain(
      [
        "##### 429 Too Many Requests",
        "",
        "| Header | Type | Required | Description | Rules |",
        "| --- | --- | --- | --- | --- |",
        "| `Retry-After` | integer |  | Seconds to wait | ≥ 1 |",
        "",
        "No body.",
      ].join("\n"),
    );
    expect(page).toContain("##### 409 Conflict\n\nNo body.");
  });

  it("adds an Example column to parameter and header tables that have examples", () => {
    const page = pageFile(
      testInput({
        endpoints: [
          testEndpoint("e1", "GET", "/stocks/{sku}", {
            parameters: {
              path: {
                type: "object",
                properties: { sku: { type: "string", examples: ["SKU-1"] } },
                required: ["sku"],
              },
              query: {
                type: "object",
                properties: {
                  page: { type: "integer", minimum: 1, default: 1 },
                },
              },
              header: noHeaders,
            },
            responses: [
              {
                id: "r1",
                status: "200",
                description: "OK",
                headers: {
                  type: "object",
                  properties: {
                    ETag: {
                      type: "string",
                      description: "Version of the item",
                      examples: ['"3"'],
                    },
                  },
                  required: ["ETag"],
                },
                body: null,
              },
            ],
          }),
        ],
        pages: [
          testPage("p1", "Add stock", [
            { endpointId: "e1", trigger: "on_load", note: "" },
          ]),
        ],
      }),
    );

    expect(page).toContain(
      [
        "| Name | In | Type | Required | Description | Rules | Example |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        "| `sku` | path | string | Yes |  |  | `SKU-1` |",
        "| `page` | query | integer |  |  | ≥ 1; default `1` |  |",
      ].join("\n"),
    );
    expect(page).toContain(
      [
        "| Header | Type | Required | Description | Rules | Example |",
        "| --- | --- | --- | --- | --- | --- |",
        '| `ETag` | string | Yes | Version of the item |  | `"3"` |',
      ].join("\n"),
    );
  });
});
