import { describe, expect, it } from "vitest";
import type { JsonSchema } from "../../shared/json-schema";
import { buildOpenApi, lintContract, validateContract } from "./openapi";
import {
  testEndpoint,
  testInput,
  testModel,
  testPage,
  testProject,
} from "./test-input";

const objectSchema = (
  properties: Record<string, JsonSchema>,
  required?: string[],
): JsonSchema => ({
  type: "object",
  properties,
  ...(required ? { required } : {}),
});

describe("buildOpenApi", () => {
  it("builds info and servers", () => {
    const doc = buildOpenApi(
      testInput({
        project: testProject({
          description: "Stock API",
          servers: [
            {
              id: "s1",
              name: "Production",
              url: "https://api.example.com",
              description: "",
            },
            {
              id: "s2",
              name: "Staging",
              url: "https://staging.example.com",
              description: "Reset nightly",
            },
          ],
        }),
      }),
    );

    expect(doc).toEqual({
      openapi: "3.1.0",
      info: {
        title: "Inventory App",
        version: "1.0.0",
        description: "Stock API",
      },
      servers: [
        { url: "https://api.example.com", description: "Production" },
        {
          url: "https://staging.example.com",
          description: "Staging — Reset nightly",
        },
      ],
      paths: {},
    });
  });

  it("turns models into components and model references into $refs", () => {
    const doc = buildOpenApi(
      testInput({
        models: [
          testModel(
            "user",
            "User",
            objectSchema({ id: { type: "string" } }),
            "A signed-up user",
          ),
          testModel(
            "order",
            "Order",
            objectSchema({ customer: { $ref: "model:user" } }),
          ),
        ],
      }),
    );

    expect(doc.components).toEqual({
      schemas: {
        User: {
          description: "A signed-up user",
          type: "object",
          properties: { id: { type: "string" } },
        },
        Order: {
          type: "object",
          properties: { customer: { $ref: "#/components/schemas/User" } },
        },
      },
    });
  });

  it("describes an operation with parameters, responses, and extensions", () => {
    const doc = buildOpenApi(
      testInput({
        models: [
          testModel(
            "stock",
            "Stock",
            objectSchema({ sku: { type: "string" } }),
          ),
        ],
        endpoints: [
          testEndpoint("e1", "GET", "/stocks/{sku}", {
            summary: "Get a stock item",
            description: "Returns one item.",
            status: "agreed",
            notesFe: "Show a skeleton while loading.",
            parameters: {
              path: {
                type: "object",
                properties: {
                  sku: {
                    type: "string",
                    description: "Stock keeping unit",
                    examples: ["SKU-1"],
                  },
                },
                required: ["sku"],
              },
              query: objectSchema({
                include: { type: "string", enum: ["batches"] },
              }),
              header: objectSchema({ "X-Request-Id": { type: "string" } }, [
                "X-Request-Id",
              ]),
            },
            responses: [
              {
                id: "r1",
                status: "200",
                description: "OK",
                headers: objectSchema({}),
                body: {
                  contentType: "application/json",
                  schema: { $ref: "model:stock" },
                  examples: [
                    {
                      id: "x1",
                      name: "found",
                      summary: "Item found",
                      value: { sku: "SKU-1" },
                    },
                  ],
                },
              },
              {
                id: "r2",
                status: "404",
                description: "Not Found",
                headers: objectSchema({}),
                body: null,
              },
            ],
          }),
        ],
      }),
    );

    expect(doc.paths).toEqual({
      "/stocks/{sku}": {
        get: {
          operationId: "getStocksBySku",
          summary: "Get a stock item",
          description: "Returns one item.",
          parameters: [
            {
              name: "sku",
              in: "path",
              required: true,
              description: "Stock keeping unit",
              schema: { type: "string", examples: ["SKU-1"] },
            },
            {
              name: "include",
              in: "query",
              schema: { type: "string", enum: ["batches"] },
            },
            {
              name: "X-Request-Id",
              in: "header",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "OK",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Stock" },
                  examples: {
                    found: { summary: "Item found", value: { sku: "SKU-1" } },
                  },
                },
              },
            },
            "404": { description: "Not Found" },
          },
          "x-status": "agreed",
          "x-notes-fe": "Show a skeleton while loading.",
        },
      },
    });
  });

  it("describes response headers, moving descriptions out of the schema", () => {
    const input = testInput({
      models: [testModel("cursor", "Cursor", { type: "string" })],
      pages: [
        testPage("p1", "Add stock", [
          { endpointId: "e1", trigger: "on_submit", note: "" },
        ]),
      ],
      endpoints: [
        testEndpoint("e1", "POST", "/stocks", {
          requestBody: null,
          responses: [
            {
              id: "r1",
              status: "201",
              description: "Created",
              headers: objectSchema(
                {
                  Location: {
                    type: "string",
                    format: "uri-reference",
                    description: "Where the new item lives",
                    examples: ["/stocks/SKU-1"],
                  },
                  "X-Next-Cursor": { $ref: "model:cursor" },
                },
                ["Location"],
              ),
              body: null,
            },
            {
              id: "r2",
              status: "409",
              description: "Conflict",
              headers: objectSchema({}),
              body: null,
            },
          ],
        }),
      ],
    });
    const doc = buildOpenApi(input, { pageId: "p1" });

    expect(doc.paths["/stocks"]?.post?.responses).toEqual({
      "201": {
        description: "Created",
        headers: {
          Location: {
            description: "Where the new item lives",
            required: true,
            schema: {
              type: "string",
              format: "uri-reference",
              examples: ["/stocks/SKU-1"],
            },
          },
          "X-Next-Cursor": {
            schema: { $ref: "#/components/schemas/Cursor" },
          },
        },
      },
      "409": { description: "Conflict" },
    });
    // A model used only by a header counts as used.
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(["Cursor"]);
    expect(lintContract(input)).toEqual([]);
  });

  it("describes request bodies and deprecation", () => {
    const doc = buildOpenApi(
      testInput({
        endpoints: [
          testEndpoint("e1", "POST", "/stocks", {
            deprecated: true,
            requestBody: {
              contentType: "application/json",
              required: true,
              description: "The new item",
              schema: objectSchema({ sku: { type: "string" } }),
              examples: [
                { id: "x", name: "new-item", summary: "", value: { sku: "A" } },
              ],
            },
          }),
        ],
      }),
    );

    expect(doc.paths["/stocks"]?.post).toMatchObject({
      deprecated: true,
      requestBody: {
        description: "The new item",
        required: true,
        content: {
          "application/json": {
            schema: objectSchema({ sku: { type: "string" } }),
            examples: { "new-item": { value: { sku: "A" } } },
          },
        },
      },
    });
  });

  it("maps security schemes, the default, and per-endpoint choices", () => {
    const doc = buildOpenApi(
      testInput({
        project: testProject({
          securitySchemes: [
            {
              id: "b",
              key: "bearerAuth",
              type: "bearer",
              bearerFormat: "JWT",
              description: "From /auth/login",
            },
            { id: "basic", key: "basicAuth", type: "basic", description: "" },
            {
              id: "k",
              key: "apiKeyAuth",
              type: "apiKey",
              in: "header",
              name: "X-API-Key",
              description: "",
            },
          ],
          defaultSecuritySchemeId: "b",
        }),
        endpoints: [
          testEndpoint("e1", "GET", "/a"),
          testEndpoint("e2", "GET", "/b", { security: { type: "none" } }),
          testEndpoint("e3", "GET", "/c", {
            security: { type: "schemes", schemeIds: ["k"] },
          }),
        ],
      }),
    );

    expect(doc.components?.securitySchemes).toEqual({
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "From /auth/login",
      },
      basicAuth: { type: "http", scheme: "basic" },
      apiKeyAuth: { type: "apiKey", in: "header", name: "X-API-Key" },
    });
    expect(doc.security).toEqual([{ bearerAuth: [] }]);
    expect(doc.paths["/a"]?.get).not.toHaveProperty("security");
    expect(doc.paths["/b"]?.get?.security).toEqual([]);
    expect(doc.paths["/c"]?.get?.security).toEqual([{ apiKeyAuth: [] }]);
  });

  it("turns pages into tags and x-pages", () => {
    const login = testEndpoint("login", "POST", "/auth/login");
    const me = testEndpoint("me", "GET", "/me");
    const doc = buildOpenApi(
      testInput({
        endpoints: [login, me],
        pages: [
          testPage(
            "p1",
            "Login",
            [
              {
                endpointId: "login",
                trigger: "on_submit",
                note: "Show errors inline",
              },
            ],
            {
              description: "Sign in with email.",
            },
          ),
          testPage("p2", "Profile", [
            { endpointId: "me", trigger: "on_load", note: "" },
            { endpointId: "me", trigger: "on_action", note: "Refresh" },
          ]),
          testPage("p3", "Login", [], { slug: "login-2" }),
        ],
      }),
    );

    expect(doc.tags).toEqual([
      { name: "Login", description: "Sign in with email." },
      { name: "Profile" },
      { name: "Login (login-2)" },
    ]);
    expect(doc.paths["/auth/login"]?.post).toMatchObject({
      tags: ["Login"],
      "x-pages": [
        {
          page: "Login",
          slug: "login",
          trigger: "on_submit",
          note: "Show errors inline",
        },
      ],
    });
    expect(doc.paths["/me"]?.get).toMatchObject({
      tags: ["Profile"],
      "x-pages": [
        { page: "Profile", slug: "profile", trigger: "on_load" },
        {
          page: "Profile",
          slug: "profile",
          trigger: "on_action",
          note: "Refresh",
        },
      ],
    });
  });

  it("orders paths and methods, and keeps operation IDs unique", () => {
    const doc = buildOpenApi(
      testInput({
        endpoints: [
          testEndpoint("e1", "POST", "/stock-items"),
          testEndpoint("e2", "GET", "/stock-items"),
          testEndpoint("e3", "GET", "/stock_items"),
          testEndpoint("e4", "GET", "/other", { operationId: "getStockItems" }),
        ],
      }),
    );

    expect(Object.keys(doc.paths)).toEqual([
      "/other",
      "/stock-items",
      "/stock_items",
    ]);
    expect(Object.keys(doc.paths["/stock-items"] ?? {})).toEqual([
      "get",
      "post",
    ]);
    expect(doc.paths["/other"]?.get?.operationId).toBe("getStockItems");
    expect(doc.paths["/stock-items"]?.get?.operationId).toBe("getStockItems2");
    expect(doc.paths["/stock_items"]?.get?.operationId).toBe("getStockItems3");
    expect(doc.paths["/stock-items"]?.post?.operationId).toBe("postStockItems");
  });

  it("exports one page with only the endpoints and models it uses", () => {
    const input = testInput({
      models: [
        testModel(
          "category",
          "Category",
          objectSchema({ name: { type: "string" } }),
        ),
        testModel(
          "stock",
          "Stock",
          objectSchema({ category: { $ref: "model:category" } }),
        ),
        testModel(
          "session",
          "Session",
          objectSchema({ token: { type: "string" } }),
        ),
      ],
      endpoints: [
        testEndpoint("list", "GET", "/stocks", {
          responses: [
            {
              id: "r",
              status: "200",
              description: "OK",
              headers: objectSchema({}),
              body: {
                contentType: "application/json",
                schema: { type: "array", items: { $ref: "model:stock" } },
                examples: [],
              },
            },
          ],
        }),
        testEndpoint("login", "POST", "/auth/login"),
      ],
      pages: [
        testPage("p1", "Login", [
          { endpointId: "login", trigger: "on_submit", note: "" },
        ]),
        testPage("p2", "Stock list", [
          { endpointId: "list", trigger: "on_load", note: "" },
        ]),
      ],
    });

    const doc = buildOpenApi(input, { pageId: "p2" });

    expect(doc.info.title).toBe("Inventory App: Stock list");
    expect(Object.keys(doc.paths)).toEqual(["/stocks"]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual([
      "Category",
      "Stock",
    ]);
    expect(doc.tags).toEqual([{ name: "Stock list" }]);
  });
});

