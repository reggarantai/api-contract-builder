import { z } from "zod";
import type { ApiIssue } from "./api-error";
import {
  addResponseHeaderIssues,
  type EndpointFields,
  objectSchemaSchema,
} from "./endpoints";
import type { JsonSchema, JsonValue } from "./json-schema";
import { jsonSchemaSchema } from "./models";
import { revisionInputSchema, revisionSchema } from "./revision";

// The error catalog: each error type is defined once, like an RFC 9457
// problem type (status, title, when it happens), and endpoint responses use
// it. Errors without a body stay responses of their own: nothing would tell
// them apart.

export const errorTypeNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(64)
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "Use letters, numbers, dots, hyphens, and underscores",
  );

export const errorTypeBodySchema = z.object({
  contentType: z.string().trim().min(1, "Content type is required").max(100),
  schema: jsonSchemaSchema,
  /** The error as the API sends it; responses use it unless they have their own. */
  example: z.custom<JsonValue>(
    (value) => value !== undefined,
    "Example is required",
  ),
});

const EMPTY_HEADERS: JsonSchema = { type: "object", properties: {} };

/** An object schema; each property is a header sent with the error. */
const errorTypeHeadersSchema = objectSchemaSchema.superRefine((schema, ctx) =>
  addResponseHeaderIssues(ctx, schema, []),
);

export const errorTypeFieldsSchema = z.object({
  /** Also the example's name in exports, and its anchor in Markdown. */
  name: errorTypeNameSchema,
  status: z
    .string()
    .trim()
    .regex(/^[45][0-9]{2}$/, "Use a 4xx or 5xx status code, like 404"),
  title: z.string().trim().min(1, "Title is required").max(200),
  /** When it happens and what the client should do, in Markdown. */
  description: z.string().trim().max(2000),
  headers: errorTypeHeadersSchema,
  body: errorTypeBodySchema,
});

export const createErrorTypeInputSchema = errorTypeFieldsSchema.extend({
  description: errorTypeFieldsSchema.shape.description.default(""),
  headers: errorTypeHeadersSchema.default(EMPTY_HEADERS),
});

export const updateErrorTypeInputSchema = errorTypeFieldsSchema
  .partial()
  .extend({ revision: revisionInputSchema });

export const errorTypeSchema = errorTypeFieldsSchema.extend({
  id: z.string(),
  projectId: z.string(),
  /** Endpoints with a response that uses the error, in endpoint order. */
  endpointIds: z.array(z.string()),
  revision: revisionSchema,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type ErrorTypeFields = z.infer<typeof errorTypeFieldsSchema>;
export type ErrorTypeBody = z.infer<typeof errorTypeBodySchema>;
export type ErrorType = z.infer<typeof errorTypeSchema>;
export type CreateErrorTypeInput = z.input<typeof createErrorTypeInputSchema>;
export type UpdateErrorTypeInput = z.input<typeof updateErrorTypeInputSchema>;

/** Whether a body is RFC 9457 problem details, whose members have set meanings. */
export function isProblemDetails(contentType: string) {
  return (
    contentType.split(";")[0]?.trim().toLowerCase() ===
    "application/problem+json"
  );
}

/** Every schema of an error type, with the field path it sits at. */
export function schemasOfErrorType(
  errorType: Pick<ErrorTypeFields, "headers" | "body">,
): [string, JsonSchema][] {
  return [
    ["headers", errorType.headers],
    ["body.schema", errorType.body.schema],
  ];
}

/** Whether a response with `responseStatus` (like 404, 4XX, default) can answer an error. */
export function statusMatches(errorStatus: string, responseStatus: string) {
  if (responseStatus === "default") {
    return true;
  }
  if (/^[1-5]XX$/.test(responseStatus)) {
    return errorStatus[0] === responseStatus[0];
  }
  return errorStatus === responseStatus;
}

type CatalogEntry = Pick<ErrorTypeFields, "name" | "status"> & {
  id: string;
};

/**
 * The response of an endpoint that answers `status`: OpenAPI picks an exact
 * code over its range (4XX), and a range over `default`.
 */
export function responseForStatus<T extends { status: string }>(
  responses: T[],
  status: string,
): T | undefined {
  return (
    responses.find((response) => response.status === status) ??
    responses.find((response) => response.status === `${status[0]}XX`) ??
    responses.find((response) => response.status === "default")
  );
}

/**
 * Issues with the catalog errors of an endpoint's responses: error types the
 * project lacks, statuses that don't match, errors in a response that never
 * answers their status, and example names a response would use twice (an
 * endpoint's own examples replace the catalog's).
 */
export function checkResponseErrors(
  endpoint: Pick<EndpointFields, "responses">,
  catalog: CatalogEntry[] | ReadonlyMap<string, CatalogEntry>,
): ApiIssue[] {
  // A caller checking many endpoints passes the catalog by ID, made once.
  const byId = Array.isArray(catalog)
    ? new Map(catalog.map((errorType) => [errorType.id, errorType]))
    : catalog;
  const issues: ApiIssue[] = [];

  endpoint.responses.forEach((response, responseIndex) => {
    const names = new Set<string>();
    const claimName = (name: string, path: string) => {
      if (names.has(name)) {
        issues.push({
          path,
          message: `Example names must be unique: ${name} is already used`,
        });
      }
      names.add(name);
    };

    response.errors.forEach((usage, usageIndex) => {
      const path = `responses.${responseIndex}.errors.${usageIndex}`;
      const errorType = byId.get(usage.errorTypeId);
      if (!errorType) {
        issues.push({
          path: `${path}.errorTypeId`,
          message: "This error type isn't in the project",
        });
        return;
      }
      const answering = responseForStatus(endpoint.responses, errorType.status);
      if (!statusMatches(errorType.status, response.status)) {
        issues.push({
          path: `${path}.errorTypeId`,
          message: `${errorType.name} is a ${errorType.status} error, so a ${response.status} response can't use it`,
        });
      } else if (answering && answering !== response) {
        issues.push({
          path: `${path}.errorTypeId`,
          message: `${errorType.name} belongs in the ${answering.status} response, which answers ${errorType.status} instead of ${response.status}`,
        });
      }
      if (usage.examples.length === 0) {
        claimName(errorType.name, `${path}.errorTypeId`);
      }
      usage.examples.forEach((example, exampleIndex) => {
        claimName(example.name, `${path}.examples.${exampleIndex}.name`);
      });
    });
  });
  return issues;
}
