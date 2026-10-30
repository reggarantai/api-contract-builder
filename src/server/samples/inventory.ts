/**
 * The sample project: an inventory app with Login, Registration, Stock list,
 * and Create schedule pages. It's built through the API, so it's always
 * valid, and the export tests compare its exports with golden files.
 */

type Request = (
  method: string,
  url: string,
  body?: unknown,
) => Promise<Response> | Response;

type Upload = (
  url: string,
  files: { name: string; type: string; data: Uint8Array }[],
) => Promise<Response> | Response;

/** Mockups per page, by file name in samples/mockups (without .png). */
export const SAMPLE_MOCKUPS = {
  login: [
    { name: "login-form", caption: "Sign-in form" },
    { name: "login-error", caption: "Wrong password" },
  ],
  registration: [{ name: "registration", caption: "" }],
  stockList: [{ name: "stock-list", caption: "Item with no stock in red" }],
  createSchedule: [{ name: "create-schedule", caption: "" }],
};

export const SAMPLE_ITEMS = [
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

export async function buildInventorySample(
  client: { request: Request; upload: Upload },
  readMockup: (name: string) => Uint8Array,
  onProjectCreated: (projectId: string) => void = () => {},
) {
  const { request, upload } = client;
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
  onProjectCreated(project.id);
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

  // --- Models ---------------------------------------------------------------
  const model = (name: string, description: string, schema?: unknown) =>
    send(request, "POST", `${base}/models`, { name, description, schema });
  const ref = (target: { id: string }) => ({ $ref: `model:${target.id}` });

  const category = await model("Category", "A group of stock items.");
  await send(request, "PATCH", `${base}/models/${category.id}`, {
    schema: {
      type: "object",
      required: ["id", "name"],
      properties: {
        id: { type: "string", format: "uuid" },
        name: { type: "string" },
        parent: { anyOf: [ref(category), { type: "null" }] },
      },
    },
  });
  const stock = await model("Stock", "An item in stock.", {
    type: "object",
    required: ["sku", "name", "quantity"],
    properties: {
      sku: { type: "string", pattern: "^[A-Z0-9-]+$", examples: ["SKU-001"] },
      name: { type: "string", maxLength: 120 },
      quantity: { type: "integer", minimum: 0 },
      category: ref(category),
      tags: { type: "array", items: { type: "string" }, uniqueItems: true },
    },
  });
  const supplier = await model("Supplier", "A company that delivers stock.", {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      email: { type: "string", format: "email" },
    },
  });
  const schedule = await model(
    "Schedule",
    "Recurring deliveries of one item from one supplier.",
    {
      type: "object",
      required: [
        "id",
        "supplierId",
        "sku",
        "quantity",
        "firstDelivery",
        "repeat",
      ],
      properties: {
        id: { type: "string", format: "uuid" },
        supplierId: { type: "string", format: "uuid" },
        sku: { type: "string" },
        quantity: { type: "integer", minimum: 1 },
        firstDelivery: { type: "string", format: "date" },
        repeat: { type: "string", enum: ["once", "weekly", "monthly"] },
        note: { type: ["string", "null"], maxLength: 500 },
      },
    },
  );
  const user = await model("User", "A person who can sign in.", {
    type: "object",
    required: ["id", "name", "email"],
    properties: {
      id: { type: "string", format: "uuid" },
      name: { type: "string" },
      email: { type: "string", format: "email" },
    },
  });
  const error = await model("Error", "", {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
      code: {
        type: "string",
        description: "Stable code to branch on, e.g. ACCOUNT_LOCKED",
      },
    },
  });

  const json = (schema: unknown, examples: [string, unknown, string?][]) => ({
    contentType: "application/json",
    schema,
    examples: examples.map(([name, value, summary = ""]) => ({
      id: name,
      name,
      summary,
      value,
    })),
  });
  const errorResponse = (
    status: string,
    description: string,
    name: string,
    value: unknown,
  ) => ({
    id: status,
    status,
    description,
    body: json(ref(error), [[name, value]]),
  });
  const ana = {
    id: "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
    name: "Ana Lima",
    email: "ana@example.com",
  };
  const acme = {
    id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b",
    name: "Acme Supplies",
    email: "orders@acme.example",
  };

  // --- Endpoints ------------------------------------------------------------
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
  const skuPath = {
    type: "object",
    properties: { sku: { type: "string", description: "Stock keeping unit" } },
    required: ["sku"],
  };

  const login = await endpoint("POST", "/auth/login", "Sign in", () => ({
    status: "agreed",
    security: { type: "none" },
    description:
      "After 5 wrong passwords in a row the account is locked for 15 minutes.",
    notesFe: "Keep the email after an error.",
    requestBody: {
      ...json(
        {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", format: "email" },
            password: { type: "string", format: "password", minLength: 8 },
            remember: {
              type: "boolean",
              description: "Keep the session for 30 days",
            },
          },
        },
        [
          [
            "valid",
            { email: ana.email, password: "correct-horse", remember: true },
          ],
        ],
      ),
      required: true,
      description: "",
    },
    responses: [
      {
        id: "ok",
        status: "200",
        description: "OK",
        body: json(
          {
            type: "object",
            required: ["token", "user"],
            properties: { token: { type: "string" }, user: ref(user) },
          },
          [["signed-in", { token: "eyJhbGciOi...", user: ana }]],
        ),
      },
      errorResponse("401", "Unauthorized", "wrong-password", {
        message: "Email or password is wrong. 4 attempts left.",
        code: "WRONG_PASSWORD",
      }),
      errorResponse("423", "Account locked", "locked", {
        message: "Too many attempts. Try again in 15 minutes.",
        code: "ACCOUNT_LOCKED",
      }),
    ],
  }));

  const me = await endpoint("GET", "/me", "Current user", () => ({
    status: "agreed",
    responses: [
      {
        id: "ok",
        status: "200",
        description: "OK",
        body: json(ref(user), [["ana", ana]]),
      },
      errorResponse("401", "Unauthorized", "signed-out", {
        message: "Sign in first.",
      }),
    ],
  }));

  const register = await endpoint(
    "POST",
    "/auth/register",
    "Create an account",
    () => ({
      status: "review",
      security: { type: "none" },
      requestBody: {
        ...json(
          {
            type: "object",
            required: ["name", "email", "password"],
            properties: {
              name: { type: "string", minLength: 1, maxLength: 80 },
              email: { type: "string", format: "email" },
              password: { type: "string", format: "password", minLength: 8 },
            },
          },
          [
            [
              "new-user",
              { name: ana.name, email: ana.email, password: "correct-horse" },
            ],
          ],
        ),
        required: true,
        description: "",
      },
      responses: [
        {
          id: "created",
          status: "201",
          description: "Created",
          body: json(ref(user), [["created", ana]]),
        },
        errorResponse("409", "Conflict", "email-taken", {
          message: "An account with this email already exists.",
          code: "EMAIL_TAKEN",
        }),
      ],
      notesBe: "Send a welcome email after creating the account.",
    }),
  );

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
            search: { type: "string", description: "Matches SKU or name" },
          },
        },
      },
      responses: [
        {
          id: "ok",
          status: "200",
          description: "OK",
          body: json({ type: "array", items: ref(stock) }, [
            ["two-items", SAMPLE_ITEMS, "Two items"],
            ["empty", [], "No items yet"],
          ]),
        },
      ],
    }),
  );

  const remove = await endpoint(
    "DELETE",
    "/stocks/{sku}",
    "Remove a stock item",
    (created) => ({
      status: "review",
      parameters: { ...(created.parameters as object), path: skuPath },
      responses: [
        { id: "204", status: "204", description: "No Content", body: null },
        errorResponse("404", "Not Found", "not-found", {
          message: "No item SKU-999",
        }),
      ],
    }),
  );

  const suppliers = await endpoint(
    "GET",
    "/suppliers",
    "List suppliers",
    () => ({
      status: "draft",
      responses: [
        {
          id: "ok",
          status: "200",
          description: "OK",
          body: json({ type: "array", items: ref(supplier) }, [
            ["one-supplier", [acme]],
          ]),
        },
      ],
    }),
  );

  const scheduleInput = {
    supplierId: acme.id,
    sku: "SKU-002",
    quantity: 50,
    firstDelivery: "2026-11-15",
    repeat: "weekly",
    note: null,
  };
  const createSchedule = await endpoint(
    "POST",
    "/schedules",
    "Create a restock schedule",
    () => ({
      status: "draft",
      requestBody: {
        ...json(
          {
            type: "object",
            required: [
              "supplierId",
              "sku",
              "quantity",
              "firstDelivery",
              "repeat",
            ],
            properties: {
              supplierId: { type: "string", format: "uuid" },
              sku: { type: "string" },
              quantity: { type: "integer", minimum: 1 },
              firstDelivery: { type: "string", format: "date" },
              repeat: { type: "string", enum: ["once", "weekly", "monthly"] },
              note: { type: ["string", "null"], maxLength: 500 },
            },
          },
          [["weekly", scheduleInput]],
        ),
        required: true,
        description: "",
      },
      responses: [
        {
          id: "created",
          status: "201",
          description: "Created",
          body: json(ref(schedule), [
            [
              "created",
              { id: "4d3c2b1a-0f9e-4d8c-b7a6-5f4e3d2c1b0a", ...scheduleInput },
            ],
          ]),
        },
        errorResponse("422", "Unprocessable Content", "past-date", {
          message: "The first delivery must be in the future.",
          code: "DATE_IN_PAST",
        }),
      ],
      notesFe: "Only offer items whose supplier is set.",
    }),
  );

  await endpoint("GET", "/health", "Health check", () => ({
    security: { type: "none" },
    description:
      "For monitoring. No page uses it and it has no example, so the Export tab warns about both.",
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

  // --- Pages ----------------------------------------------------------------
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
  async function page(
    name: string,
    fields: { description: string; acceptanceCriteria: string },
    links: unknown[],
    mockups: { name: string; caption: string }[],
  ) {
    const created = await send(request, "POST", `${base}/pages`, { name });
    await send(request, "PATCH", `${base}/pages/${created.id}`, {
      ...fields,
      endpoints: links,
    });
    const url = `${base}/pages/${created.id}/mockups`;
    const response = await upload(
      url,
      mockups.map((mockup) => ({
        name: `${mockup.name}.png`,
        type: "image/png",
        data: readMockup(mockup.name),
      })),
    );
    const uploaded = (await response.json()) as { id: string }[];
    for (const [index, mockup] of mockups.entries()) {
      if (mockup.caption) {
        await send(request, "PATCH", `${url}/${uploaded[index]?.id}`, {
          caption: mockup.caption,
        });
      }
    }
    return created;
  }

  const loginPage = await page(
    "Login",
    {
      description: "Users sign in with their email and password.",
      acceptanceCriteria:
        "- [ ] A wrong password shows the error from the API above the form\n- [ ] The email stays filled in after an error\n- [ ] A locked account sees when it can try again",
    },
    [
      link("l1", me.id, "on_load", "Skip the page when already signed in"),
      link("l2", login.id, "on_submit", "Show errors inline"),
    ],
    SAMPLE_MOCKUPS.login,
  );
  const registrationPage = await page(
    "Registration",
    {
      description: "New users create an account with their work email.",
      acceptanceCriteria:
        "- [ ] An email that's already registered shows a link to sign in\n- [ ] The password needs at least 8 characters",
    },
    [link("l1", register.id, "on_submit")],
    SAMPLE_MOCKUPS.registration,
  );
  const stockListPage = await page(
    "Stock list",
    {
      description:
        "All items with their quantity. Items with no stock are highlighted.",
      acceptanceCriteria:
        "- [ ] Items with quantity 0 are shown in red\n- [ ] Deleting asks for confirmation",
    },
    [
      link("l1", list.id, "on_load"),
      link("l2", remove.id, "on_action", "Delete button in each row"),
    ],
    SAMPLE_MOCKUPS.stockList,
  );
  const createSchedulePage = await page(
    "Create schedule",
    {
      description: "Plans recurring restock deliveries from a supplier.",
      acceptanceCriteria: "- [ ] The first delivery can't be in the past",
    },
    [
      link("l1", suppliers.id, "on_load", "Fill the supplier list"),
      link("l2", list.id, "on_load", "Fill the item list"),
      link("l3", createSchedule.id, "on_submit"),
    ],
    SAMPLE_MOCKUPS.createSchedule,
  );

  return {
    projectId: project.id,
    pageIds: {
      login: loginPage.id,
      registration: registrationPage.id,
      stockList: stockListPage.id,
      createSchedule: createSchedulePage.id,
    },
  };
}
