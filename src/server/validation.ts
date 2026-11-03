import type { Context } from "hono";
import { validator } from "hono/validator";
import type { z } from "zod";
import type { ApiErrorBody, ApiIssue } from "../shared/api-error";
import { isNestingIssue } from "../shared/json-schema";

export function toApiIssues(error: z.ZodError): ApiIssue[] {
  return error.issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));
}

export function validationFailed(c: Context, issues: ApiIssue[]) {
  return c.json<ApiErrorBody>({ error: "Validation failed", issues }, 400);
}

/**
 * The issues of a save, less those of schemas and examples nested too deeply
 * that the save leaves as they were: data saved before the limit keeps
 * saving, and only what changes must fit in it.
 */
export function withoutStoredNesting(
  issues: ApiIssue[],
  fields: unknown,
  stored: unknown,
): ApiIssue[] {
  return issues.filter(
    (issue) =>
      !isNestingIssue(issue) || !sameJsonAt(fields, stored, issue.path),
  );
}

function valueAt(root: unknown, path: string): unknown {
  let value = root;
  for (const key of path.split(".")) {
    if (
      typeof value !== "object" ||
      value === null ||
      !Object.hasOwn(value, key)
    ) {
      return undefined;
    }
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function sameJsonAt(a: unknown, b: unknown, path: string) {
  const left = valueAt(a, path);
  const right = valueAt(b, path);
  return left !== undefined && right !== undefined && sameJson(left, right);
}

/** Whether two JSON values are equal, compared without recursion. */
function sameJson(a: unknown, b: unknown) {
  const pending: [unknown, unknown][] = [[a, b]];
  for (let next = pending.pop(); next; next = pending.pop()) {
    const [left, right] = next;
    if (left === right) {
      continue;
    }
    if (
      typeof left !== "object" ||
      typeof right !== "object" ||
      left === null ||
      right === null ||
      Array.isArray(left) !== Array.isArray(right)
    ) {
      return false;
    }
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) {
      return false;
    }
    for (const key of keys) {
      if (!Object.hasOwn(right, key)) {
        return false;
      }
      pending.push([
        (left as Record<string, unknown>)[key],
        (right as Record<string, unknown>)[key],
      ]);
    }
  }
  return true;
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
