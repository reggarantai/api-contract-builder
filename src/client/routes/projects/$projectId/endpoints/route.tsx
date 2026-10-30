import { createFileRoute, Outlet } from "@tanstack/react-router";
import { endpointsQueryOptions } from "@/features/endpoints/queries";
import { modelsQueryOptions } from "@/features/models/queries";
import { pagesQueryOptions } from "@/features/pages/queries";

export const Route = createFileRoute("/projects/$projectId/endpoints")({
  loader: ({ context, params }) =>
    Promise.all([
      context.queryClient.ensureQueryData(
        endpointsQueryOptions(params.projectId),
      ),
      // The editor offers models as field types.
      context.queryClient.ensureQueryData(modelsQueryOptions(params.projectId)),
      // The list filters by page.
      context.queryClient.ensureQueryData(pagesQueryOptions(params.projectId)),
    ]),
  component: Outlet,
});
