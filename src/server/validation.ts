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

/**
 * A 409 for a save based on an older revision than the stored one, so it
 * doesn't overwrite a save made since (RFC 9110 gives this as its example of
 * a conflict). Undefined when the save is current, or names no revision, like
 * saves from clients that predate revisions.
 */
export function staleRevision(
  c: Context,
  what: string,
  sent: number | undefined,
  current: number,
) {
  if (sent === undefined || sent === current) {
    return undefined;
  }
  return c.json<ApiErrorBody>(
    {
      error: `This ${what} was saved again since revision ${sent}. It's at revision ${current} now: load it, or send that revision to save over it.`,
      revision: current,
    },
    409,
  );
}
