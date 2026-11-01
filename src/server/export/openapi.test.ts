import { describe, expect, it } from "vitest";
import type { EndpointResponse } from "../../shared/endpoints";
import type { ErrorTypeBody } from "../../shared/error-types";
import type { JsonSchema } from "../../shared/json-schema";
import {
  buildOpenApi,
  type ExportInput,
  lintContract,
  validateContract,
} from "./openapi";
import {
  testEndpoint,
  testErrorResponse,
  testErrorType,
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
                errors: [],
              },
              {
                id: "r2",
                status: "404",
                description: "Not Found",
                headers: objectSchema({}),
                body: null,
                errors: [],
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
              errors: [],
            },
            {
              id: "r2",
              status: "409",
              description: "Conflict",
              headers: objectSchema({}),
              body: null,
              errors: [],
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
              errors: [],
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

describe("buildOpenApi with the error catalog", () => {
  const problem = testModel(
    "problem",
    "Problem",
    objectSchema({ type: { type: "string" }, title: { type: "string" } }),
  );
  const validationProblem = testModel(
    "validation",
    "ValidationProblem",
    objectSchema({ errors: { type: "array" } }),
  );
  const challenge = (description: string) =>
    objectSchema({ "WWW-Authenticate": { type: "string", description } }, [
      "WWW-Authenticate",
    ]);
  const tokenExpired = testErrorType("expired", "token-expired", "401", {
    title: "Access token expired",
    description: "The access token is too old. Refresh it, then retry.",
    headers: challenge("The Bearer challenge"),
  });
  const unauthenticated = testErrorType("anon", "unauthenticated", "401", {
    title: "Not signed in",
    headers: challenge("The Bearer challenge, without an error"),
  });
  const retryAfter = (description: string, required: boolean) =>
    objectSchema(
      { "Retry-After": { type: "integer", minimum: 1, description } },
      required ? ["Retry-After"] : [],
    );
  const skuTaken = testErrorType("taken", "sku-taken", "409");
  const inProgress = testErrorType("busy", "request-in-progress", "409", {
    headers: retryAfter("Seconds before resending", true),
  });
  const validationFailed = testErrorType(
    "invalid",
    "validation-failed",
    "422",
    {
      title: "Validation failed",
      body: {
        contentType: "application/problem+json",
        schema: { $ref: "model:validation" },
        example: { type: "https://api.example.com/problems/validation-failed" },
      },
    },
  );

  function inputWith(
    responses: EndpointResponse[],
    changes: Partial<ExportInput> = {},
  ) {
    return testInput({
      models: [problem, validationProblem],
      errorTypes: [tokenExpired, unauthenticated, skuTaken, inProgress],
      endpoints: [testEndpoint("e1", "POST", "/stocks", { responses })],
      ...changes,
    });
  }
  const opResponses = (doc: ReturnType<typeof buildOpenApi>) =>
    doc.paths["/stocks"]?.post?.responses ?? {};

  it("defines each error once, in components.examples, and references it", () => {
    const doc = buildOpenApi(
      inputWith([
        testErrorResponse("401", "Unauthorized", ["expired", "anon"]),
      ]),
    );

    expect(opResponses(doc)["401"]).toEqual({
      description: "Unauthorized",
      headers: {
        "WWW-Authenticate": {
          required: true,
          description: "The Bearer challenge",
          schema: { type: "string" },
        },
      },
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/Problem" },
          examples: {
            "token-expired": { $ref: "#/components/examples/token-expired" },
            unauthenticated: { $ref: "#/components/examples/unauthenticated" },
          },
        },
      },
    });
    expect(doc.components?.examples).toEqual({
      "token-expired": {
        summary: "Access token expired",
        description: "The access token is too old. Refresh it, then retry.",
        value: {
          type: "https://api.example.com/problems/token-expired",
          title: "Access token expired",
          status: 401,
        },
      },
      unauthenticated: {
        summary: "Not signed in",
        value: {
          type: "https://api.example.com/problems/unauthenticated",
          title: "Not signed in",
          status: 401,
        },
      },
      "sku-taken": {
        summary: "sku-taken",
        value: expect.objectContaining({ status: 409 }),
      },
      "request-in-progress": {
        summary: "request-in-progress",
        value: expect.objectContaining({ status: 409 }),
      },
    });
    // Components keep the conventional order.
    expect(Object.keys(doc.components ?? {})).toEqual(["schemas", "examples"]);
  });

  it("leaves documents without a catalog as they were", () => {
    const doc = buildOpenApi(testInput({ models: [problem] }));

    expect(Object.keys(doc.components ?? {})).toEqual(["schemas"]);
  });

  it("lists every error's example of a header they share", () => {
    const withExample = (example: string) =>
      objectSchema(
        {
          "WWW-Authenticate": {
            type: "string",
            description: "The Bearer challenge",
            examples: [example],
          },
        },
        ["WWW-Authenticate"],
      );
    const expired = {
      ...tokenExpired,
      headers: withExample('Bearer error="invalid_token"'),
    };
    const anonymous = { ...unauthenticated, headers: withExample("Bearer") };

    const doc = buildOpenApi(
      inputWith(
        [testErrorResponse("401", "Unauthorized", ["expired", "anon"])],
        {
          errorTypes: [expired, anonymous],
        },
      ),
    );

    expect(opResponses(doc)["401"]?.headers).toEqual({
      "WWW-Authenticate": {
        required: true,
        description: "The Bearer challenge",
        schema: {
          type: "string",
          examples: ['Bearer error="invalid_token"', "Bearer"],
        },
      },
    });
  });

  it("merges the errors' headers: required only if every error requires them", () => {
    const tooManyLogins = testErrorType("logins", "too-many-attempts", "429", {
      headers: retryAfter("Seconds to wait", true),
    });
    const tooManyEmails = testErrorType("emails", "too-many-emails", "429", {
      headers: retryAfter("Seconds until the next email", true),
    });

    const doc = buildOpenApi(
      inputWith(
        [
          testErrorResponse("409", "Conflict", ["taken", "busy"]),
          testErrorResponse("429", "Too Many Requests", ["logins", "emails"]),
          testErrorResponse(
            "4XX",
            "Client error",
            ["busy"],
            objectSchema({ "retry-after": { type: "string" } }),
          ),
        ],
        {
          errorTypes: [skuTaken, inProgress, tooManyLogins, tooManyEmails],
        },
      ),
    );

    expect(opResponses(doc)["409"]?.headers).toEqual({
      "Retry-After": {
        description:
          "Only with `request-in-progress`: Seconds before resending",
        schema: { type: "integer", minimum: 1 },
      },
    });
    expect(opResponses(doc)["429"]?.headers).toEqual({
      "Retry-After": {
        required: true,
        description: "Seconds to wait",
        schema: { type: "integer", minimum: 1 },
      },
    });
    // The response's own headers win, whatever their case.
    expect(opResponses(doc)["4XX"]?.headers).toEqual({
      "retry-after": { schema: { type: "string" } },
    });
  });

  it("uses an endpoint's own examples of an error instead of the catalog's", () => {
    const invalidEmail = {
      type: "https://api.example.com/problems/validation-failed",
      errors: [{ pointer: "#/email" }],
    };

    const doc = buildOpenApi(
      inputWith(
        [
          testErrorResponse("422", "Unprocessable Content", [
            {
              errorTypeId: "invalid",
              examples: [
                {
                  id: "x1",
                  name: "invalid-email",
                  summary: "",
                  value: invalidEmail,
                },
                {
                  id: "x2",
                  name: "no-name",
                  summary: "Name left out",
                  value: invalidEmail,
                },
              ],
            },
          ]),
        ],
        { errorTypes: [validationFailed] },
      ),
    );

    expect(opResponses(doc)["422"]?.content).toEqual({
      "application/problem+json": {
        schema: { $ref: "#/components/schemas/ValidationProblem" },
        examples: {
          // Doc viewers label examples by summary, else by name.
          "invalid-email": { value: invalidEmail },
          "no-name": { summary: "Name left out", value: invalidEmail },
        },
      },
    });
  });

  it("lists every schema and content type the errors of a response use", () => {
    const plain = testErrorType("plain", "unknown-sort", "400", {
      body: {
        contentType: "application/json",
        schema: { type: "object" },
        example: { message: "Unknown sort" },
      },
    });
    const badBody = testErrorType("bad", "bad-body", "400", {
      body: { ...validationFailed.body, example: {} } as ErrorTypeBody,
    });
    const badQuery = testErrorType("query", "bad-query", "400");

    const doc = buildOpenApi(
      inputWith(
        [testErrorResponse("400", "Bad Request", ["query", "bad", "plain"])],
        { errorTypes: [plain, badBody, badQuery] },
      ),
    );

    const content = (opResponses(doc)["400"]?.content ?? {}) as Record<
      string,
      JsonSchema
    >;
    expect(Object.keys(content)).toEqual([
      "application/problem+json",
      "application/json",
    ]);
    expect(content["application/problem+json"]?.schema).toEqual({
      anyOf: [
        { $ref: "#/components/schemas/Problem" },
        { $ref: "#/components/schemas/ValidationProblem" },
      ],
    });
    expect(content["application/json"]).toEqual({
      schema: { type: "object" },
      examples: {
        "unknown-sort": { $ref: "#/components/examples/unknown-sort" },
      },
    });
  });

  it("exports one page with only the errors its endpoints use, and their models", () => {
    const input = testInput({
      models: [problem, validationProblem],
      errorTypes: [tokenExpired, unauthenticated, validationFailed],
      endpoints: [
        testEndpoint("me", "GET", "/me", {
          responses: [testErrorResponse("401", "Unauthorized", ["expired"])],
        }),
        testEndpoint("login", "POST", "/auth/login", {
          responses: [
            testErrorResponse("422", "Unprocessable Content", ["invalid"]),
          ],
        }),
      ],
      pages: [
        testPage("p1", "App shell", [
          { endpointId: "me", trigger: "on_load", note: "" },
        ]),
      ],
    });

    const doc = buildOpenApi(input, { pageId: "p1" });

    expect(Object.keys(doc.components?.examples ?? {})).toEqual([
      "token-expired",
    ]);
    expect(Object.keys(doc.components?.schemas ?? {})).toEqual(["Problem"]);
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
              errors: [],
            },
            {
              id: "r2",
              status: "204",
              description: "No Content",
              headers: objectSchema({}),
              body: null,
              errors: [],
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

  it("warns about unused errors and problem details that contradict their error", () => {
    const problemExample = (status: number, title: string, type = "taken") => ({
      type: `https://api.example.com/problems/${type}`,
      title,
      status,
    });
    const taken = testErrorType("taken", "taken", "409", {
      title: "SKU already used",
      body: {
        contentType: "application/problem+json",
        schema: {},
        example: problemExample(400, "SKU used"),
      },
    });
    const unused = testErrorType("unused", "unused", "418");
    // Not problem details, so its members mean something else.
    const custom = testErrorType("custom", "custom", "409", {
      body: {
        contentType: "application/json",
        schema: {},
        example: { status: "conflict", title: "Other" },
      },
    });
    const input = testInput({
      errorTypes: [taken, custom, unused],
      endpoints: [
        testEndpoint("add", "POST", "/stocks", {
          requestBody: null,
          responses: [
            testErrorResponse("409", "Conflict", [
              {
                errorTypeId: "taken",
                examples: [
                  {
                    id: "x1",
                    name: "own",
                    summary: "",
                    value: problemExample(409, "SKU already used", "other"),
                  },
                ],
              },
              "custom",
            ]),
          ],
        }),
      ],
      pages: [
        testPage("p1", "Add stock", [
          { endpointId: "add", trigger: "on_submit", note: "" },
        ]),
      ],
    });

    expect(lintContract(input)).toEqual([
      {
        kind: "error-mismatch",
        target: { type: "endpoint", id: "add" },
        message:
          "POST /stocks: the 409 example own has another type than taken's example",
      },
      {
        kind: "error-mismatch",
        target: { type: "error-type", id: "taken" },
        message: "taken: the example's status is 400, but the error's is 409",
      },
      {
        kind: "error-mismatch",
        target: { type: "error-type", id: "taken" },
        message: "taken: the example's title isn't the error's title",
      },
      {
        kind: "unused-error-type",
        target: { type: "error-type", id: "unused" },
        message: "unused isn't used by any endpoint",
      },
    ]);
  });

  it("warns about error types that share a type, or define a header differently", () => {
    const slow = (id: string, name: string, type: string, header: JsonSchema) =>
      testErrorType(id, name, "429", {
        headers: objectSchema({ "Retry-After": header }),
        body: {
          contentType: "application/problem+json",
          schema: {},
          example: { type, title: name, status: 429 },
        },
      });
    const input = testInput({
      errorTypes: [
        slow("a", "slow-a", "https://example.com/slow", { type: "integer" }),
        slow("b", "slow-b", "https://example.com/slow", { type: "string" }),
        slow("c", "slow-c", "about:blank", { type: "integer" }),
        slow("d", "slow-d", "about:blank", { type: "integer" }),
      ],
      endpoints: [
        testEndpoint("e1", "POST", "/emails", {
          requestBody: null,
          responses: [
            testErrorResponse("429", "Too Many Requests", ["a", "b", "c", "d"]),
          ],
        }),
      ],
      pages: [
        testPage("p1", "Emails", [
          { endpointId: "e1", trigger: "on_submit", note: "" },
        ]),
      ],
    });

    expect(lintContract(input)).toEqual([
      {
        kind: "error-mismatch",
        target: { type: "endpoint", id: "e1" },
        message:
          "POST /emails: the 429 response's error types define Retry-After differently; the export uses slow-a's",
      },
      {
        kind: "error-mismatch",
        target: { type: "error-type", id: "b" },
        message: "slow-b has the same type as slow-a: https://example.com/slow",
      },
    ]);
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
              errors: [],
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

  it("reports invalid schemas of catalog errors", async () => {
    const input = testInput({
      errorTypes: [
        testErrorType("slow", "slow-down", "429", {
          headers: objectSchema({
            "Retry-After": { type: "number", minimum: "1" },
          }),
          body: {
            contentType: "application/problem+json",
            schema: { type: "obj" },
            example: {},
          },
        }),
      ],
    });

    expect(await validateContract(input, buildOpenApi(input))).toEqual([
      "Error type slow-down headers: /properties/Retry-After/minimum must be number",
      "Error type slow-down body: /type must be equal to one of the allowed values",
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
