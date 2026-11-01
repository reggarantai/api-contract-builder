import { and, asc, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { ulid } from "ulid";
import type { ApiErrorBody, ApiIssue } from "../../shared/api-error";
import { endpointLabel } from "../../shared/endpoints";
import {
  checkResponseErrors,
  createErrorTypeInputSchema,
  type ErrorType,
  type ErrorTypeFields,
  errorTypeFieldsSchema,
  schemasOfErrorType,
  updateErrorTypeInputSchema,
} from "../../shared/error-types";
import type { Db } from "../db/client";
import { findProject, touchProject } from "../db/projects";
import {
  checkModelRefs,
  endpointIdsByErrorType,
  endpointsUsingErrorType,
} from "../db/references";
import { type ErrorTypeRow, errorTypes } from "../db/schema";
import {
  jsonBody,
  staleRevision,
  toApiIssues,
  validationFailed,
} from "../validation";

function fieldsOf(row: ErrorTypeRow): ErrorTypeFields {
  return {
    name: row.name,
    status: row.status,
    title: row.title,
    description: row.description,
    headers: row.headers,
    body: row.body,
  };
}

export function toErrorType(
  row: ErrorTypeRow,
  endpointIds: string[],
): ErrorType {
  return {
    ...fieldsOf(row),
    id: row.id,
    projectId: row.projectId,
    endpointIds,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A project's catalog in list order: by status, then name. */
export function errorTypesOf(db: Db, projectId: string) {
  return db
    .select()
    .from(errorTypes)
    .where(eq(errorTypes.projectId, projectId))
    .orderBy(asc(errorTypes.status), sql`${errorTypes.name} collate nocase`)
    .all();
}

function projectNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Project not found" }, 404);
}

function errorTypeNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Error type not found" }, 404);
}

function nameTaken(c: Context) {
  return c.json<ApiErrorBody>(
    {
      error: "An error type with this name already exists",
      issues: [{ path: "name", message: "Already used by another error type" }],
    },
    409,
  );
}

// Names are compared ignoring case, like model names: they become example
// names and Markdown anchors.
function isNameTaken(
  db: Db,
  projectId: string,
  name: string,
  exceptId?: string,
) {
  const row = db
    .select({ id: errorTypes.id })
    .from(errorTypes)
    .where(
      and(
        eq(errorTypes.projectId, projectId),
        sql`lower(${errorTypes.name}) = lower(${name})`,
      ),
    )
    .get();
  return row !== undefined && row.id !== exceptId;
}

function findErrorType(db: Db, projectId: string, errorTypeId: string) {
  return db
    .select()
    .from(errorTypes)
    .where(
      and(eq(errorTypes.id, errorTypeId), eq(errorTypes.projectId, projectId)),
    )
    .get();
}

/** Issues for models the error type's schemas reference but the project lacks. */
function checkSchemas(
  db: Db,
  projectId: string,
  fields: Pick<ErrorTypeFields, "headers" | "body">,
): ApiIssue[] {
  return schemasOfErrorType(fields).flatMap(([path, schema]) =>
    checkModelRefs(db, projectId, schema, path),
  );
}

/**
 * The issue a change would cause in the responses that use the error type (a
 * status they don't answer, an example name used twice), on the field that
 * causes it; undefined when they stay valid.
 */
function breakingChange(
  db: Db,
  existing: ErrorTypeRow,
  changed: ErrorTypeFields,
): ApiIssue | undefined {
  const users = endpointsUsingErrorType(db, existing.projectId, existing.id);
  if (users.length === 0) {
    return undefined;
  }
  const catalog = errorTypesOf(db, existing.projectId).map((row) => ({
    ...fieldsOf(row),
    id: row.id,
  }));
  const issuesWith = (fields: ErrorTypeFields) => {
    const changedCatalog = catalog.map((entry) =>
      entry.id === existing.id ? { ...fields, id: existing.id } : entry,
    );
    return users.flatMap((endpoint) => {
      const before = new Set(
        checkResponseErrors(endpoint, catalog).map((issue) => issue.path),
      );
      return checkResponseErrors(endpoint, changedCatalog)
        .filter((issue) => !before.has(issue.path))
        .map((issue) => ({ endpoint, message: issue.message }));
    });
  };

  const toIssue = (
    path: string,
    broken: ReturnType<typeof issuesWith>,
  ): ApiIssue | undefined => {
    const [first] = broken;
    if (!first) {
      return undefined;
    }
    const labels = [
      ...new Set(broken.map(({ endpoint }) => endpointLabel(endpoint))),
    ];
    return {
      path,
      message: `${labels.join(", ")} would stop being valid: ${first.message}`,
    };
  };

  // Only these fields matter to responses. Each is tried alone, so the issue
  // lands on the field that causes it, then both together.
  const current = fieldsOf(existing);
  const fields = (["status", "name"] as const).filter(
    (field) => changed[field] !== current[field],
  );
  for (const field of fields) {
    const issue = toIssue(
      field,
      issuesWith({ ...current, [field]: changed[field] }),
    );
    if (issue) {
      return issue;
    }
  }
  return fields.length > 1
    ? toIssue(fields[0] ?? "status", issuesWith(changed))
    : undefined;
}

export function errorTypeRoutes(db: Db) {
  return new Hono()
    .get("/:projectId/error-types", (c) => {
      const project = findProject(db, c.req.param("projectId"));
      if (!project) {
        return projectNotFound(c);
      }
      const endpointIds = endpointIdsByErrorType(db, project.id);
      return c.json(
        errorTypesOf(db, project.id).map((row) =>
          toErrorType(row, endpointIds.get(row.id) ?? []),
        ),
      );
    })
    .post(
      "/:projectId/error-types",
      jsonBody(createErrorTypeInputSchema),
      (c) => {
        const project = findProject(db, c.req.param("projectId"));
        if (!project) {
          return projectNotFound(c);
        }
        const input = c.req.valid("json");
        if (isNameTaken(db, project.id, input.name)) {
          return nameTaken(c);
        }
        const issues = checkSchemas(db, project.id, input);
        if (issues.length > 0) {
          return validationFailed(c, issues);
        }

        const now = new Date();
        const row = db
          .insert(errorTypes)
          .values({
            ...input,
            id: ulid(),
            projectId: project.id,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        touchProject(db, project.id, now);

        return c.json(toErrorType(row, []), 201);
      },
    )
    .get("/:projectId/error-types/:errorTypeId", (c) => {
      const row = findErrorType(
        db,
        c.req.param("projectId"),
        c.req.param("errorTypeId"),
      );
      if (!row) {
        return errorTypeNotFound(c);
      }
      const endpointIds = endpointIdsByErrorType(db, row.projectId);
      return c.json(toErrorType(row, endpointIds.get(row.id) ?? []));
    })
    .patch(
      "/:projectId/error-types/:errorTypeId",
      jsonBody(updateErrorTypeInputSchema),
      (c) => {
        const existing = findErrorType(
          db,
          c.req.param("projectId"),
          c.req.param("errorTypeId"),
        );
        if (!existing) {
          return errorTypeNotFound(c);
        }
        const { revision, ...input } = c.req.valid("json");
        const stale = staleRevision(
          c,
          "error type",
          revision,
          existing.revision,
        );
        if (stale) {
          return stale;
        }
        const result = errorTypeFieldsSchema.safeParse({
          ...fieldsOf(existing),
          ...input,
        });
        if (!result.success) {
          return validationFailed(c, toApiIssues(result.error));
        }
        const fields = result.data;
        if (
          input.name !== undefined &&
          isNameTaken(db, existing.projectId, fields.name, existing.id)
        ) {
          return nameTaken(c);
        }
        const issues = checkSchemas(db, existing.projectId, fields);
        if (issues.length > 0) {
          return validationFailed(c, issues);
        }
        const broken = breakingChange(db, existing, fields);
        if (broken) {
          return c.json<ApiErrorBody>(
            { error: broken.message, issues: [broken] },
            409,
          );
        }

        const now = new Date();
        const row = db
          .update(errorTypes)
          .set({ ...fields, revision: existing.revision + 1, updatedAt: now })
          .where(eq(errorTypes.id, existing.id))
          .returning()
          .get();
        touchProject(db, existing.projectId, now);

        const endpointIds = endpointIdsByErrorType(db, existing.projectId);
        return c.json(
          toErrorType(row ?? existing, endpointIds.get(existing.id) ?? []),
        );
      },
    )
    .delete("/:projectId/error-types/:errorTypeId", (c) => {
      const errorType = findErrorType(
        db,
        c.req.param("projectId"),
        c.req.param("errorTypeId"),
      );
      if (!errorType) {
        return errorTypeNotFound(c);
      }

      const users = endpointsUsingErrorType(
        db,
        errorType.projectId,
        errorType.id,
      );
      if (users.length > 0) {
        return c.json<ApiErrorBody>(
          {
            error: `${errorType.name} is used by ${users.map(endpointLabel).join(", ")}. Remove it from those responses first.`,
          },
          409,
        );
      }

      db.delete(errorTypes).where(eq(errorTypes.id, errorType.id)).run();
      touchProject(db, errorType.projectId);
      return c.body(null, 204);
    });
}
