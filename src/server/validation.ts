import type { Context } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import type { ApiErrorBody, ApiIssue } from "../shared/api-error";

export function toApiIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validationFailed(c: Context, issues: ApiIssue[]) {
  return c.json<ApiErrorBody>({ error: "Validation failed", issues }, 400);
}

/** Validates the JSON body with a Zod schema; responds 400 with issues on failure. */
export function jsonBody<T extends z.ZodType>(schema: T) {
  return validator("json", (value, c) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      return validationFailed(c, toApiIssues(result.error));
    }
    return result.data as z.output<T>;
  });
}
