/**
 * The sample project: an inventory app with accounts and sign-in, written
 * the way a production API would be (problem details, paging, refresh
 * tokens, idempotent creates). It's built through the API, so it's always
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
    { name: "login-error", caption: "Wrong email or password" },
  ],
  registration: [
    { name: "registration-form", caption: "" },
    { name: "registration-check-email", caption: "After sending the form" },
  ],
  verifyEmail: [
    { name: "verify-email-expired", caption: "The link has expired" },
  ],
  forgotPassword: [{ name: "forgot-password", caption: "" }],
  resetPassword: [{ name: "reset-password", caption: "" }],
  appShell: [{ name: "app-shell", caption: "User menu open" }],
  stockList: [
    {
      name: "stock-list",
      caption: "Items low on stock and out of stock stand out",
    },
  ],
  stockItem: [
    { name: "stock-item", caption: "Details and movement history" },
    { name: "record-movement", caption: "Record movement dialog" },
  ],
  stockItemForm: [{ name: "stock-item-form", caption: "Edit mode" }],
};

const DESCRIPTION = `Stock tracking for the warehouse team: accounts and sign-in, stock items, and stock movements.

Every endpoint follows these conventions:

- **Errors** are problem details ([RFC 9457](https://www.rfc-editor.org/rfc/rfc9457)) in \`application/problem+json\`; branch on \`type\`. 400 means invalid query or header parameters, 422 invalid body fields (listed in \`errors\`), and 404 an unknown or deleted ID. Other errors, like 415 or 500, are problem details too.
- **Authentication**: send \`Authorization: Bearer <access token>\`. A 401 means the token is missing or expired: refresh once with \`POST /auth/refresh\`, then retry. If refreshing answers 401, sign in again.
- **Paged lists** return \`{ data, meta }\` and take \`page\` and \`pageSize\`. Short lists return \`{ data }\`.
- **Creates** take an \`Idempotency-Key\` header, so a retry never creates something twice.
- **Requests** send JSON. PATCH sends a JSON Merge Patch (\`application/merge-patch+json\`).
- **Responses** send \`Cache-Control: no-store\`.
- **CORS** allows only the app's origin, with credentials. It exposes \`Location\` and \`Retry-After\` to scripts, and allows the \`Idempotency-Key\` request header.
- **Times** are UTC, in RFC 3339 format.`;

// --- Example data ---------------------------------------------------------

const PROBLEMS = "https://api.inventory.example/problems/";

const ana = {
  id: "0b5c2d4e-8f1a-4b3c-9d2e-7a6f5e4d3c2b",
  name: "Ana Lima",
  email: "ana@example.com",
  role: "admin",
  emailVerified: true,
  createdAt: "2026-03-02T09:00:00Z",
};
const budi = { name: "Budi Santoso", email: "budi@example.com" };

const packaging = {
  id: "6f1c2b9e-0b7a-4c64-9a8e-2f1d3c4b5a69",
  name: "Packaging",
};
const spareParts = {
  id: "a3d5f7b9-1c2e-4f6a-8b0d-9e7c5a3b1d2f",
  name: "Spare parts",
};
const cleaning = {
  id: "c8e2a4b6-3d5f-4a7c-9e1b-2f4d6a8c0e3b",
  name: "Cleaning supplies",
};

const box = {
  id: "1e3a5c7e-9b2d-4f6a-8c0e-3b5d7f9a1c2e",
  sku: "BOX-S-001",
  name: "Shipping box, small",
  description: "Single wall, 30 × 20 × 15 cm",
  category: packaging,
  unit: "piece",
  quantityOnHand: 340,
  reorderPoint: 100,
  stockStatus: "in_stock",
  createdAt: "2026-09-14T08:30:00Z",
  updatedAt: "2026-10-28T14:05:00Z",
} as const;
const tape = {
  id: "2f4b6d8f-0c3e-4a7b-9d1f-4c6e8a0b2d3f",
  sku: "TAPE-050",
  name: "Packing tape, 50 m",
  description: null,
  category: packaging,
  unit: "roll",
  quantityOnHand: 18,
  reorderPoint: 24,
  stockStatus: "low_stock",
  createdAt: "2026-09-14T08:34:00Z",
  updatedAt: "2026-10-29T10:20:00Z",
} as const;
const film = {
  id: "3a5c7e9a-1d4f-4b8c-8e2a-5d7f9b1c3e4a",
  sku: "FILM-500",
  name: "Stretch film, 500 mm",
  description: "23 µm, for wrapping pallets by hand",
  category: packaging,
  unit: "roll",
  quantityOnHand: 0,
  reorderPoint: 10,
  stockStatus: "out_of_stock",
  createdAt: "2026-09-20T13:00:00Z",
  updatedAt: "2026-10-27T17:45:00Z",
} as const;

/** The first example of `GET /stock-items`. */
export const SAMPLE_STOCK_ITEMS_PAGE = {
  data: [box, tape, film],
  meta: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 },
} as const;

const recordedBy = { id: ana.id, name: ana.name };
const receipt = {
  id: "4b6d8f0b-2e5a-4c9d-9f3b-6e8a0c2d4f5b",
  type: "receipt",
  quantity: 200,
  quantityChange: 200,
  quantityAfter: 340,
  reference: "DN-2026-1042",
  note: null,
  createdBy: recordedBy,
  createdAt: "2026-10-28T14:05:00Z",
};
const issue = {
  id: "5c7e9a1c-3f6b-4d0e-8a4c-7f9b1d3e5a6c",
  type: "issue",
  quantity: 25,
  quantityChange: -25,
  quantityAfter: 140,
  reference: "SO-88213",
  note: null,
  createdBy: recordedBy,
  createdAt: "2026-10-15T11:30:00Z",
};
const count = {
  id: "6d8f0b2d-4a7c-4e1f-9b5d-8a0c2e4f6b7d",
  type: "count",
  quantity: 165,
  quantityChange: -3,
  quantityAfter: 165,
  reference: null,
  note: "Monthly stock take",
  createdBy: recordedBy,
  createdAt: "2026-10-01T16:00:00Z",
};