describe("lintContract", () => {
  it("warns about bodies without examples, unused endpoints, and unused models", () => {
    const input = testInput({
      models: [
        testModel("stock", "Stock", objectSchema({ sku: { type: "string" } })),
        testModel(
          "legacy",
          "Legacy",
          objectSchema({ self: { $ref: "model:legacy" } }),
        ),
      ],
      endpoints: [
        testEndpoint("add", "POST", "/stocks", {
          requestBody: {
            contentType: "application/json",
            required: true,
            description: "",
            schema: { $ref: "model:stock" },
            examples: [],
          },
          responses: [
            {
              id: "r1",
              status: "201",
              description: "Created",
              headers: objectSchema({}),
              body: {
                contentType: "application/json",
                schema: {},
                examples: [],
              },
            },
            {
              id: "r2",
              status: "204",
              description: "No Content",
              headers: objectSchema({}),
              body: null,
            },
          ],
        }),
        testEndpoint("health", "GET", "/health"),
      ],
      pages: [
        testPage("p1", "Add stock", [
          { endpointId: "add", trigger: "on_submit", note: "" },
        ]),
      ],
    });

    expect(lintContract(input)).toEqual([
      {
        kind: "missing-example",
        target: { type: "endpoint", id: "add" },
        message: "POST /stocks: the request body has no example",
      },
      {
        kind: "missing-example",
        target: { type: "endpoint", id: "add" },
        message: "POST /stocks: the 201 response has no example",
      },
      {
        kind: "missing-example",
        target: { type: "endpoint", id: "health" },
        message: "GET /health: the 200 response has no example",
      },
      {
        kind: "unused-endpoint",
        target: { type: "endpoint", id: "health" },
        message: "GET /health isn't used by any page",
      },
      {
        kind: "unused-model",
        target: { type: "model", id: "legacy" },
        message: "Legacy isn't used by any endpoint or other model",
      },
    ]);
  });

  it("only checks what a single page exports", () => {
    const input = testInput({
      models: [testModel("legacy", "Legacy", objectSchema({}))],
      endpoints: [
        testEndpoint("login", "POST", "/auth/login", {
          requestBody: null,
          responses: [],
        }),
        testEndpoint("health", "GET", "/health"),
      ],
      pages: [
        testPage("p1", "Login", [
          { endpointId: "login", trigger: "on_submit", note: "" },
        ]),
      ],
    });

    expect(lintContract(input, { pageId: "p1" })).toEqual([]);
  });
});

