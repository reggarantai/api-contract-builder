import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ExportPanel } from "@/features/export/export-panel";
import { pagesQueryOptions } from "@/features/pages/queries";
import { projectQueryOptions } from "@/features/projects/queries";

export const Route = createFileRoute("/projects/$projectId/export")({
  validateSearch: z.object({ page: z.string().optional() }),
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(pagesQueryOptions(params.projectId)),
  component: ExportPage,
});

function ExportPage() {
  const { projectId } = Route.useParams();
  const { page } = Route.useSearch();
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));
  const { data: pages } = useSuspenseQuery(pagesQueryOptions(projectId));
  return <ExportPanel project={project} pages={pages} pageId={page} />;
}