// --- Building blocks --------------------------------------------------------

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

type Schema = Record<string, unknown>;
type Examples = [name: string, value: unknown, summary?: string][];

const object = (properties: Schema, required = Object.keys(properties)) => ({
  type: "object",
  properties,
  ...(required.length > 0 ? { required } : {}),
});
const NONE = { type: "object", properties: {} };

const uuid = (description = "") => ({
  type: "string",
  format: "uuid",
  ...(description ? { description } : {}),
});
const dateTime = { type: "string", format: "date-time" };
const email = { type: "string", format: "email", maxLength: 254 };
const nullableText = (maxLength: number, description = "") => ({
  type: ["string", "null"],
  maxLength,
  ...(description ? { description } : {}),
});

function body(contentType: string, schema: unknown, examples: Examples) {
  return {
    contentType,
    schema,
    examples: examples.map(([name, value, summary = ""]) => ({
      id: name,
      name,
      summary,
      value,
    })),
  };
}
const json = (schema: unknown, examples: Examples) =>
  body("application/json", schema, examples);
const requestBody = (
  schema: unknown,
  examples: Examples,
  contentType = "application/json",
) => ({
  ...body(contentType, schema, examples),
  required: true,
  description: "",
});

function response(
  status: string,
  description: string,
  parts: { headers?: Schema; body?: unknown } = {},
) {
  return {
    id: status,
    status,
    description,
    headers: parts.headers ?? NONE,
    body: parts.body ?? null,
  };
}

const problem = (
  status: number,
  slug: string,
  title: string,
  detail: string,
) => ({ type: `${PROBLEMS}${slug}`, title, status, detail });

// Response headers, as properties of a headers schema.
const retryAfter = (seconds: number, description = "") => ({
  "Retry-After": {
    type: "integer",
    minimum: 1,
    description: description || "Seconds to wait before trying again",
    examples: [seconds],
  },
});
const setCookie = (description: string, value: string) => ({
  "Set-Cookie": { type: "string", description, examples: [value] },
});
const noStore = {
  "Cache-Control": {
    type: "string",
    enum: ["no-store"],
    description: "Tokens must never be stored by a cache (RFC 6749)",
  },
};
const COOKIE_ATTRIBUTES = "HttpOnly; Secure; SameSite=Strict; Path=/v1/auth";
const clearCookie = setCookie(
  "Clears the refresh token cookie",
  `refresh_token=; ${COOKIE_ATTRIBUTES}; Max-Age=0`,
);

