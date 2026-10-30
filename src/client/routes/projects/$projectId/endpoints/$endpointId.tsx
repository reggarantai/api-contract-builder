import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { EndpointEditor } from "@/features/endpoints/editor/endpoint-editor";
import { endpointQueryOptions } from "@/features/endpoints/queries";
import { projectQueryOptions } from "@/features/projects/queries";
import { ensureFound } from "@/lib/router";

export const Route = createFileRoute(
  "/projects/$projectId/endpoints/$endpointId",
)({
  loader: ({ context, params }) =>
    ensureFound(
      context.queryClient.ensureQueryData(
        endpointQueryOptions(params.projectId, params.endpointId),
      ),
    ),
  component: EndpointPage,
});

function EndpointPage() {
  const { projectId, endpointId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));
  const { data: endpoint } = useSuspenseQuery(
    endpointQueryOptions(projectId, endpointId),
  );
  return (
    <EndpointEditor key={endpoint.id} project={project} endpoint={endpoint} />
  );
}
