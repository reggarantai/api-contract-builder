import { z } from "zod";
import { isJsonObject, type JsonSchema, type JsonValue } from "./json-schema";
import { jsonSchemaSchema } from "./models";

export const HTTP_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** Methods whose request body OpenAPI leaves undefined. */
const METHODS_WITHOUT_BODY: readonly HttpMethod[] = ["GET", "HEAD"];

export function methodAllowsBody(method: HttpMethod) {
  return !METHODS_WITHOUT_BODY.includes(method);
}

export const ENDPOINT_STATUSES = ["draft", "review", "agreed"] as const;
export type EndpointStatus = (typeof ENDPOINT_STATUSES)[number];

export const PARAMETER_LOCATIONS = ["path", "query", "header"] as const;
export type ParameterLocation = (typeof PARAMETER_LOCATIONS)[number];

// Header parameters OpenAPI ignores: they come from the body and security.
const RESERVED_HEADERS = ["accept", "content-type", "authorization"];

export const DEFAULT_CONTENT_TYPE = "application/json";

export const RESPONSE_DESCRIPTIONS: Record<string, string> = {
  "200": "OK",
  "201": "Created",
  "202": "Accepted",
  "204": "No Content",
  "400": "Bad Request",
  "401": "Unauthorized",
  "403": "Forbidden",
  "404": "Not Found",
  "409": "Conflict",
  "422": "Unprocessable Content",
  "500": "Internal Server Error",
  default: "Unexpected error",
};

// --- Paths ------------------------------------------------------------------

/** The parameter names in a path template like `/stocks/{id}`, or why it's invalid. */
export function parsePathTemplate(
  path: string,
): { params: string[] } | { error: string } {
  if (!path.startsWith("/")) {
    return { error: "Path must start with /" };
  }
  if (/[?#\s]/.test(path)) {
    return { error: "Leave out query strings, fragments, and spaces" };
  }
  if (path.includes("//")) {
    return { error: "Remove empty segments (//)" };
  }
  const withoutParams = path.replace(/\{[^{}]*\}/g, "");
  if (withoutParams.includes("{") || withoutParams.includes("}")) {
    return { error: "Braces must come in pairs, like {id}" };
  }

  const params: string[] = [];
  for (const [, name = ""] of path.matchAll(/\{([^{}]*)\}/g)) {
    if (name === "") {
      return { error: "Name the parameter inside {}" };
    }
    if (!/^[A-Za-z0-9_.-]+$/.test(name)) {
      return {
        error: `Use letters, numbers, dots, hyphens, and underscores in {${name}}`,
      };
    }
    if (params.includes(name)) {
      return { error: `{${name}} appears more than once` };
    }
    params.push(name);
  }
  return { params };
}

/**
 * Paths that differ only in parameter names are the same path to OpenAPI
 * (`/users/{id}` and `/users/{userId}`), so they share a key.
 */
export function pathMatchKey(path: string) {
  return path.replace(/\{[^{}]*\}/g, "{}");
}

function pascalCase(value: string) {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join("");
}

/** A default operationId: "GET /stocks/{id}" → "getStocksById". */
export function suggestOperationId(method: string, path: string) {
  const segments = path.split("/").filter(Boolean);
  const name =
    segments.length === 0
      ? "Root"
      : segments
          .map((segment) => {
            const param = /^\{(.+)\}$/.exec(segment)?.[1];
            return param ? `By${pascalCase(param)}` : pascalCase(segment);
          })
          .join("");
  return `${method.toLowerCase()}${name}`;
}

function objectProperties(schema: JsonSchema): JsonSchema {
  return isJsonObject(schema.properties) ? schema.properties : {};
}

/**
 * Makes the path parameters schema match the path: one required property per
 * `{param}`, in path order. A parameter renamed in place keeps its schema.
 */
export function syncPathParameters(
  current: JsonSchema,
  path: string,
): JsonSchema {
  const parsed = parsePathTemplate(path);
  if ("error" in parsed) {
    return current;
  }
  const existing = objectProperties(current);
  const existingNames = Object.keys(existing);
  const properties = Object.fromEntries(
    parsed.params.map((name, index) => {
      const renamedFrom = existingNames[index];
      const schema = existing[name] ??
        (renamedFrom !== undefined && !parsed.params.includes(renamedFrom)
          ? existing[renamedFrom]
          : undefined) ?? { type: "string" };
      return [name, schema];
    }),
  );
  const synced: JsonSchema = { ...current, type: "object", properties };
  if (parsed.params.length > 0) {
    synced.required = parsed.params;
  } else {
    delete synced.required;
  }
  return synced;
}

// --- Schemas ----------------------------------------------------------------

const itemIdSchema = z.string().min(1).max(64);

const objectSchemaSchema = jsonSchemaSchema.refine(
  (schema) => schema.type === "object",
  "Must be an object schema",
);

export const pathSchema = z
  .string()
  .trim()
  .max(500)
  .superRefine((path, ctx) => {
    const parsed = parsePathTemplate(path);
    if ("error" in parsed) {
      ctx.addIssue({ code: "custom", message: parsed.error });
    }
  });

export const exampleSchema = z.object({
  id: itemIdSchema,
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(64)
    .regex(
      /^[A-Za-z0-9._-]+$/,
      "Use letters, numbers, dots, hyphens, and underscores",
    ),
  summary: z.string().trim().max(200),
  // Request bodies are always JSON, so any defined value is a JSON value.
  value: z.custom<JsonValue>(
    (value) => value !== undefined,
    "Value is required",
  ),
});

export const bodySchema = z.object({
  contentType: z.string().trim().min(1, "Content type is required").max(100),
  schema: jsonSchemaSchema,
  examples: z.array(exampleSchema).max(20),
});

export const requestBodySchema = bodySchema.extend({
  required: z.boolean(),
  description: z.string().trim().max(2000),
});

export const responseSchema = z.object({
  id: itemIdSchema,
  status: z
    .string()
    .trim()
    .regex(
      /^(?:[1-5][0-9]{2}|[1-5]XX|default)$/,
      "Use a status code like 200 or 4XX, or default",
    ),
  description: z.string().trim().min(1, "Description is required").max(500),
  /** Null for responses without a body, like 204. */
  body: bodySchema.nullable(),
});

export const endpointSecuritySchema = z.discriminatedUnion("type", [
  /** The project's default scheme. */
  z.object({ type: z.literal("default") }),
  /** Public. */
  z.object({ type: z.literal("none") }),
  /** Any one of these schemes. */
  z.object({
    type: z.literal("schemes"),
    schemeIds: z.array(z.string()).min(1, "Pick a scheme"),
  }),
]);

export const endpointFieldsSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: pathSchema,
  /** Empty means "derive it on export" (see `suggestOperationId`). */
  operationId: z
    .string()
    .trim()
    .max(100)
    .regex(
      /^(?:[A-Za-z_][A-Za-z0-9_]*)?$/,
      "Start with a letter; use letters, numbers, and underscores",
    ),
  summary: z.string().trim().max(200),
  description: z.string().trim().max(10_000),
  status: z.enum(ENDPOINT_STATUSES),
  deprecated: z.boolean(),
  security: endpointSecuritySchema,
  /** One object schema per location; each property is a parameter. */
  parameters: z.object({
    path: objectSchemaSchema,
    query: objectSchemaSchema,
    header: objectSchemaSchema,
  }),
  requestBody: requestBodySchema.nullable(),
  responses: z
    .array(responseSchema)
    .min(1, "Add at least one response")
    .max(30),
  notesFe: z.string().trim().max(10_000),
  notesBe: z.string().trim().max(10_000),
});

