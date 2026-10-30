import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { PageEditor } from "@/features/pages/page-editor";
import { pageQueryOptions } from "@/features/pages/queries";
import { ensureFound } from "@/lib/router";

export const Route = createFileRoute("/projects/$projectId/pages/$pageId/edit")(
  {
    loader: ({ context, params }) =>
      ensureFound(
        context.queryClient.ensureQueryData(
          pageQueryOptions(params.projectId, params.pageId),
        ),
      ),
    component: EditPage,
  },
);

function EditPage() {
  const { projectId, pageId } = Route.useParams();
  const { data: page } = useSuspenseQuery(pageQueryOptions(projectId, pageId));
  return <PageEditor key={page.id} page={page} />;
}
