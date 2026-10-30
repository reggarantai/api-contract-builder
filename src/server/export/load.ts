import { asc, eq, sql } from "drizzle-orm";
import { HTTP_METHODS } from "../../shared/endpoints";
import type { Db } from "../db/client";
import { findProject } from "../db/projects";
import { type EndpointRow, endpoints, models, pages } from "../db/schema";
import { toEndpoint } from "../routes/endpoints";
import { toModel } from "../routes/models";
import { pageFromRow } from "../routes/pages";
import { toProject } from "../routes/projects";
import type { UploadStorage } from "../storage/uploads";
import type { ExportInput } from "./openapi";

function compareEndpointRows(a: EndpointRow, b: EndpointRow) {
  if (a.path !== b.path) {
    return a.path < b.path ? -1 : 1;
  }
  return HTTP_METHODS.indexOf(a.method) - HTTP_METHODS.indexOf(b.method);
}

/** Everything exports read about a project, as the API returns it, in list order. */
export function loadExportInput(
  db: Db,
  storage: UploadStorage,
  projectId: string,
): ExportInput | undefined {
  const project = findProject(db, projectId);
  if (!project) {
    return undefined;
  }
  return {
    project: toProject(project),
    models: db
      .select()
      .from(models)
      .where(eq(models.projectId, project.id))
      .orderBy(sql`${models.name} collate nocase`)
      .all()
      .map(toModel),
    endpoints: db
      .select()
      .from(endpoints)
      .where(eq(endpoints.projectId, project.id))
      .all()
      .sort(compareEndpointRows)
      .map(toEndpoint),
    pages: db
      .select()
      .from(pages)
      .where(eq(pages.projectId, project.id))
      .orderBy(asc(pages.sortOrder))
      .all()
      .map((row) => pageFromRow(db, storage, row)),
  };
}