export type EndpointFields = z.infer<typeof endpointFieldsSchema>;
export type EndpointBody = z.infer<typeof bodySchema>;
export type EndpointResponse = z.infer<typeof responseSchema>;
export type EndpointExample = z.infer<typeof exampleSchema>;
export type EndpointSecurity = z.infer<typeof endpointSecuritySchema>;

function addDuplicateIssues(
  ctx: z.RefinementCtx,
  values: string[],
  path: (index: number) => (string | number)[],
  message: (value: string) => string,
) {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    if (seen.has(value)) {
      ctx.addIssue({
        code: "custom",
        path: path(index),
        message: message(value),
      });
    }
    seen.add(value);
  });
}

function refineEndpoint(endpoint: EndpointFields, ctx: z.RefinementCtx) {
  const parsed = parsePathTemplate(endpoint.path);
  if ("params" in parsed) {
    const pathParams = endpoint.parameters.path;
    const names = Object.keys(objectProperties(pathParams));
    const required = Array.isArray(pathParams.required)
      ? pathParams.required
      : [];
    const matches =
      names.length === parsed.params.length &&
      parsed.params.every((name, index) => names[index] === name);
    if (!matches) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "path"],
        message: `Path parameters must match the path: ${parsed.params.map((name) => `{${name}}`).join(", ") || "none"}`,
      });
    } else if (!names.every((name) => required.includes(name))) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "path"],
        message: "Path parameters are always required",
      });
    }
  }

  const headerNames = Object.keys(objectProperties(endpoint.parameters.header));
  for (const name of headerNames) {
    if (RESERVED_HEADERS.includes(name.toLowerCase())) {
      ctx.addIssue({
        code: "custom",
        path: ["parameters", "header"],
        message: `${name} is set by the request body or authentication, not as a parameter`,
      });
    }
  }
  addDuplicateIssues(
    ctx,
    headerNames.map((name) => name.toLowerCase()),
    () => ["parameters", "header"],
    (name) => `Header names ignore case: ${name} appears twice`,
  );

  if (endpoint.requestBody && !methodAllowsBody(endpoint.method)) {
    ctx.addIssue({
      code: "custom",
      path: ["requestBody"],
      message: `${endpoint.method} requests can't have a body`,
    });
  }

  addDuplicateIssues(
    ctx,
    endpoint.responses.map((response) => response.status),
    (index) => ["responses", index, "status"],
    (status) => `${status} is already used`,
  );

  const bodies: [(string | number)[], EndpointBody | null][] = [
    [["requestBody"], endpoint.requestBody],
    ...endpoint.responses.map(
      (response, index): [(string | number)[], EndpointBody | null] => [
        ["responses", index, "body"],
        response.body,
      ],
    ),
  ];
  for (const [path, body] of bodies) {
    if (body) {
      addDuplicateIssues(
        ctx,
        body.examples.map((example) => example.name),
        (index) => [...path, "examples", index, "name"],
        () => "Example names must be unique",
      );
    }
  }
}