describe("validateContract", () => {
  it("accepts a valid contract", async () => {
    const input = testInput({
      models: [
        testModel(
          "stock",
          "Stock",
          objectSchema({ sku: { type: ["string", "null"] } }),
        ),
      ],
      endpoints: [testEndpoint("e1", "GET", "/stocks/{sku}")],
    });

    expect(await validateContract(input, buildOpenApi(input))).toEqual([]);
  });

  it("reports schemas that aren't valid JSON Schema, by where they are", async () => {
    const input = testInput({
      models: [testModel("broken", "Broken", { type: "strng" })],
      endpoints: [
        testEndpoint("e1", "GET", "/stocks", {
          parameters: {
            path: objectSchema({}),
            query: objectSchema({ limit: { type: "integer", minimum: "ten" } }),
            header: objectSchema({}),
          },
          responses: [
            {
              id: "r1",
              status: "200",
              description: "OK",
              headers: objectSchema({ ETag: { type: "text" } }),
              body: null,
            },
          ],
        }),
      ],
    });

    expect(await validateContract(input, buildOpenApi(input))).toEqual([
      "Model Broken: /type must be equal to one of the allowed values",
      "GET /stocks query parameters: /properties/limit/minimum must be number",
      "GET /stocks 200 response headers: /properties/ETag/type must be equal to one of the allowed values",
    ]);
  });

  it("reports documents that aren't valid OpenAPI", async () => {
    const input = testInput();
    const doc = buildOpenApi(input);
    const broken = { ...doc, info: { title: "x" } } as unknown as typeof doc;

    expect(await validateContract(input, broken)).toEqual([
      "OpenAPI /info: must have required property 'version'",
    ]);
  });
});
