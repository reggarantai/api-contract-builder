import { createFileRoute, Outlet } from "@tanstack/react-router";
import { endpointsQueryOptions } from "@/features/endpoints/queries";
import { pagesQueryOptions } from "@/features/pages/queries";

export const Route = createFileRoute("/projects/$projectId/pages")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(pagesQueryOptions(params.projectId)),
      // Pages show and link the endpoints they call.
      context.queryClient.ensureQueryData(
        endpointsQueryOptions(params.projectId),
      ),
    ]),
  component: Outlet,
});