/** Endpoint fields with rules that span several fields. */
export const endpointSchema = endpointFieldsSchema.superRefine(refineEndpoint);

export const createEndpointInputSchema = z.object({
  method: z.enum(HTTP_METHODS),
  path: pathSchema,
  summary: z.string().trim().max(200).default(""),
});

export const updateEndpointInputSchema = endpointFieldsSchema.partial();

export const endpointResponseFieldsSchema = endpointFieldsSchema.extend({
  id: z.string(),
  projectId: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const endpointSummarySchema = endpointResponseFieldsSchema
  .pick({
    id: true,
    projectId: true,
    method: true,
    path: true,
    summary: true,
    status: true,
    deprecated: true,
    createdAt: true,
    updatedAt: true,
  })
  .extend({
    /** Pages that call the endpoint. */
    pageIds: z.array(z.string()),
  });

export type Endpoint = z.infer<typeof endpointResponseFieldsSchema>;
export type EndpointSummary = z.infer<typeof endpointSummarySchema>;
export type CreateEndpointInput = z.input<typeof createEndpointInputSchema>;
export type UpdateEndpointInput = z.input<typeof updateEndpointInputSchema>;

/** Every schema in an endpoint, with the field path it sits at. */
export function schemasOfEndpoint(
  endpoint: Pick<EndpointFields, "parameters" | "requestBody" | "responses">,
): [string, JsonSchema][] {
  const schemas: [string, JsonSchema][] = PARAMETER_LOCATIONS.map(
    (location) => [`parameters.${location}`, endpoint.parameters[location]],
  );
  if (endpoint.requestBody) {
    schemas.push(["requestBody.schema", endpoint.requestBody.schema]);
  }
  endpoint.responses.forEach((response, index) => {
    if (response.body) {
      schemas.push([`responses.${index}.body.schema`, response.body.schema]);
    }
  });
  return schemas;
}

/** "GET /stocks/{id}" */
export function endpointLabel(
  endpoint: Pick<EndpointFields, "method" | "path">,
) {
  return `${endpoint.method} ${endpoint.path}`;
}

// --- Defaults ---------------------------------------------------------------

const EMPTY_OBJECT_SCHEMA: JsonSchema = { type: "object", properties: {} };

export function newBody(): EndpointBody {
  return {
    contentType: DEFAULT_CONTENT_TYPE,
    schema: EMPTY_OBJECT_SCHEMA,
    examples: [],
  };
}

export function newResponse(id: string, status: string): EndpointResponse {
  return {
    id,
    status,
    description: RESPONSE_DESCRIPTIONS[status] ?? "",
    body: status === "204" ? null : newBody(),
  };
}

/** A new endpoint: path parameters from the path, a success response, and a body for writes. */
export function createEndpointDefaults(
  method: HttpMethod,
  path: string,
  summary = "",
  newId: () => string = () => crypto.randomUUID(),
): EndpointFields {
  const hasBody = method === "POST" || method === "PUT" || method === "PATCH";
  return {
    method,
    path,
    operationId: "",
    summary,
    description: "",
    status: "draft",
    deprecated: false,
    security: { type: "default" },
    parameters: {
      path: syncPathParameters(EMPTY_OBJECT_SCHEMA, path),
      query: EMPTY_OBJECT_SCHEMA,
      header: EMPTY_OBJECT_SCHEMA,
    },
    requestBody: hasBody
      ? { ...newBody(), required: true, description: "" }
      : null,
    responses: [newResponse(newId(), method === "POST" ? "201" : "200")],
    notesFe: "",
    notesBe: "",
  };
}
