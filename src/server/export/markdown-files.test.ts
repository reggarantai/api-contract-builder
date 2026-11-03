import { describe, expect, it } from "vitest";
import type { Page } from "../../shared/pages";
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

  describe("with page states", () => {
    const itemHasStock = testErrorType("stock", "item-has-stock", "409", {
      title: "Item still in stock",
    });
    const listItems = testEndpoint("e1", "GET", "/items", {
      responses: [
        {
          id: "r200",
          status: "200",
          description: "OK",
          headers: noHeaders,
          body: {
            contentType: "application/json",
            schema: { type: "object" },
            examples: [
              { id: "x1", name: "first-page", summary: "", value: [1] },
              { id: "x2", name: "empty", summary: "", value: [] },
            ],
          },
          errors: [],
        },
      ],
    });
    const deleteItem = testEndpoint("e2", "DELETE", "/items/{id}", {
      responses: [
        {
          id: "r204",
          status: "204",
          description: "No Content",
          headers: noHeaders,
          body: null,
          errors: [],
        },
        testErrorResponse("409", "Conflict", ["stock"]),
      ],
    });
    const mockup = (id: string, originalName: string, caption: string) => ({
      id,
      pageId: "p1",
      url: `/uploads/p1/${id}.png`,
      originalName,
      mimeType: "image/png" as const,
      width: 4,
      height: 3,
      caption,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const links = [
      { endpointId: "e1", trigger: "on_load" as const, note: "" },
      { endpointId: "e2", trigger: "on_action" as const, note: "" },
    ];
    const states: Page["states"] = [
      {
        id: "s1",
        kind: "loading",
        name: "Loading items",
        description: "Grey rows; the filters stay usable.",
        causes: [{ type: "request", linkId: "p1-l0" }],
        mockupIds: ["m1"],
      },
      {
        id: "s2",
        kind: "empty",
        name: "No items",
        description: "Offers to clear the filters.",
        causes: [
          {
            type: "response",
            linkId: "p1-l0",
            responseId: "r200",
            exampleId: "x2",
          },
        ],
        mockupIds: ["m2"],
      },
      {
        id: "s3",
        kind: "error",
        name: "Can't delete",
        description: "",
        causes: [
          {
            type: "error",
            linkId: "p1-l1",
            errorTypeId: "stock",
            exampleId: null,
          },
          {
            type: "response",
            linkId: "p1-l1",
            responseId: "r204",
            exampleId: null,
          },
        ],
        mockupIds: [],
      },
    ];
    const stockList = testPage("p1", "Stock list", links, {
      mockups: [
        mockup("m1", "loading.png", "Grey rows"),
        mockup("m2", "empty.png", ""),
        mockup("m3", "list.png", "The list"),
      ],
      states,
    });
    const input = testInput({
      errorTypes: [itemHasStock],
      endpoints: [listItems, deleteItem],
      pages: [stockList],
    });
    const openApi = { fileName: "inventory-app.openapi.yaml", content: "" };

    function filesOf(
      exportInput: ReturnType<typeof testInput>,
      withOpenApi = true,
    ) {
      return buildMarkdownFiles(
        exportInput,
        {},
        {
          readImage: () => new Uint8Array([1]),
          openApi: withOpenApi ? openApi : null,
        },
      );
    }

    it("describes each state, what leads to it, its mockups, and the Prism headers", () => {
      const page = filesOf(input)["pages/stock-list.md"] as string;

      expect(page).toContain(
        [
          "## Acceptance criteria",
          "",
          "_None yet._",
          "",
          "## States",
          "",
          "### Loading: Loading items",
          "",
          "While [`GET /items`](#get-items) runs.",
          "",
          "Grey rows; the filters stay usable.",
          "",
          "![Grey rows](../images/stock-list/01-loading.png)",
          "",
          "_Grey rows_",
          "",
          "### Empty: No items",
          "",
          "Offers to clear the filters.",
          "",
          "| Comes from | Response | Prism headers |",
          "| --- | --- | --- |",
          "| [`GET /items`](#get-items) | 200 OK, example `empty` | `Prefer: code=200, example=empty` |",
          "",
          "![empty.png](../images/stock-list/02-empty.png)",
          "",
          "### Error: Can't delete",
          "",
          "| Comes from | Response | Prism headers |",
          "| --- | --- | --- |",
          "| [`DELETE /items/{id}`](#delete-itemsid) | 409 [`item-has-stock`](../error-types.md#item-has-stock) | `Prefer: code=409, example=item-has-stock`<br>`Accept: application/problem+json` |",
          "| [`DELETE /items/{id}`](#delete-itemsid) | 204 No Content | `Prefer: code=204` |",
          "",
          "## Other mockups",
          "",
          "![The list](../images/stock-list/03-list.png)",
          "",
          "_The list_",
          "",
          "## Endpoints",
        ].join("\n"),
      );
      expect(page).not.toContain("## Mockups");
    });

    it("leaves out the Prism headers while the bundle has no OpenAPI file", () => {
      const page = filesOf(input, false)["pages/stock-list.md"] as string;

      expect(page).toContain(
        [
          "| Comes from | Response |",
          "| --- | --- |",
          "| [`GET /items`](#get-items) | 200 OK, example `empty` |",
        ].join("\n"),
      );
      expect(page).not.toContain("Prefer:");
    });

    it("says which call it is when the page makes the same one twice", () => {
      const twice = testPage(
        "p1",
        "Stock list",
        [
          ...links,
          { endpointId: "e1", trigger: "other", note: "Every minute" },
        ],
        {
          states: [
            {
              id: "s1",
              kind: "loading",
              name: "Loading items",
              description: "",
              causes: [{ type: "request", linkId: "p1-l0" }],
              mockupIds: [],
            },
          ],
        },
      );

      const page = filesOf(testInput({ ...input, pages: [twice] }))[
        "pages/stock-list.md"
      ] as string;

      expect(page).toContain(
        "While [`GET /items`](#get-items) (When the page loads) runs.",
      );
    });

    it("keeps the Mockups section when no state shows a mockup", () => {
      const page = filesOf(
        testInput({
          ...input,
          pages: [
            {
              ...stockList,
              states: states.map((state) => ({ ...state, mockupIds: [] })),
            },
          ],
        }),
      )["pages/stock-list.md"] as string;

      expect(page).toMatch(
        /## States\n[\s\S]*\n## Mockups\n\n!\[Grey rows\]\(\.\.\/images\/stock-list\/01-loading\.png\)[\s\S]*\n## Endpoints/,
      );
    });

    it("tells how to mock states in the README, only when a page has some", () => {
      const without = testInput({
        ...input,
        pages: [{ ...stockList, states: [] }],
      });

      expect(filesOf(without)["README.md"]).not.toContain("states");
      expect(filesOf(input)["README.md"]).toContain(
        [
          '```bash\ncurl -H "Prefer: code=404" http://127.0.0.1:4010/<path>\ncurl -H "Prefer: example=<example name>" http://127.0.0.1:4010/<path>\n```',
          "",
          "Page files list each state with the headers that make Prism answer with it. Separate preferences with a comma, as in `Prefer: code=404, example=<example name>`: after a semicolon, Prism ignores the example. Loading states have none, since Prism answers right away; slow the network down in the browser's developer tools to see them.",
        ].join("\n"),
      );
    });

    it("leaves pages without states as they were, even next to pages with states", () => {
      const settings = testPage("p2", "Settings", [
        { endpointId: "e1", trigger: "on_load", note: "" },
      ]);
      const alone = filesOf(
        testInput({
          ...input,
          pages: [{ ...stockList, states: [] }, settings],
        }),
      );
      const together = filesOf(
        testInput({ ...input, pages: [stockList, settings] }),
      );

      expect(together["pages/settings.md"]).toBe(alone["pages/settings.md"]);
      expect(together["models.md"]).toBe(alone["models.md"]);
      expect(together["error-types.md"]).toBe(alone["error-types.md"]);
    });
  });

  it("refuses a bundle whose text would grow past what an export holds", () => {
    // Page files stand alone, so each repeats the endpoints it calls: one
    // long description, expanded 500 times, on many pages.
    const input = testInput({
      models: [
        testModel("m1", "Long", {
          type: "object",
          properties: {
            text: { type: "string", description: "x".repeat(2000) },
          },
        }),
      ],
      endpoints: [
        testEndpoint("e1", "POST", "/things", {
          requestBody: {
            contentType: "application/json",
            description: "",
            required: true,
            examples: [],
            schema: {
              type: "object",
              properties: Object.fromEntries(
                Array.from({ length: 500 }, (_, index) => [
                  `p${index}`,
                  { $ref: "model:m1" },
                ]),
              ),
            },
          },
        }),
      ],
      pages: Array.from({ length: 200 }, (_, index) =>
        testPage(`g${index}`, `Page ${index}`, [
          { endpointId: "e1", trigger: "on_load", note: "" },
        ]),
      ),
    });

    expect(() =>
      buildMarkdownFiles(
        input,
        {},
        { readImage: () => undefined, openApi: null },
      ),
    ).toThrow(
      "This contract is too large to export as Markdown: its files would hold more than 128 MB of text.",
    );
  });

  it("exports a large contract whose pages repeat long examples", () => {
    // 30 endpoints answering with a list of 650 items, on each of 25 pages.
    const items = Array.from({ length: 650 }, (_, index) => ({
      id: `item-${index}`,
      name: `Item number ${index}`,
      price: index + 0.5,
      tags: ["new", "sale"],
      available: true,
    }));
    const endpoints = Array.from({ length: 30 }, (_, index) =>
      testEndpoint(`e${index}`, "GET", `/lists/${index}`, {
        responses: [
          {
            id: "r200",
            status: "200",
            description: "OK",
            headers: noHeaders,
            body: {
              contentType: "application/json",
              schema: { type: "array" },
              examples: [{ id: "x1", name: "list", summary: "", value: items }],
            },
            errors: [],
          },
        ],
      }),
    );
    const pages = Array.from({ length: 25 }, (_, index) =>
      testPage(
        `g${index}`,
        `Page ${index}`,
        endpoints.map((endpoint) => ({
          endpointId: endpoint.id,
          trigger: "on_load" as const,
          note: "",
        })),
      ),
    );

    const files = buildMarkdownFiles(
      testInput({ endpoints, pages }),
      {},
      { readImage: () => undefined, openApi: null },
    );
    const text = Object.values(files).reduce(
      (total, file) => total + (typeof file === "string" ? file.length : 0),
      0,
    );
    // Over half of what a bundle may hold.
    expect(text).toBeGreaterThan(64 * 1024 * 1024);
    expect(files["pages/page-24.md"]).toContain('"id": "item-649"');
  });
});
