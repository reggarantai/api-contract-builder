/**
 * A small but complete contract, built through the API: two servers, two
 * security schemes, models that reference each other (and themselves),
 * endpoints with every kind of parameter and body, and pages calling them.
 * Exports of it are compared with golden files.
 */

type Request = (
  method: string,
  url: string,
  body?: unknown,
) => Promise<Response> | Response;

async function send<T = { id: string }>(
  request: Request,
  method: string,
  url: string,
  body?: unknown,
): Promise<T> {
  const response = await request(method, url, body);
  if (!response.ok) {
    throw new Error(
      `${method} ${url} failed: ${response.status} ${await response.text()}`,
    );
  }
  return (await response.json()) as T;
}

export async function buildInventoryProject(request: Request) {
  const project = await send<{ id: string; slug: string }>(
    request,
    "POST",
    "/api/projects",
    {
      name: "Inventory App",
      description: "Stock and warehouse API.",
      apiVersion: "1.2.0",
    },
  );
  const base = `/api/projects/${project.id}`;
  await send(request, "PATCH", base, {
    servers: [
      {
        id: "prod",
        name: "Production",
        url: "https://api.inventory.example/v1",
        description: "",
      },
      {
        id: "staging",
        name: "Staging",
        url: "https://staging.inventory.example/v1",
        description: "Reset every night",
      },
    ],
    securitySchemes: [
      {
        id: "bearer",
        key: "bearerAuth",
        type: "bearer",
        bearerFormat: "JWT",
        description: "Token from POST /auth/login",
      },
      {
        id: "key",
        key: "apiKeyAuth",
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "For server-to-server calls",
      },
    ],
    defaultSecuritySchemeId: "bearer",
  });

  // Models
  const category = await send(request, "POST", `${base}/models`, {
    name: "Category",
    description: "A group of stock items.",
  });
  await send(request, "PATCH", `${base}/models/${category.id}`, {
    schema: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        parent: { anyOf: [{ $ref: `model:${category.id}` }, { type: "null" }] },
      },
    },
  });
  const stock = await send(request, "POST", `${base}/models`, {
    name: "Stock",
    description: "An item in stock.",
    schema: {
      type: "object",
      required: ["sku", "name", "quantity"],
      properties: {
        sku: { type: "string", pattern: "^[A-Z0-9-]+$", examples: ["SKU-001"] },
        name: { type: "string", maxLength: 120 },
        quantity: { type: "integer", minimum: 0 },
        category: { $ref: `model:${category.id}` },
        tags: { type: "array", items: { type: "string" }, uniqueItems: true },
      },
    },
  });
  const error = await send(request, "POST", `${base}/models`, {
    name: "Error",
    schema: {
      type: "object",
      required: ["message"],
      properties: { message: { type: "string" }, code: { type: "string" } },
    },
  });
  const ref = (model: { id: string }) => ({ $ref: `model:${model.id}` });
  const errorBody = (name: string, message: string) => ({
    contentType: "application/json",
    schema: ref(error),
    examples: [{ id: name, name, summary: "", value: { message } }],
  });

  const items = [
    {
      sku: "SKU-001",
      name: "Widget",
      quantity: 12,
      category: {
        id: "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
        name: "Parts",
        parent: null,
      },
      tags: ["metal"],
    },
    { sku: "SKU-002", name: "Gadget", quantity: 0 },
  ];

  // Endpoints
  async function endpoint(
    method: string,
    path: string,
    summary: string,
    changes: (created: Record<string, unknown>) => Record<string, unknown>,
  ) {
    const created = await send<Record<string, unknown> & { id: string }>(
      request,
      "POST",
      `${base}/endpoints`,
      { method, path, summary },
    );
    await send(
      request,
      "PATCH",
      `${base}/endpoints/${created.id}`,
      changes(created),
    );
    return created;
  }

  const login = await endpoint("POST", "/auth/login", "Sign in", () => ({
    status: "agreed",
    security: { type: "none" },
    notesFe: "Keep the email after an error.",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "",
      schema: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string", format: "password", minLength: 8 },
        },
      },
      examples: [
        {
          id: "valid",
          name: "valid",
          summary: "",
          value: { email: "ana@example.com", password: "correct-horse" },
        },
      ],
    },
    responses: [
      {
        id: "ok",
        status: "200",
        description: "OK",
        body: {
          contentType: "application/json",
          schema: {
            type: "object",
            required: ["token"],
            properties: { token: { type: "string" } },
          },
          examples: [
            {
              id: "signed-in",
              name: "signed-in",
              summary: "",
              value: { token: "eyJhbGciOi..." },
            },
          ],
        },
      },
      {
        id: "401",
        status: "401",
        description: "Unauthorized",
        body: errorBody("wrong-password", "Email or password is wrong"),
      },
    ],
  }));

  const list = await endpoint(
    "GET",
    "/stocks",
    "List stock items",
    (created) => ({
      status: "agreed",
      parameters: {
        ...(created.parameters as object),
        query: {
          type: "object",
          properties: {
            page: {
              type: "integer",
              minimum: 1,
              description: "Page number, from 1",
            },
            category: {
              type: "string",
              format: "uuid",
              description: "Only items in this category",
            },
          },
        },
      },
      responses: [
        {
          id: "ok",
          status: "200",
          description: "OK",
          body: {
            contentType: "application/json",
            schema: { type: "array", items: ref(stock) },
            examples: [
              {
                id: "two",
                name: "two-items",
                summary: "Two items",
                value: items,
              },
              {
                id: "empty",
                name: "empty",
                summary: "No items yet",
                value: [],
              },
            ],
          },
        },
      ],
    }),
  );

  const add = await endpoint("POST", "/stocks", "Add a stock item", () => ({
    status: "review",
    notesBe: "Reject duplicate SKUs with 409.",
    requestBody: {
      contentType: "application/json",
      required: true,
      description: "The new item",
      schema: ref(stock),
      examples: [{ id: "new", name: "new-item", summary: "", value: items[1] }],
    },
    responses: [
      {
        id: "created",
        status: "201",
        description: "Created",
        body: {
          contentType: "application/json",
          schema: ref(stock),
          examples: [
            { id: "created", name: "created", summary: "", value: items[1] },
          ],
        },
      },
      {
        id: "409",
        status: "409",
        description: "Conflict",
        body: errorBody("duplicate-sku", "SKU-002 already exists"),
      },
    ],
  }));

  const pathParameters = {
    type: "object",
    properties: { sku: { type: "string", description: "Stock keeping unit" } },
    required: ["sku"],
  };
  const detail = await endpoint(
    "GET",
    "/stocks/{sku}",
    "Get a stock item",
    (created) => ({
      parameters: { ...(created.parameters as object), path: pathParameters },
      responses: [
        {
          id: "ok",
          status: "200",
          description: "OK",
          body: {
            contentType: "application/json",
            schema: ref(stock),
            examples: [
              { id: "found", name: "found", summary: "", value: items[0] },
            ],
          },
        },
        {
          id: "404",
          status: "404",
          description: "Not Found",
          body: errorBody("not-found", "No item SKU-999"),
        },
      ],
    }),
  );

  const remove = await endpoint(
    "DELETE",
    "/stocks/{sku}",
    "Remove a stock item",
    (created) => ({
      deprecated: true,
      security: { type: "schemes", schemeIds: ["key"] },
      parameters: { ...(created.parameters as object), path: pathParameters },
      responses: [
        { id: "204", status: "204", description: "No Content", body: null },
      ],
    }),
  );

  // Not on any page, and without examples: lint warns about it.
  await endpoint("GET", "/health", "Health check", () => ({
    security: { type: "none" },
    responses: [
      {
        id: "ok",
        status: "200",
        description: "OK",
        body: {
          contentType: "application/json",
          schema: {
            type: "object",
            properties: { status: { type: "string" } },
          },
          examples: [],
        },
      },
    ],
  }));

  // Pages
  async function page(name: string, description: string, links: unknown[]) {
    const created = await send(request, "POST", `${base}/pages`, { name });
    await send(request, "PATCH", `${base}/pages/${created.id}`, {
      description,
      endpoints: links,
    });
    return created;
  }
  const link = (
    id: string,
    endpointId: string,
    trigger: string,
    note = "",
  ) => ({
    id,
    endpointId,
    trigger,
    note,
  });

  await page("Login", "Users sign in with email and password.", [
    link("l1", login.id, "on_submit", "Show errors inline"),
  ]);
  const stockList = await page("Stock list", "All items, newest first.", [
    link("l1", list.id, "on_load"),
    link("l2", remove.id, "on_action", "Delete button in each row"),
  ]);
  await page("Stock detail", "", [link("l1", detail.id, "on_load")]);
  await page("Add stock", "", [link("l1", add.id, "on_submit")]);

  return { projectId: project.id, stockListPageId: stockList.id, items };
}
