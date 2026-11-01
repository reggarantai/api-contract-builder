import {
  type ErrorType,
  type ErrorTypeBody,
  isProblemDetails,
} from "@shared/error-types";
import { isJsonObject, type JsonSchema, modelRef } from "@shared/json-schema";

/** RFC 9457 problem details, for projects without a Problem model yet. */
export const PROBLEM_SCHEMA: JsonSchema = {
  type: "object",
  properties: {
    type: {
      type: "string",
      format: "uri",
      description: "Identifies the kind of problem",
    },
    title: { type: "string", description: "Short summary of the kind" },
    status: { type: "integer", description: "The HTTP status code" },
    detail: { type: "string", description: "What went wrong this time" },
    instance: {
      type: "string",
      format: "uri-reference",
      description: "Identifies this occurrence",
    },
  },
  required: ["type", "title", "status"],
};

const TYPE_PREFIX = "https://example.com/problems/";

/** The part of a type URI before the error type's name, like `…/problems/`. */
function typePrefixOf(errorType: ErrorType) {
  const type = isJsonObject(errorType.body.example)
    ? errorType.body.example.type
    : undefined;
  return typeof type === "string" && type.endsWith(errorType.name)
    ? type.slice(0, -errorType.name.length)
    : undefined;
}

/**
 * A starting body for a new error type: like the most recently changed one
 * (content type, schema, type URIs), or problem details (RFC 9457) with the
 * project's Problem model. Only problem details get an example to start.
 */
export function suggestErrorTypeBody(
  fields: { name: string; status: string; title: string },
  existing: ErrorType[],
  models: { id: string; name: string }[],
): ErrorTypeBody {
  const byRecent = [...existing].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const [latest] = byRecent;
  const problemModel = models.find(
    (model) => model.name.toLowerCase() === "problem",
  );
  const contentType = latest?.body.contentType ?? "application/problem+json";
  const schema =
    latest?.body.schema ??
    (problemModel ? { $ref: modelRef(problemModel.id) } : PROBLEM_SCHEMA);
  if (!isProblemDetails(contentType)) {
    return { contentType, schema, example: {} };
  }
  const prefix =
    byRecent.map(typePrefixOf).find((value) => value !== undefined) ??
    TYPE_PREFIX;
  return {
    contentType,
    schema,
    example: {
      type: `${prefix}${fields.name}`,
      title: fields.title,
      status: Number(fields.status),
    },
  };
}
