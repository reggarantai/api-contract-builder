import type { ExportFormat } from "@shared/export";
import { exportReportSchema } from "@shared/export";
import { projectFileReportSchema } from "@shared/project-file";
import { queryOptions } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/api";
import { projectKeys } from "../projects/queries";

function exportPath(projectId: string, kind: "openapi" | "report") {
  return `/projects/${encodeURIComponent(projectId)}/export/${kind}`;
}

function pageQuery(pageId: string | undefined) {
  return pageId ? `page=${encodeURIComponent(pageId)}` : "";
}

/** Validity and warnings of an export; always rechecked when shown. */
export function exportReportQueryOptions(projectId: string, pageId?: string) {
  const query = pageQuery(pageId);
  return queryOptions({
    queryKey: [
      ...projectKeys.detail(projectId),
      "export-report",
      pageId ?? null,
    ],
    queryFn: () =>
      apiGet(
        `${exportPath(projectId, "report")}${query ? `?${query}` : ""}`,
        exportReportSchema,
      ),
    staleTime: 0,
  });
}

/** The API path of an OpenAPI export. */
export function exportDownloadPath(
  projectId: string,
  format: ExportFormat,
  pageId?: string,
) {
  const query = [`format=${format}`, pageQuery(pageId)]
    .filter(Boolean)
    .join("&");
  return `${exportPath(projectId, "openapi")}?${query}`;
}

/** The API path of the Markdown bundle (.zip). */
export function markdownDownloadPath(projectId: string, pageId?: string) {
  const query = pageQuery(pageId);
  return `/projects/${encodeURIComponent(projectId)}/export/markdown${query ? `?${query}` : ""}`;
}

/** Size of the project file, and what would stop this instance importing it. */
export function projectFileReportQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: [...projectKeys.detail(projectId), "project-file-report"],
    queryFn: () =>
      apiGet(
        `/projects/${encodeURIComponent(projectId)}/export/project/report`,
        projectFileReportSchema,
      ),
    staleTime: 0,
    // A refusal says why, and asking again won't change it.
    retry: (failures, error) =>
      !(error instanceof ApiError && error.status < 500) && failures < 3,
  });
}

/** Where the browser downloads the project file (.project.zip) from. */
export function projectFileDownloadUrl(projectId: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/export/project`;
}
