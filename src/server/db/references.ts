import { and, eq, ne } from "drizzle-orm";
import type { ApiIssue } from "../../shared/api-error";
import { endpointLabel, schemasOfEndpoint } from "../../shared/endpoints";
import {
  COMPONENT_REF_PREFIX,
  collectRefs,
  type JsonSchema,
  modelIdOfRef,
  modelRef,
} from "../../shared/json-schema";
import type { Db } from "./client";
import { endpoints, models } from "./schema";

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

  const messages = new Set<string>();
  for (const ref of collectRefs(schema)) {
    const id = modelIdOfRef(ref);
    if (id !== null) {
      if (!modelIds.has(id)) {
        messages.add(`References a model that doesn't exist: ${ref}`);
      }
    } else if (!ref.startsWith("#") || ref.startsWith(COMPONENT_REF_PREFIX)) {
      messages.add(
        `Unsupported reference "${ref}"; reference a model of this project instead`,
      );
    }
  }
  return [...messages].map((message) => ({ path: issuePath, message }));
}

/** Other models (by name) and endpoints (by label) that reference a model. */
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

  return [...modelUsers, ...endpointUsers];
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
