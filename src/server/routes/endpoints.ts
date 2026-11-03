import { and, eq, ne } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { ApiErrorBody, ApiIssue } from "../../shared/api-error";
import {
  createEndpointDefaults,
  createEndpointInputSchema,
  type Endpoint,
  type EndpointFields,
  type EndpointResponse,
  type EndpointSummary,
  endpointLabel,
  endpointSchema,
  examplesOfEndpoint,
  HTTP_METHODS,
  type HttpMethod,
  pathMatchKey,
  repairEndpointFields,
  schemasOfEndpoint,
  type UpdateEndpointInput,
  updateEndpointInputSchema,
} from "../../shared/endpoints";
import { checkResponseErrors } from "../../shared/error-types";
import { nestingIssues } from "../../shared/json-schema";
import { resolveCause } from "../../shared/page-states";
import type { Db } from "../db/client";
import { findProject, touchProject } from "../db/projects";
import {
  checkModelRefs,
  pageIdsByEndpoint,
  pagesWithStatesFrom,
  statesWithout,
} from "../db/references";
import {
  type EndpointRow,
  endpoints,
  errorTypes,
  type PageRow,
  type ProjectRow,
  pages,
} from "../db/schema";
import { newId } from "../ids";
import {
  jsonBody,
  staleRevision,
  toApiIssues,
  validationFailed,
  withoutStoredNesting,
} from "../validation";

function fieldsOf(row: EndpointRow): EndpointFields {
  return repairEndpointFields({
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
  });
}

export function toEndpoint(row: EndpointRow): Endpoint {
  return {
    ...fieldsOf(row),
    id: row.id,
    projectId: row.projectId,
    revision: row.revision,
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

/**
 * Issues for security schemes, models, and catalog errors the endpoint uses
 * but the project lacks, for catalog errors its responses can't use, and for
 * schemas and examples nested too deeply to follow.
 */
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
  for (const [path, value] of examplesOfEndpoint(fields)) {
    issues.push(...nestingIssues(value, path, "example"));
  }
  if (fields.responses.some((response) => response.errors.length > 0)) {
    const catalog = db
      .select({
        id: errorTypes.id,
        name: errorTypes.name,
        status: errorTypes.status,
        body: errorTypes.body,
      })
      .from(errorTypes)
      .where(eq(errorTypes.projectId, project.id))
      .all();
    issues.push(...checkResponseErrors(fields, catalog));
  }
  return issues;
}

/**
 * Responses as sent, where those without `errors` (from clients older than
 * the error catalog, which drop fields they don't know) keep the errors the
 * response had, so a save can't silently lose them.
 */
function withStoredErrors(
  responses: NonNullable<UpdateEndpointInput["responses"]>,
  stored: EndpointResponse[],
) {
  return responses.map((response) => ({
    ...response,
    errors:
      response.errors ??
      (response.body === null
        ? (stored.find((item) => item.id === response.id)?.errors ?? [])
        : []),
  }));
}

/**
 * Page states with causes that the changed endpoint no longer answers, and
 * the states of each page without those causes.
 */
function statesBrokenBy(db: Db, project: ProjectRow, endpoint: Endpoint) {
  const errorTypesById = new Map(
    db
      .select()
      .from(errorTypes)
      .where(eq(errorTypes.projectId, project.id))
      .all()
      .map((row) => [row.id, row]),
  );
  const endpointsById = new Map([[endpoint.id, endpoint]]);
  return pagesWithStatesFrom(db, project.id, endpoint.id).flatMap(
    ({ page, links, comesFrom }) => {
      const broken = (cause: Parameters<typeof comesFrom>[0]) =>
        comesFrom(cause) &&
        "error" in resolveCause(cause, links, endpointsById, errorTypesById);
      const states = statesWithout(page, broken);
      return states
        ? [
            {
              page,
              states,
              used: page.states.filter((state) => state.causes.some(broken)),
            },
          ]
        : [];
    },
  );
}

function saveStates(
  tx: Pick<Db, "update">,
  changes: { page: PageRow; states: PageRow["states"] }[],
  now: Date,
) {
  for (const { page, states } of changes) {
    tx.update(pages)
      .set({ states, updatedAt: now })
      .where(eq(pages.id, page.id))
      .run();
  }
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
        newId,
      );
      const now = new Date();
      const row = db
        .insert(endpoints)
        .values({
          ...fields,
          id: newId(),
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

        const { revision, ...input } = c.req.valid("json");
        const stale = staleRevision(c, "endpoint", revision, existing.revision);
        if (stale) {
          return stale;
        }
        const result = endpointSchema.safeParse({
          ...fieldsOf(existing),
          ...input,
          ...(input.responses && {
            // By the IDs clients read, which are unique.
            responses: withStoredErrors(
              input.responses,
              fieldsOf(existing).responses,
            ),
          }),
        });
        if (!result.success) {
          return validationFailed(c, toApiIssues(result.error));
        }
        const fields = result.data;

        const referenceIssues = withoutStoredNesting(
          checkReferences(db, project, fields),
          fields,
          fieldsOf(existing),
        );
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

        // Page states come from its responses and examples by ID.
        const broken = statesBrokenBy(db, project, {
          ...toEndpoint(existing),
          ...fields,
        });
        if (broken.length > 0 && c.req.query("detachStates") !== "true") {
          const pageStates = broken.flatMap(({ page, used }) =>
            used.map((state) => ({
              pageId: page.id,
              pageName: page.name,
              stateId: state.id,
              stateName: state.name,
            })),
          );
          return c.json<ApiErrorBody>(
            {
              error: `Page states come from what this change removes: ${pageStates.map((state) => `${state.pageName} › ${state.stateName}`).join(", ")}. Change those states first, or remove it from them.`,
              pageStates,
            },
            409,
          );
        }

        const now = new Date();
        const row = db.transaction((tx) => {
          saveStates(tx, broken, now);
          return tx
            .update(endpoints)
            .set({
              ...fields,
              pathKey: pathMatchKey(fields.path),
              revision: existing.revision + 1,
              updatedAt: now,
            })
            .where(eq(endpoints.id, existing.id))
            .returning()
            .get();
        });
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
      // Pages lose their calls to it, and their states what came from them.
      const now = new Date();
      const changed = pagesWithStatesFrom(
        db,
        endpoint.projectId,
        endpoint.id,
      ).flatMap(({ page, comesFrom }) => {
        const states = statesWithout(page, comesFrom);
        return states ? [{ page, states }] : [];
      });
      db.transaction((tx) => {
        saveStates(tx, changed, now);
        tx.delete(endpoints).where(eq(endpoints.id, endpoint.id)).run();
      });
      touchProject(db, endpoint.projectId, now);
      return c.body(null, 204);
    });
}
