import { and, eq, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { ulid } from "ulid";
import type { ApiErrorBody, ApiIssue } from "../../shared/api-error";
import {
  createEndpointDefaults,
  createEndpointInputSchema,
  type Endpoint,
  type EndpointFields,
  type EndpointSummary,
  endpointLabel,
  endpointSchema,
  HTTP_METHODS,
  type HttpMethod,
  pathMatchKey,
  schemasOfEndpoint,
  updateEndpointInputSchema,
} from "../../shared/endpoints";
import type { Db } from "../db/client";
import { findProject, touchProject } from "../db/projects";
import { checkModelRefs, pageIdsByEndpoint } from "../db/references";
import { type EndpointRow, endpoints, type ProjectRow } from "../db/schema";
import { jsonBody, toApiIssues, validationFailed } from "../validation";

function fieldsOf(row: EndpointRow): EndpointFields {
  return {
    method: row.method,
    path: row.path,
    operationId: row.operationId,
    summary: row.summary,
    description: row.description,
    status: row.status,
    deprecated: row.deprecated,
    security: row.security,
    parameters: row.parameters,
    requestBody: row.requestBody ?? null,
    responses: row.responses,
    notesFe: row.notesFe,
    notesBe: row.notesBe,
  };
}

export function toEndpoint(row: EndpointRow): Endpoint {
  return {
    ...fieldsOf(row),
    id: row.id,
    projectId: row.projectId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toSummary(row: EndpointRow, pageIds: string[]): EndpointSummary {
  return {
    pageIds,
    id: row.id,
    projectId: row.projectId,
    method: row.method,
    path: row.path,
    summary: row.summary,
    status: row.status,
    deprecated: row.deprecated,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function compareEndpoints(a: EndpointRow, b: EndpointRow) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  return HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method);
}

function projectNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Project not found" }, 404);
}

function endpointNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Endpoint not found" }, 404);
}

function conflict(c: Context, issue: ApiIssue) {
  return c.json<ApiErrorBody>({ error: issue.message, issues: [issue] }, 409);
}

function findEndpoint(db: Db, projectId: string, endpointId: string) {
  return db
    .select()
    .from(endpoints)
    .where(
      and(eq(endpoints.id, endpointId), eq(endpoints.projectId, projectId)),
    )
    .get();
}

/** Another endpoint with the same method and path (ignoring parameter names). */
function findSamePath(
  db: Db,
  projectId: string,
  method: HttpMethod,
  path: string,
  exceptId = "",
) {
  return db
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.projectId, projectId),
        eq(endpoints.method, method),
        eq(endpoints.pathKey, pathMatchKey(path)),
        ne(endpoints.id, exceptId),
      ),
    )
    .get();
}

function findOperationIdOwner(
  db: Db,
  projectId: string,
  operationId: string,
  exceptId: string,
) {
  if (operationId === "") {
    return undefined;
  }
  return db
    .select()
    .from(endpoints)
    .where(
      and(
        eq(endpoints.projectId, projectId),
        eq(endpoints.operationId, operationId),
        ne(endpoints.id, exceptId),
      ),
    )
    .get();
}

/** Issues for security schemes and models the endpoint uses but the project lacks. */
function checkReferences(
  db: Db,
  project: ProjectRow,
  fields: EndpointFields,
): ApiIssue[] {
  const issues: ApiIssue[] = [];
  const { security } = fields;
  if (security.type === "schemes") {
    const known = new Set(project.securitySchemes.map((scheme) => scheme.id));
    if (security.schemeIds.some((id) => !known.has(id))) {
      issues.push({
        path: "security.schemeIds",
        message: "Pick schemes from the project's authentication settings",
      });
    }
  }
  for (const [path, schema] of schemasOfEndpoint(fields)) {
    issues.push(...checkModelRefs(db, project.id, schema, path));
  }
  return issues;
}

export function endpointRoutes(db: Db) {
  return new Hono()
    .get("/:projectId/endpoints", (c) => {
      const project = findProject(db, c.req.param("projectId"));
      if (!project) {
        return projectNotFound(c);
      }
      const rows = db
        .select()
        .from(endpoints)
        .where(eq(endpoints.projectId, project.id))
        .all()
        .sort(compareEndpoints);
      const pageIds = pageIdsByEndpoint(db, project.id);
      return c.json(
        rows.map((row) => toSummary(row, pageIds.get(row.id) ?? [])),
      );
    })
    .post("/:projectId/endpoints", jsonBody(createEndpointInputSchema), (c) => {
      const project = findProject(db, c.req.param("projectId"));
      if (!project) {
        return projectNotFound(c);
      }
      const input = c.req.valid("json");
      const existing = findSamePath(db, project.id, input.method, input.path);
      if (existing) {
        return conflict(c, {
          path: "path",
          message: `${endpointLabel(existing)} already exists`,
        });
      }

      const fields = createEndpointDefaults(
        input.method,
        input.path,
        input.summary,
        ulid,
      );
      const now = new Date();
      const row = db
        .insert(endpoints)
        .values({
          ...fields,
          id: ulid(),
          projectId: project.id,
          pathKey: pathMatchKey(fields.path),
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      touchProject(db, project.id, now);

      return c.json(toEndpoint(row), 201);
    })
    .get("/:projectId/endpoints/:endpointId", (c) => {
      const row = findEndpoint(
        db,
        c.req.param("projectId"),
        c.req.param("endpointId"),
      );
      return row ? c.json(toEndpoint(row)) : endpointNotFound(c);
    })
    .patch(
      "/:projectId/endpoints/:endpointId",
      jsonBody(updateEndpointInputSchema),
      (c) => {
        const project = findProject(db, c.req.param("projectId"));
        const existing =
          project && findEndpoint(db, project.id, c.req.param("endpointId"));
        if (!project || !existing) {
          return endpointNotFound(c);
        }

        const result = endpointSchema.safeParse({
          ...fieldsOf(existing),
          ...c.req.valid("json"),
        });
        if (!result.success) {
          return validationFailed(c, toApiIssues(result.error));
        }
        const fields = result.data;

        const referenceIssues = checkReferences(db, project, fields);
        if (referenceIssues.length > 0) {
          return validationFailed(c, referenceIssues);
        }
        const samePath = findSamePath(
          db,
          project.id,
          fields.method,
          fields.path,
          existing.id,
        );
        if (samePath) {
          return conflict(c, {
            path: "path",
            message: `${endpointLabel(samePath)} already exists`,
          });
        }
        const owner = findOperationIdOwner(
          db,
          project.id,
          fields.operationId,
          existing.id,
        );
        if (owner) {
          return conflict(c, {
            path: "operationId",
            message: `Already used by ${endpointLabel(owner)}`,
          });
        }

        const now = new Date();
        const row = db
          .update(endpoints)
          .set({
            ...fields,
            pathKey: pathMatchKey(fields.path),
            updatedAt: now,
          })
          .where(eq(endpoints.id, existing.id))
          .returning()
          .get();
        touchProject(db, project.id, now);

        return c.json(toEndpoint(row ?? existing));
      },
    )
    .delete("/:projectId/endpoints/:endpointId", (c) => {
      const endpoint = findEndpoint(
        db,
        c.req.param("projectId"),
        c.req.param("endpointId"),
      );
      if (!endpoint) {
        return endpointNotFound(c);
      }
      db.delete(endpoints).where(eq(endpoints.id, endpoint.id)).run();
      touchProject(db, endpoint.projectId);
      return c.body(null, 204);
    });
}
