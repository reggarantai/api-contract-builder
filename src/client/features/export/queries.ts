import type { ExportFormat } from "@shared/export";
import { exportReportSchema } from "@shared/export";
import { queryOptions } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
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

/** Where the browser downloads an export from. */
export function exportDownloadUrl(
  projectId: string,
  format: ExportFormat,
  pageId?: string,
) {
  const query = [`format=${format}`, pageQuery(pageId)]
    .filter(Boolean)
    .join("&");
  return `/api${exportPath(projectId, "openapi")}?${query}`;
}

/** Where the browser downloads the Markdown bundle (.zip) from. */
export function markdownDownloadUrl(projectId: string, pageId?: string) {
  const query = pageQuery(pageId);
  return `/api/projects/${encodeURIComponent(projectId)}/export/markdown${query ? `?${query}` : ""}`;
}
