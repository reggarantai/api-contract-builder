import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ErrorTypeEditor } from "@/features/error-types/error-type-editor";
import { errorTypeQueryOptions } from "@/features/error-types/queries";
import { ensureFound } from "@/lib/router";

export const Route = createFileRoute(
  "/projects/$projectId/error-types/$errorTypeId",
)({
  loader: ({ context, params }) =>
    ensureFound(
      context.queryClient.ensureQueryData(
        errorTypeQueryOptions(params.projectId, params.errorTypeId),
      ),
    ),
  component: ErrorTypePage,
});

function ErrorTypePage() {
  const { projectId, errorTypeId } = Route.useParams();
  const { data: errorType } = useSuspenseQuery(
    errorTypeQueryOptions(projectId, errorTypeId),
  );
  return (
    <ErrorTypeEditor
      key={errorType.id}
      projectId={projectId}
      errorType={errorType}
    />
  );
}