const idempotencyKey = object({
  "Idempotency-Key": {
    type: "string",
    minLength: 1,
    maxLength: 64,
    description:
      "A random value, like a UUID, for each thing to create. Resending with the same key gets the first success back (for 24 hours) instead of creating again. Failures aren't remembered, so a fixed request can reuse the key. The key with a different body after a success answers 400; a resend while the first request runs answers 409 `request-in-progress`.",
    examples: ["3f1d8a52-6b0e-4c1a-9d7e-2b4c6a8e0f13"],
  },
});
const itemIdPath = object({
  itemId: uuid(
    "The stock item's ID. Unknown, malformed, and deleted IDs answer 404.",
  ),
});
const paging = {
  page: {
    type: "integer",
    minimum: 1,
    default: 1,
    description: "Page number, from 1",
  },
  pageSize: {
    type: "integer",
    minimum: 1,
    maximum: 100,
    default: 20,
    description: "Items per page",
  },
};

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
    { name: "Inventory App", description: DESCRIPTION, apiVersion: "1.0.0" },
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
        url: "https://api.inventory-staging.example/v1",
        description:
          "Reset every night. A separate site, so cookies never cross between staging and production.",
      },
    ],
    securitySchemes: [
      {
        id: "bearer",
        key: "bearerAuth",
        type: "bearer",
        bearerFormat: "JWT",
        description:
          "Access token from POST /auth/login or POST /auth/refresh. It expires after 15 minutes.",
      },
      {
        id: "refresh",
        key: "refreshCookie",
        type: "apiKey",
        in: "cookie",
        name: "refresh_token",
        description:
          "HttpOnly cookie set by POST /auth/login and replaced by POST /auth/refresh.",
      },
    ],
    defaultSecuritySchemeId: "bearer",
  });

  // --- Models ---------------------------------------------------------------
  const model = (name: string, description: string, schema: unknown) =>
    send(request, "POST", `${base}/models`, { name, description, schema });
  const ref = (target: { id: string }) => ({ $ref: `model:${target.id}` });

  const problemType = (slug: string) => ({
    type: "string",
    format: "uri",
    description: "Identifies the kind of problem. It's stable: branch on it.",
    examples: [`${PROBLEMS}${slug}`],
  });
  const problemFields = {
    title: {
      type: "string",
      description: "Short summary of the kind of problem",
    },
    status: {
      type: "integer",
      minimum: 400,
      maximum: 599,
      description: "The HTTP status code",
    },
    detail: {
      type: "string",
      description: "What went wrong this time, in words for people",
    },
    instance: {
      type: "string",
      format: "uri-reference",
      description:
        "Identifies this occurrence. Quote it when reporting a problem.",
    },
  };
  const problemModel = await model(
    "Problem",
    "An error, as RFC 9457 problem details. Branch on `type`, not on `title` or `detail`.",
    object({ type: problemType("not-found"), ...problemFields }, [
      "type",
      "title",
      "status",
    ]),
  );
  const validationProblem = await model(
    "ValidationProblem",
    "A 422 problem: some fields of the request body are invalid.",
    object(
      {
        type: problemType("validation-failed"),
        ...problemFields,
        errors: {
          type: "array",
          minItems: 1,
          description: "One entry per invalid field",
          items: object({
            pointer: {
              type: "string",
              description:
                "JSON Pointer (RFC 6901) to the field in the request body, as a URI fragment like `#/email`",
              examples: ["#/email"],
            },
            detail: { type: "string", description: "What's wrong with it" },
          }),
        },
      },
      ["type", "title", "status", "errors"],
    ),
  );
  const pageMeta = await model(
    "PageMeta",
    "Where a page of results sits in the whole list.",
    object({
      page: { type: "integer", minimum: 1, description: "The page number" },
      pageSize: {
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Items per page",
      },
      totalItems: {
        type: "integer",
        minimum: 0,
        description: "Items in the whole list",
      },
      totalPages: {
        type: "integer",
        minimum: 0,
        description: "0 when the list is empty",
      },
    }),
  );
  const user = await model(
    "User",
    "A person who can sign in.",
    object({
      id: uuid(),
      name: { type: "string", minLength: 1, maxLength: 80 },
      email: { ...email, description: "Unique, ignoring case" },
      role: {
        type: "string",
        enum: ["admin", "staff"],
        description: "Admins can also delete stock items",
      },
      emailVerified: {
        type: "boolean",
        description: "Users can sign in once their email is verified",
      },
      createdAt: dateTime,
    }),
  );
  const session = await model(
    "Session",
    "An access token. The refresh token isn't in the body: it's in the `refresh_token` cookie, which scripts can't read.",
    object({
      accessToken: {
        type: "string",
        description:
          "Send as `Authorization: Bearer <token>`. Keep it in memory only.",
      },
      tokenType: { type: "string", enum: ["Bearer"] },
      expiresIn: {
        type: "integer",
        minimum: 1,
        description: "Seconds until the access token expires",
        examples: [900],
      },
    }),
  );
  const category = await model(
    "Category",
    "A group of stock items, like Packaging.",
    object({
      id: uuid(),
      name: { type: "string", minLength: 1, maxLength: 60 },
    }),
  );
  const sku = {
    type: "string",
    pattern: "^[A-Z0-9-]{3,32}$",
    description:
      "Stock keeping unit: upper-case letters, digits, and hyphens. Unique among items that aren't deleted.",
    examples: ["BOX-S-001"],
  };
  const unit = {
    type: "string",
    enum: ["piece", "box", "roll", "pack"],
    description:
      "What quantities count. It can't change once the item has stock movements.",
  };
  const itemFields = {
    sku,
    name: { type: "string", minLength: 1, maxLength: 120 },
    description: nullableText(2000),
  };
  const reorderPoint = {
    type: "integer",
    minimum: 0,
    maximum: 1_000_000,
    description: "At or below this quantity, the item is low on stock",
  };
  const stockItem = await model(
    "StockItem",
    "Something the warehouse keeps in stock. Its quantity only changes through stock movements.",
    object({
      id: uuid(),
      ...itemFields,
      category: ref(category),
      unit,
      quantityOnHand: { type: "integer", minimum: 0 },
      reorderPoint,
      stockStatus: {
        type: "string",
        enum: ["in_stock", "low_stock", "out_of_stock"],
        description:
          "`out_of_stock` at 0; `low_stock` at or below `reorderPoint`",
      },
      createdAt: dateTime,
      updatedAt: dateTime,
    }),
  );
  const inputFields = { ...itemFields, categoryId: uuid(), unit, reorderPoint };
  const stockItemInput = await model(
    "StockItemInput",
    "A new stock item. It starts with 0 on hand: record a receipt to add stock.",
    object({ ...inputFields, reorderPoint: { ...reorderPoint, default: 0 } }, [
      "sku",
      "name",
      "categoryId",
      "unit",
    ]),
  );
  const stockItemUpdate = await model(
    "StockItemUpdate",
    "Changes to a stock item, as a JSON Merge Patch: send only the fields that change. The quantity isn't here; record a stock movement instead.",
    { ...object(inputFields, []), minProperties: 1 },
  );
  const movementType = {
    type: "string",
    enum: ["receipt", "issue", "count"],
    description:
      "`receipt` adds stock, `issue` takes it out, `count` sets it to what was counted",
  };
  const movementNotes = {
    reference: nullableText(64, "Delivery note, order, or ticket number"),
    note: nullableText(500),
  };
  const stockMovement = await model(
    "StockMovement",
    "One change to an item's quantity on hand. Movements can't be changed or deleted; record a count to correct a mistake.",
    object({
      id: uuid(),
      type: movementType,
      quantity: {
        type: "integer",
        minimum: 0,
        description:
          "As entered: the amount received or issued, or the counted quantity",
      },
      quantityChange: {
        type: "integer",
        description: "How the quantity on hand changed: positive or negative",
      },
      quantityAfter: {
        type: "integer",
        minimum: 0,
        description: "Quantity on hand after this movement",
      },
      ...movementNotes,
      createdBy: {
        ...object({ id: uuid(), name: { type: "string" } }),
        description: "Who recorded it",
      },
      createdAt: dateTime,
    }),
  );
  const stockMovementInput = await model(
    "StockMovementInput",
    "A stock movement to record.",
    object(
      {
        type: movementType,
        quantity: {
          type: "integer",
          minimum: 0,
          maximum: 1_000_000,
          description: "At least 1 for receipts and issues",
        },
        ...movementNotes,
      },
      ["type", "quantity"],
    ),
  );

  // --- Shared responses -----------------------------------------------------
  type ProblemExample = [
    name: string,
    slug: string,
    title: string,
    detail: string,
  ];
  const problemResponse = (
    status: number,
    description: string,
    examples: ProblemExample[],
    headers?: Schema,
  ) =>
    response(String(status), description, {
      headers,
      body: body(
        "application/problem+json",
        ref(problemModel),
        examples.map(([name, slug, title, detail]) => [
          name,
          problem(status, slug, title, detail),
        ]),
      ),
    });
  type FieldErrors = { pointer: string; detail: string }[];
  const invalidFields = (examples: [name: string, errors: FieldErrors][]) =>
    response("422", "Unprocessable Content", {
      body: body(
        "application/problem+json",
        ref(validationProblem),
        examples.map(([name, errors]) => [
          name,
          {
            ...problem(
              422,
              "validation-failed",
              "Validation failed",
              "Some fields are invalid.",
            ),
            errors,
          },
        ]),
      ),
    });
  const invalidEmail = invalidFields([
    [
      "invalid-email",
      [{ pointer: "#/email", detail: "Enter an email address." }],
    ],
  ]);
  const weakPassword = invalidFields([
    [
      "short-password",
      [{ pointer: "#/password", detail: "Use at least 12 characters." }],
    ],
    [
      "breached-password",
      [
        {
          pointer: "#/password",
          detail: "This password appeared in a data breach. Choose another.",
        },
      ],
    ],
  ]);
  const unauthorized = problemResponse(
    401,
    "Unauthorized",
    [
      [
        "token-expired",
        "token-expired",
        "Access token expired",
        "Refresh the access token and try again.",
      ],
      [
        "unauthenticated",
        "unauthenticated",
        "Not signed in",
        "Send an access token in the Authorization header.",
      ],
    ],
    object({
      "WWW-Authenticate": {
        type: "string",
        description:
          'The Bearer challenge (RFC 6750). It adds `error="invalid_token"` when the token sent is expired or invalid.',
        examples: [
          'Bearer realm="inventory", error="invalid_token", error_description="The access token expired"',
        ],
      },
    }),
  );
  const itemNotFound = problemResponse(404, "Not Found", [
    [
      "not-found",
      "not-found",
      "Not found",
      "There's no stock item with ID 9d0c8b7a-6f5e-4d3c-8b2a-1f0e9d8c7b6a.",
    ],
  ]);
  const invalidParameters = problemResponse(400, "Bad Request", [
    [
      "invalid-page-size",
      "invalid-parameters",
      "Invalid parameters",
      "pageSize must be between 1 and 100.",
    ],
  ]);
  const idempotencyErrors = problemResponse(400, "Bad Request", [
    [
      "missing-key",
      "idempotency-key-missing",
      "Idempotency-Key missing",
      "Send an Idempotency-Key header with each create.",
    ],
    [
      "key-reused",
      "idempotency-key-reused",
      "Idempotency-Key reused",
      "This key was already used for a different request. Make a new one.",
    ],
  ]);
  /** A 409 whose examples include a resend while the first request runs. */
  const createConflict = (example: ProblemExample) =>
    problemResponse(
      409,
      "Conflict",
      [
        example,
        [
          "in-progress",
          "request-in-progress",
          "Request in progress",
          "A request with this Idempotency-Key is still running. Resend it later.",
        ],
      ],
      object(
        retryAfter(
          2,
          "Only with `request-in-progress`: seconds before resending",
        ),
        [],
      ),
    );
  const skuTaken: ProblemExample = [
    "sku-taken",
    "sku-taken",
    "SKU already used",
    "TAPE-050 is already used by Packing tape, 50 m.",
  ];
  const invalidLink = problemResponse(400, "Bad Request", [
    [
      "invalid-link",
      "invalid-link",
      "Invalid or expired link",
      "This link is invalid or has expired. Ask for a new one.",
    ],
  ]);
  const tooManyEmails = problemResponse(
    429,
    "Too Many Requests",
    [
      [
        "too-many-requests",
        "too-many-requests",
        "Too many requests",
        "Wait a minute before asking for another email.",
      ],
    ],
    object(retryAfter(60)),
  );
  const accepted = response("202", "Accepted");
  const emailBody = (address: string) =>
    requestBody(object({ email }), [["email", { email: address }]]);
  const newPassword = {
    type: "string",
    format: "password",
    minLength: 12,
    maxLength: 128,
    description: "At least 12 characters, and not in known data breaches",
  };

  // --- Endpoints ------------------------------------------------------------
  async function endpoint(
    method: string,
    path: string,
    summary: string,
    changes: (created: { parameters: Schema }) => Schema,
  ) {
    const created = await send<{ id: string; parameters: Schema }>(
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
  const PUBLIC = { type: "none" };
  const REFRESH_TOKEN = { type: "schemes", schemeIds: ["refresh"] };

  // Auth
  const login = await endpoint("POST", "/auth/login", "Sign in", () => ({
    status: "agreed",
    security: PUBLIC,
    description:
      "Returns an access token and sets the refresh token cookie. A session lasts 12 hours, or 30 days with `remember`, from sign-in; refreshing doesn't make it longer. Wrong credentials answer 400, not 401: a 401 always means the access token is missing or expired.",
    requestBody: requestBody(
      object(
        {
          email,
          password: { type: "string", format: "password", maxLength: 128 },
          remember: {
            type: "boolean",
            description: "Keep the session for 30 days instead of 12 hours",
          },
        },
        ["email", "password"],
      ),
      [
        [
          "valid",
          {
            email: ana.email,
            password: "correct-horse-battery",
            remember: true,
          },
        ],
      ],
    ),
    responses: [
      response("200", "OK", {
        headers: object({
          ...setCookie(
            "The refresh token. With `remember`, `Max-Age` keeps it for the session's 30 days; without, it's a browser-session cookie.",
            `refresh_token=rt_5Jx2mQ9vL0aR; ${COOKIE_ATTRIBUTES}; Max-Age=2592000`,
          ),
          ...noStore,
        }),
        body: json(ref(session), [
          [
            "signed-in",
            {
              accessToken: "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIwYjVjMmQ0ZSJ9.c2ln",
              tokenType: "Bearer",
              expiresIn: 900,
            },
          ],
        ]),
      }),
      problemResponse(400, "Bad Request", [
        [
          "wrong-password",
          "invalid-credentials",
          "Invalid credentials",
          "Email or password is wrong.",
        ],
      ]),
      problemResponse(403, "Forbidden", [
        [
          "not-verified",
          "email-not-verified",
          "Email not verified",
          "Verify your email address first. We sent a link to budi@example.com.",
        ],
      ]),
      invalidEmail,
      problemResponse(
        429,
        "Too Many Requests",
        [
          [
            "too-many-attempts",
            "too-many-attempts",
            "Too many attempts",
            "Too many sign-in attempts. Try again in 15 minutes.",
          ],
        ],
        object(retryAfter(900)),
      ),
    ],
    notesFe:
      "Keep the access token in memory, not in localStorage. Send API requests with `credentials: 'include'` so the browser keeps the cookie.",
    notesBe:
      "Answer 400 for unknown emails too, and hash the password for them as well, so neither the answer nor its timing shows who has an account. Answer 403 only once the password matched. Throttle failed attempts per email and per IP address, unknown emails included, instead of locking accounts: a lock would let anyone lock a colleague out.",
  }));

  const register = await endpoint(
    "POST",
    "/auth/register",
    "Create an account",
    () => ({
      status: "agreed",
      security: PUBLIC,
      description:
        "Always answers 202, whether or not the email has an account, so it doesn't show who has one. A new account gets a link to verify the address. An existing account gets an email saying so, with links to sign in and to reset the password; an unverified one gets a new link.",
      requestBody: requestBody(
        object({
          name: { type: "string", minLength: 1, maxLength: 80 },
          email,
          password: newPassword,
        }),
        [["new-user", { ...budi, password: "correct-horse-battery" }]],
      ),
      responses: [accepted, weakPassword, tooManyEmails],
      notesBe:
        "The verification link works for 24 hours. New accounts get the staff role; admins are promoted outside this app. Check passwords against known breached passwords (NIST SP 800-63B).",
    }),
  );

  const verifyEmail = await endpoint(
    "POST",
    "/auth/verify-email",
    "Verify an email address",
    () => ({
      status: "review",
      security: PUBLIC,
      description:
        "The token comes from the link in the verification email: `/verify-email?token=…`. A link that was already used answers 204 again while its account stays verified, so opening it twice, or an email scanner opening it first, isn't an error.",
      requestBody: requestBody(
        object({ token: { type: "string", minLength: 1 } }),
        [["from-link", { token: "ev_3Hq8sK2wN6" }]],
      ),
      responses: [
        response("204", "No Content"),
        invalidLink,
        invalidFields([
          [
            "missing-token",
            [{ pointer: "#/token", detail: "Send the token from the link." }],
          ],
        ]),
      ],
      notesBe: "Store link tokens hashed.",
    }),
  );

  const resendVerification = await endpoint(
    "POST",
    "/auth/verify-email/resend",
    "Send a new verification email",
    () => ({
      status: "review",
      security: PUBLIC,
      description:
        "Always answers 202, so it doesn't show which emails have accounts. An account that's already verified gets an email saying so, with a link to sign in; an unknown email gets nothing.",
      requestBody: emailBody(budi.email),
      responses: [accepted, invalidEmail, tooManyEmails],
    }),
  );

  const forgotPassword = await endpoint(
    "POST",
    "/auth/forgot-password",
    "Email a password reset link",
    () => ({
      status: "draft",
      security: PUBLIC,
      description:
        "The link works once, for 1 hour. Always answers 202, so it doesn't show which emails have accounts.",
      requestBody: emailBody(ana.email),
      responses: [accepted, invalidEmail, tooManyEmails],
    }),
  );

  const resetPassword = await endpoint(
    "POST",
    "/auth/reset-password",
    "Set a new password",
    () => ({
      status: "draft",
      security: PUBLIC,
      description:
        "The token comes from the link in the reset email: `/reset-password?token=…`. Ends every session of the user: refresh tokens stop working at once, and access tokens already issued expire within 15 minutes.",
      requestBody: requestBody(
        object({
          token: { type: "string", minLength: 1 },
          password: newPassword,
        }),
        [
          [
            "new-password",
            { token: "pr_7Tb2vX9kM4", password: "staple-battery-horse" },
          ],
        ],
      ),
      responses: [response("204", "No Content"), invalidLink, weakPassword],
      notesBe:
        "Store reset tokens hashed. Revoke every refresh token of the user.",
    }),
  );

  const refresh = await endpoint(
    "POST",
    "/auth/refresh",
    "Get a new access token",
    () => ({
      status: "agreed",
      security: REFRESH_TOKEN,
      description:
        "Exchanges the refresh token cookie for a new access token, and replaces the cookie. The session still ends 12 hours, or 30 days, after sign-in.",
      requestBody: null,
      responses: [
        response("200", "OK", {
          headers: object({
            ...setCookie(
              "The new refresh token, with the same attributes. `Max-Age`, if set, is the time left in the session.",
              `refresh_token=rt_8Kd3nW1pZ7bT; ${COOKIE_ATTRIBUTES}; Max-Age=2505600`,
            ),
            ...noStore,
          }),
          body: json(ref(session), [
            [
              "refreshed",
              {
                accessToken:
                  "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiIwYjVjMmQ0ZSJ9.bmV3",
                tokenType: "Bearer",
                expiresIn: 900,
              },
            ],
          ]),
        }),
        problemResponse(
          401,
          "Unauthorized",
          [
            [
              "session-expired",
              "session-expired",
              "Session expired",
              "Sign in again.",
            ],
          ],
          object(clearCookie),
        ),
      ],
      notesFe:
        "Call it directly, not through the code that refreshes on 401. Run one refresh at a time, across tabs too (e.g. with the Web Locks API): requests that get a 401 meanwhile wait for it, then retry once.",
      notesBe:
        "Rotate the refresh token on every use. Accept the previous token for 30 seconds after it's replaced, since tabs can refresh at the same moment; after that, a reused token was probably stolen, so revoke every session of the user. Only accept requests whose `Origin` is the app.",
    }),
  );

  const logout = await endpoint("POST", "/auth/logout", "Sign out", () => ({
    status: "agreed",
    security: PUBLIC,
    description:
      "Revokes the refresh token in the cookie, if there is one, and clears the cookie. Always answers 204, so signing out can't fail.",
    requestBody: null,
    responses: [
      response("204", "No Content", { headers: object(clearCookie) }),
    ],
    notesFe:
      "The access token works until it expires, so drop it from memory, even if this request fails.",
    notesBe: "Only revoke when the request's `Origin` is the app.",
  }));

  const me = await endpoint("GET", "/me", "Current user", () => ({
    status: "agreed",
    responses: [
      response("200", "OK", { body: json(ref(user), [["ana", ana]]) }),
      unauthorized,
    ],
  }));

  // Inventory
  const categories = await endpoint(
    "GET",
    "/categories",
    "List categories",
    () => ({
      status: "agreed",
      description:
        "All categories, by name. There are few, so there are no pages.",
      responses: [
        response("200", "OK", {
          body: json(
            object({ data: { type: "array", items: ref(category) } }),
            [["three", { data: [cleaning, packaging, spareParts] }]],
          ),
        }),
        unauthorized,
      ],
    }),
  );

  const listItems = await endpoint(
    "GET",
    "/stock-items",
    "List stock items",
    (created) => ({
      status: "agreed",
      parameters: {
        ...created.parameters,
        query: object(
          {
            q: {
              type: "string",
              maxLength: 100,
              description: "Matches the SKU or name, ignoring case",
            },
            categoryId: uuid(
              "Only items in this category. An unknown ID gives an empty list.",
            ),
            stockStatus: {
              type: "string",
              enum: ["in_stock", "low_stock", "out_of_stock"],
              description: "Only items with this stock status",
            },
            sort: {
              type: "string",
              enum: [
                "name",
                "-name",
                "sku",
                "-sku",
                "quantityOnHand",
                "-quantityOnHand",
                "updatedAt",
                "-updatedAt",
              ],
              default: "name",
              description:
                "Sort by this field; a leading `-` sorts descending. Ties are broken by `id`, so pages don't overlap.",
            },
            ...paging,
          },
          [],
        ),
      },
      responses: [
        response("200", "OK", {
          body: json(
            object({
              data: { type: "array", items: ref(stockItem) },
              meta: ref(pageMeta),
            }),
            [
              ["first-page", SAMPLE_STOCK_ITEMS_PAGE, "Three items"],
              [
                "empty",
                {
                  data: [],
                  meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 0 },
                },
                "Nothing matches",
              ],
            ],
          ),
        }),
        invalidParameters,
        unauthorized,
      ],
    }),
  );

  const newItem = {
    sku: "LBL-100",
    name: "Shipping labels, 100 × 150 mm",
    description: null,
    categoryId: packaging.id,
    unit: "box",
    reorderPoint: 5,
  };
  const createItem = await endpoint(
    "POST",
    "/stock-items",
    "Add a stock item",
    (created) => ({
      status: "agreed",
      description:
        "The new item starts with 0 on hand. The response holds the item, and `Location` its URL.",
      parameters: { ...created.parameters, header: idempotencyKey },
      requestBody: requestBody(ref(stockItemInput), [["new-item", newItem]]),
      responses: [
        response("201", "Created", {
          headers: object({
            Location: {
              type: "string",
              format: "uri-reference",
              description: "Where the new item lives",
              examples: [
                "/v1/stock-items/7d9f1b3d-5a8c-4f2a-8c6e-9b1d3f5a7c8e",
              ],
            },
          }),
          body: json(ref(stockItem), [
            [
              "created",
              {
                id: "7d9f1b3d-5a8c-4f2a-8c6e-9b1d3f5a7c8e",
                sku: newItem.sku,
                name: newItem.name,
                description: null,
                category: packaging,
                unit: newItem.unit,
                quantityOnHand: 0,
                reorderPoint: newItem.reorderPoint,
                stockStatus: "out_of_stock",
                createdAt: "2026-10-30T09:00:00Z",
                updatedAt: "2026-10-30T09:00:00Z",
              },
            ],
          ]),
        }),
        idempotencyErrors,
        unauthorized,
        createConflict(skuTaken),
        invalidFields([
          [
            "unknown-category",
            [
              {
                pointer: "#/categoryId",
                detail: "There's no category with this ID.",
              },
            ],
          ],
        ]),
      ],
    }),
  );

  const getItem = await endpoint(
    "GET",
    "/stock-items/{itemId}",
    "Get a stock item",
    (created) => ({
      status: "agreed",
      parameters: { ...created.parameters, path: itemIdPath },
      responses: [
        response("200", "OK", { body: json(ref(stockItem), [["box", box]]) }),
        unauthorized,
        itemNotFound,
      ],
    }),
  );

  const updateItem = await endpoint(
    "PATCH",
    "/stock-items/{itemId}",
    "Update a stock item",
    (created) => ({
      status: "agreed",
      parameters: { ...created.parameters, path: itemIdPath },
      description:
        "A JSON Merge Patch (RFC 7396): fields left out don't change, and `null` clears the description.",
      requestBody: requestBody(
        ref(stockItemUpdate),
        [["reorder-point", { reorderPoint: 150 }]],
        "application/merge-patch+json",
      ),
      responses: [
        response("200", "OK", {
          body: json(ref(stockItem), [
            [
              "updated",
              { ...box, reorderPoint: 150, updatedAt: "2026-10-30T09:10:00Z" },
            ],
          ]),
        }),
        unauthorized,
        itemNotFound,
        problemResponse(409, "Conflict", [
          skuTaken,
          [
            "unit-locked",
            "unit-locked",
            "Unit can't change",
            "Shipping box, small already has stock movements, so its unit can't change.",
          ],
        ]),
        problemResponse(
          415,
          "Unsupported Media Type",
          [
            [
              "not-merge-patch",
              "unsupported-media-type",
              "Unsupported media type",
              "Send the changes as application/merge-patch+json.",
            ],
          ],
          object({
            "Accept-Patch": {
              type: "string",
              enum: ["application/merge-patch+json"],
              description: "The patch format this endpoint takes (RFC 5789)",
            },
          }),
        ),
        invalidFields([
          [
            "negative-reorder-point",
            [{ pointer: "#/reorderPoint", detail: "Use 0 or more." }],
          ],
        ]),
      ],
    }),
  );

  const deleteItem = await endpoint(
    "DELETE",
    "/stock-items/{itemId}",
    "Delete a stock item",
    (created) => ({
      status: "review",
      parameters: { ...created.parameters, path: itemIdPath },
      description:
        "For admins. Only items with nothing on hand can be deleted. Deleted items answer 404 everywhere and leave lists, and their SKU can be used again.",
      responses: [
        response("204", "No Content"),
        unauthorized,
        problemResponse(403, "Forbidden", [
          [
            "admins-only",
            "admins-only",
            "Admins only",
            "Only admins can delete stock items.",
          ],
        ]),
        itemNotFound,
        problemResponse(409, "Conflict", [
          [
            "has-stock",
            "item-has-stock",
            "Item still in stock",
            "Shipping box, small still has 340 on hand. Issue or count them to 0 first.",
          ],
        ]),
      ],
      notesBe: "Soft delete: keep the item and its movements for reports.",
    }),
  );

  const listMovements = await endpoint(
    "GET",
    "/stock-items/{itemId}/movements",
    "List an item's stock movements",
    (created) => ({
      status: "agreed",
      description: "Newest first.",
      parameters: {
        ...created.parameters,
        path: itemIdPath,
        query: object(paging, []),
      },
      responses: [
        response("200", "OK", {
          body: json(
            object({
              data: { type: "array", items: ref(stockMovement) },
              meta: ref(pageMeta),
            }),
            [
              [
                "history",
                {
                  data: [receipt, issue, count],
                  meta: { page: 1, pageSize: 20, totalItems: 3, totalPages: 1 },
                },
              ],
            ],
          ),
        }),
        invalidParameters,
        unauthorized,
        itemNotFound,
      ],
    }),
  );

  const recordMovement = await endpoint(
    "POST",
    "/stock-items/{itemId}/movements",
    "Record a stock movement",
    (created) => ({
      status: "review",
      description:
        "Changes the item's quantity on hand; `quantityAfter` is the new quantity. Fetch the item again for its new stock status.",
      parameters: {
        ...created.parameters,
        path: itemIdPath,
        header: idempotencyKey,
      },
      requestBody: requestBody(ref(stockMovementInput), [
        [
          "receipt",
          {
            type: "receipt",
            quantity: 200,
            reference: "DN-2026-1042",
            note: null,
          },
          "A delivery arrived",
        ],
        [
          "issue",
          { type: "issue", quantity: 25, reference: "SO-88213", note: null },
          "Taken out for an order",
        ],
        [
          "count",
          {
            type: "count",
            quantity: 165,
            reference: null,
            note: "Monthly stock take",
          },
          "Counted on the shelf",
        ],
      ]),
      responses: [
        response("201", "Created", {
          body: json(ref(stockMovement), [["receipt", receipt]]),
        }),
        idempotencyErrors,
        unauthorized,
        itemNotFound,
        createConflict([
          "not-enough-stock",
          "insufficient-stock",
          "Not enough stock",
          "Only 18 on hand, so 30 can't be issued.",
        ]),
        invalidFields([
          [
            "zero-receipt",
            [{ pointer: "#/quantity", detail: "Receive at least 1." }],
          ],
        ]),
      ],
      notesBe:
        "Lock the item while recording, so two issues at the same time can't take the quantity below 0.",
    }),
  );

  // --- Pages ----------------------------------------------------------------
  let linkCount = 0;
  const link = (endpointId: string, trigger: string, note = "") => ({
    id: `l${++linkCount}`,
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
  const criteria = (...items: string[]) =>
    items.map((item) => `- [ ] ${item}`).join("\n");
  const tokenFromLink =
    "The token is removed from the address bar once it's read (`history.replaceState`), and the page is served with `Referrer-Policy: no-referrer`, so the token can't leak";

  const loginPage = await page(
    "Login",
    {
      description:
        "Everyone who works with stock signs in here. Links to Registration and Forgot password.",
      acceptanceCriteria: criteria(
        "A wrong email or password shows the error above the form, and the email stays filled in",
        "An account that isn't verified yet sees a button to send a new verification email",
        "After too many attempts, the button stays disabled until the time from `Retry-After` has passed",
        "After signing in, the user lands on the page they asked for (only paths within this app), or on Stock list",
      ),
    },
    [
      link(login.id, "on_submit"),
      link(
        resendVerification.id,
        "on_action",
        "When the email isn't verified yet",
      ),
    ],
    SAMPLE_MOCKUPS.login,
  );
  const registrationPage = await page(
    "Registration",
    {
      description: "New staff create an account with their work email.",
      acceptanceCriteria: criteria(
        "Each error in a 422 shows under the field its `pointer` names",
        "After sending, the page asks the user to check their email and shows the address, whether or not it already had an account",
        "A 429 shows when the user can try again",
      ),
    },
    [link(register.id, "on_submit")],
    SAMPLE_MOCKUPS.registration,
  );
  const verifyEmailPage = await page(
    "Verify email",
    {
      description:
        "Opens from the link in the verification email: `/verify-email?token=…`.",
      acceptanceCriteria: criteria(
        "The token is sent as soon as the page opens",
        tokenFromLink,
        "On success, the page says the email is verified and offers to sign in",
        "An invalid or expired link shows a form to send a new one",
      ),
    },
    [
      link(verifyEmail.id, "on_load", "Token from the `token` query parameter"),
      link(
        resendVerification.id,
        "on_submit",
        "When the link is invalid or expired",
      ),
    ],
    SAMPLE_MOCKUPS.verifyEmail,
  );
  const forgotPasswordPage = await page(
    "Forgot password",
    {
      description: "Sends a link to set a new password.",
      acceptanceCriteria: criteria(
        'After sending, the page always says "If an account exists for this email, we sent a link", even for unknown emails',
        "A 429 shows when the user can ask again",
      ),
    },
    [link(forgotPassword.id, "on_submit")],
    SAMPLE_MOCKUPS.forgotPassword,
  );
  const resetPasswordPage = await page(
    "Reset password",
    {
      description:
        "Opens from the link in the reset email: `/reset-password?token=…`.",
      acceptanceCriteria: criteria(
        tokenFromLink,
        "The form checks for at least 12 characters before sending",
        "On success, the user goes to Login, which says the password was changed and other devices were signed out",
        "An invalid or expired link shows a link to Forgot password",
      ),
    },
    [
      link(
        resetPassword.id,
        "on_submit",
        "Token from the `token` query parameter",
      ),
    ],
    SAMPLE_MOCKUPS.resetPassword,
  );
  const appShellPage = await page(
    "App shell",
    {
      description:
        "The layout around every signed-in page: navigation, the user menu, and keeping the session alive. It isn't a screen of its own, but its calls happen on every page.",
      acceptanceCriteria: criteria(
        "Opening a signed-in page without a session goes to Login, and back after signing in",
        "A 401 from any other endpoint refreshes once and repeats the call; if refreshing answers 401, the app goes to Login",
        "The user menu shows the user's name and role, and Sign out",
        "Sign out goes to Login, even if the request fails",
      ),
    },
    [
      link(
        refresh.id,
        "on_load",
        "When there's no access token in memory yet, e.g. after a reload",
      ),
      link(me.id, "on_load", "Name and role for the user menu"),
      link(
        refresh.id,
        "other",
        "A minute before the access token expires, or once after a 401",
      ),
      link(logout.id, "on_action", "Sign out, in the user menu"),
    ],
    SAMPLE_MOCKUPS.appShell,
  );
  const stockListPage = await page(
    "Stock list",
    {
      description:
        "All stock items, with search, filters, and pages. Items low on stock or out of stock stand out.",
      acceptanceCriteria: criteria(
        "Search, filters, sort, and page are kept in the URL, so a filtered list can be shared",
        "Low stock shows an amber badge, out of stock a red one",
        "Only admins see Delete, and it asks for confirmation first",
        "A 409 when deleting shows the `detail` from the API",
      ),
    },
    [
      link(
        listItems.id,
        "on_load",
        "Again when search, filters, sort, or page change, and after a delete",
      ),
      link(categories.id, "on_load", "Category filter"),
      link(deleteItem.id, "on_action", "Delete in a row's menu, for admins"),
    ],
    SAMPLE_MOCKUPS.stockList,
  );
  const stockItemPage = await page(
    "Stock item",
    {
      description:
        "One item, with its movement history. The warehouse records deliveries, issues, and stock counts here.",
      acceptanceCriteria: criteria(
        "The quantity on hand and stock status update right after a movement is recorded",
        "Issuing more than is on hand shows the API's `detail` in the dialog",
        "The history shows the newest movement first, 20 per page",
        "Saving twice (e.g. a double click) records the movement once: both requests send the same `Idempotency-Key`",
      ),
    },
    [
      link(
        getItem.id,
        "on_load",
        "Again after a movement is recorded, for the new quantity and stock status",
      ),
      link(listMovements.id, "on_load", "Again after a movement is recorded"),
      link(
        recordMovement.id,
        "on_submit",
        "Record movement dialog. One `Idempotency-Key` per dialog, until it saves",
      ),
    ],
    SAMPLE_MOCKUPS.stockItem,
  );
  const stockItemFormPage = await page(
    "Add or edit stock item",
    {
      description:
        "One form for both: `/stock-items/new` adds an item and `/stock-items/{id}/edit` changes one. The quantity isn't on the form: new items start at 0, and movements change it.",
      acceptanceCriteria: criteria(
        "Each error in a 422 shows under the field its `pointer` names",
        "A 409 shows its `detail` under the field it's about: SKU or unit",
        "After saving, the user goes to the item's page",
      ),
    },
    [
      link(categories.id, "on_load", "Category select"),
      link(getItem.id, "on_load", "When editing"),
      link(
        createItem.id,
        "on_submit",
        "When adding. One `Idempotency-Key` per form, until it saves",
      ),
      link(updateItem.id, "on_submit", "When editing. Only the changed fields"),
    ],
    SAMPLE_MOCKUPS.stockItemForm,
  );

  return {
    projectId: project.id,
    pageIds: {
      login: loginPage.id,
      registration: registrationPage.id,
      verifyEmail: verifyEmailPage.id,
      forgotPassword: forgotPasswordPage.id,
      resetPassword: resetPasswordPage.id,
      appShell: appShellPage.id,
      stockList: stockListPage.id,
      stockItem: stockItemPage.id,
      stockItemForm: stockItemFormPage.id,
    },
  };
}
