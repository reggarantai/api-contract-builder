import { and, asc, eq, ne } from "drizzle-orm";
import type { ApiIssue } from "../../shared/api-error";
import {
  compareEndpoints,
  endpointLabel,
  schemasOfEndpoint,
} from "../../shared/endpoints";
import { schemasOfErrorType } from "../../shared/error-types";
import {
  collectRefs,
  type JsonSchema,
  modelRef,
  modelRefIssues,
} from "../../shared/json-schema";
import type { PageState, StateCause } from "../../shared/page-states";
import type { PageEndpointLink } from "../../shared/pages";
import type { Db } from "./client";
import {
  endpoints,
  errorTypes,
  models,
  type PageRow,
  pageEndpoints,
  pages,
} from "./schema";

function byName(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/**
 * Issues for `$ref`s in `schema` that don't point at a model of this project.
 * `extraModelId` also counts as existing (a model referencing itself).
 */
export function checkModelRefs(
  db: Db,
  projectId: string,
  schema: JsonSchema,
  issuePath: string,
  extraModelId?: string,
): ApiIssue[] {
  const modelIds = new Set(
    db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.projectId, projectId))
      .all()
      .map((row) => row.id),
  );
  if (extraModelId) {
    modelIds.add(extraModelId);
  }
  return modelRefIssues(schema, modelIds, issuePath);
}

/**
 * Other models (by name), error types ("error type <name>"), and endpoints
 * (by label) that reference a model.
 */
export function usersOfModel(db: Db, projectId: string, modelId: string) {
  const ref = modelRef(modelId);
  const usesRef = (schema: JsonSchema) => collectRefs(schema).includes(ref);

  const modelUsers = db
    .select({ name: models.name, schema: models.schema })
    .from(models)
    .where(and(eq(models.projectId, projectId), ne(models.id, modelId)))
    .all()
    .filter((model) => usesRef(model.schema))
    .map((model) => model.name)
    .sort(byName);
  const errorUsers = db
    .select({
      name: errorTypes.name,
      headers: errorTypes.headers,
      body: errorTypes.body,
    })
    .from(errorTypes)
    .where(eq(errorTypes.projectId, projectId))
    .all()
    .filter((errorType) =>
      schemasOfErrorType(errorType).some(([, schema]) => usesRef(schema)),
    )
    .map((errorType) => errorType.name)
    .sort(byName)
    .map((name) => `error type ${name}`);
  const endpointUsers = db
    .select()
    .from(endpoints)
    .where(eq(endpoints.projectId, projectId))
    .all()
    .filter((endpoint) =>
      schemasOfEndpoint(endpoint).some(([, schema]) => usesRef(schema)),
    )
    .map(endpointLabel)
    .sort(byName);

  return [...modelUsers, ...errorUsers, ...endpointUsers];
}

/** The endpoints whose responses use each catalog error, in list order. */
export function endpointIdsByErrorType(db: Db, projectId: string) {
  const byErrorType = new Map<string, string[]>();
  for (const endpoint of endpointsOf(db, projectId)) {
    const ids = new Set(
      endpoint.responses.flatMap((response) =>
        response.errors.map((error) => error.errorTypeId),
      ),
    );
    for (const id of ids) {
      byErrorType.set(id, [...(byErrorType.get(id) ?? []), endpoint.id]);
    }
  }
  return byErrorType;
}

/** The endpoints whose responses use a catalog error, in list order. */
export function endpointsUsingErrorType(
  db: Db,
  projectId: string,
  errorTypeId: string,
) {
  return endpointsOf(db, projectId).filter((endpoint) =>
    endpoint.responses.some((response) =>
      response.errors.some((error) => error.errorTypeId === errorTypeId),
    ),
  );
}

function endpointsOf(db: Db, projectId: string) {
  return db
    .select()
    .from(endpoints)
    .where(eq(endpoints.projectId, projectId))
    .all()
    .sort(compareEndpoints);
}

/** Endpoints (by label) that require a security scheme explicitly. */
export function endpointsUsingScheme(
  db: Db,
  projectId: string,
  schemeId: string,
) {
  return db
    .select()
    .from(endpoints)
    .where(eq(endpoints.projectId, projectId))
    .all()
    .filter(
      (endpoint) =>
        endpoint.security.type === "schemes" &&
        endpoint.security.schemeIds.includes(schemeId),
    )
    .map(endpointLabel)
    .sort(byName);
}

/** The pages that call each endpoint of a project, in page order. */
export function pageIdsByEndpoint(db: Db, projectId: string) {
  const rows = db
    .select({
      endpointId: pageEndpoints.endpointId,
      pageId: pageEndpoints.pageId,
    })
    .from(pageEndpoints)
    .innerJoin(pages, eq(pages.id, pageEndpoints.pageId))
    .where(eq(pages.projectId, projectId))
    .orderBy(asc(pages.sortOrder))
    .all();
  const byEndpoint = new Map<string, string[]>();
  for (const { endpointId, pageId } of rows) {
    const pageIds = byEndpoint.get(endpointId) ?? [];
    if (!pageIds.includes(pageId)) {
      pageIds.push(pageId);
    }
    byEndpoint.set(endpointId, pageIds);
  }
  return byEndpoint;
}

/** A page's links, in order. */
export function linksOfPage(db: Db, pageId: string): PageEndpointLink[] {
  return db
    .select({
      id: pageEndpoints.id,
      endpointId: pageEndpoints.endpointId,
      trigger: pageEndpoints.trigger,
      note: pageEndpoints.note,
    })
    .from(pageEndpoints)
    .where(eq(pageEndpoints.pageId, pageId))
    .orderBy(asc(pageEndpoints.sortOrder))
    .all();
}

/**
 * Pages whose states come from a call to the endpoint, in page order, with
 * their links and a test for causes that do.
 */
export function pagesWithStatesFrom(
  db: Db,
  projectId: string,
  endpointId: string,
) {
  return db
    .select()
    .from(pages)
    .where(eq(pages.projectId, projectId))
    .orderBy(asc(pages.sortOrder))
    .all()
    .flatMap((page) => {
      if (page.states.length === 0) {
        return [];
      }
      const links = linksOfPage(db, page.id);
      const calls = new Set(
        links
          .filter((link) => link.endpointId === endpointId)
          .map((link) => link.id),
      );
      const comesFrom = (cause: StateCause) => calls.has(cause.linkId);
      return page.states.some((state) => state.causes.some(comesFrom))
        ? [{ page, links, comesFrom }]
        : [];
    });
}

/** The page's states without the causes `remove` picks; null when none is picked. */
export function statesWithout(
  page: PageRow,
  remove: (cause: StateCause) => boolean,
): PageState[] | null {
  let removed = false;
  const states = page.states.map((state) => {
    const causes = state.causes.filter((cause) => !remove(cause));
    removed ||= causes.length < state.causes.length;
    return { ...state, causes };
  });
  return removed ? states : null;
}
