import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { ModelEditor } from "@/features/models/model-editor";
import { modelQueryOptions } from "@/features/models/queries";
import { ensureFound } from "@/lib/router";

export const Route = createFileRoute("/projects/$projectId/models/$modelId")({
  loader: ({ context, params }) =>
    ensureFound(
      context.queryClient.ensureQueryData(
        modelQueryOptions(params.projectId, params.modelId),
      ),
    ),
  component: ModelPage,
});

function ModelPage() {
  const { projectId, modelId } = Route.useParams();
  const { data: model } = useSuspenseQuery(
    modelQueryOptions(projectId, modelId),
  );
  return <ModelEditor key={model.id} projectId={projectId} model={model} />;
}
