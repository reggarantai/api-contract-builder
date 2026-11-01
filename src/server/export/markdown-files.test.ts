import { describe, expect, it } from "vitest";
import { buildMarkdownFiles } from "./markdown-files";
import {
  testEndpoint,
  testErrorResponse,
  testErrorType,
  testInput,
  testModel,
  testPage,
} from "./test-input";

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
                errors: [],
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
                errors: [],
              },
              {
                id: "r3",
                status: "409",
                description: "Conflict",
                headers: noHeaders,
                body: null,
                errors: [],
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
                errors: [],
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

  describe("with error types", () => {
    const problem = testModel("problem", "Problem", {
      type: "object",
      properties: { type: { type: "string" } },
    });
    const taken = testErrorType("taken", "sku-taken", "409", {
      title: "SKU already used",
      description: "Another item has this SKU.\n\nPick another one.",
    });
    const busy = testErrorType("busy", "request-in-progress", "409", {
      title: "Request in progress",
      headers: {
        type: "object",
        properties: {
          "Retry-After": { type: "integer", description: "Seconds to wait" },
        },
        required: ["Retry-After"],
      },
    });
    const unused = testErrorType("unused", "teapot", "418");

    function filesOf(input: ReturnType<typeof testInput>, pageId?: string) {
      return buildMarkdownFiles(
        input,
        { pageId },
        { readImage: () => undefined, openApi: null },
      );
    }
    const input = testInput({
      models: [problem],
      errorTypes: [taken, busy, unused],
      endpoints: [
        testEndpoint("e1", "POST", "/stocks", {
          responses: [
            testErrorResponse("409", "Conflict", [
              "taken",
              {
                errorTypeId: "busy",
                examples: [
                  {
                    id: "x1",
                    name: "still-running",
                    summary: "Sent twice",
                    value: { type: "busy" },
                  },
                ],
              },
            ]),
          ],
        }),
      ],
      pages: [
        testPage("p1", "Add stock", [
          { endpointId: "e1", trigger: "on_submit", note: "" },
        ]),
      ],
    });

    it("leaves projects without error types as they were", () => {
      const files = filesOf(testInput({ models: [problem] }));

      expect(Object.keys(files)).toEqual(["models.md", "README.md"]);
      expect(files["README.md"]).not.toContain("rror type");
    });

    it("describes each error type once, in error-types.md", () => {
      const files = filesOf(input);

      expect(files["error-types.md"]).toBe(
        [
          "# Error types",
          "",
          "The errors endpoints answer, each described once. Part of [Inventory App](README.md).",
          "",
          "## sku-taken",
          "",
          "**409** — SKU already used",
          "",
          "Another item has this SKU.",
          "",
          "Pick another one.",
          "",
          "`application/problem+json` — [Problem](models.md#problem)",
          "",
          "```json",
          JSON.stringify(taken.body.example, null, 2),
          "```",
          "",
          "Returned by [`POST /stocks`](pages/add-stock.md#post-stocks).",
          "",
          "## request-in-progress",
          "",
          "**409** — Request in progress",
          "",
          "| Header | Type | Required | Description | Rules |",
          "| --- | --- | --- | --- | --- |",
          "| `Retry-After` | integer | Yes | Seconds to wait |  |",
          "",
          "`application/problem+json` — [Problem](models.md#problem)",
          "",
          "```json",
          JSON.stringify(busy.body.example, null, 2),
          "```",
          "",
          "Returned by [`POST /stocks`](pages/add-stock.md#post-stocks).",
          "",
          "## teapot",
          "",
          "**418** — teapot",
          "",
          "`application/problem+json` — [Problem](models.md#problem)",
          "",
          "```json",
          JSON.stringify(unused.body.example, null, 2),
          "```",
          "",
          "No endpoint returns it yet.",
          "",
        ].join("\n"),
      );
      expect(files["README.md"]).toContain(
        "- [Error types](error-types.md): the errors endpoints answer, and when",
      );
      expect(files["README.md"]).toContain(
        [
          "## Error types",
          "",
          "| Status | Error type | Title |",
          "| --- | --- | --- |",
          "| 409 | [`sku-taken`](error-types.md#sku-taken) | SKU already used |",
          "| 409 | [`request-in-progress`](error-types.md#request-in-progress) | Request in progress |",
          "| 418 | [`teapot`](error-types.md#teapot) | teapot |",
        ].join("\n"),
      );
    });

    it("shows each error type of a response in the page file, with its examples", () => {
      const page = filesOf(input)["pages/add-stock.md"] as string;

      expect(page).toContain(
        [
          "##### 409 Conflict",
          "",
          "| Header | Type | Required | Description | Rules |",
          "| --- | --- | --- | --- | --- |",
          "| `Retry-After` | integer |  | Only with `request-in-progress`: Seconds to wait |  |",
          "",
          "`application/problem+json` — [Problem](../models.md#problem)",
          "",
          "| Field | Type | Required | Description | Rules |",
          "| --- | --- | --- | --- | --- |",
          "| `type` | string |  |  |  |",
          "",
          "[`sku-taken`](../error-types.md#sku-taken): **SKU already used**",
          "",
          "Another item has this SKU.",
          "",
          "Pick another one.",
          "",
          "```json",
          JSON.stringify(taken.body.example, null, 2),
          "```",
          "",
          "[`request-in-progress`](../error-types.md#request-in-progress): **Request in progress**",
          "",
          "Example `still-running` — Sent twice:",
          "",
          "```json",
          '{\n  "type": "busy"\n}',
          "```",
        ].join("\n"),
      );
    });

    it("exports one page with only the error types it uses", () => {
      const files = filesOf(
        testInput({
          ...input,
          pages: [
            ...input.pages,
            testPage("p2", "Settings", [], { slug: "settings" }),
          ],
        }),
        "p2",
      );

      expect(files["error-types.md"]).toBeUndefined();
    });
  });
});
