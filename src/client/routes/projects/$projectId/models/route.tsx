import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateModelDialog } from "@/features/models/create-model-dialog";
import { modelsQueryOptions } from "@/features/models/queries";

export const Route = createFileRoute("/projects/$projectId/models")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(modelsQueryOptions(params.projectId)),
  component: ModelsLayout,
});

function ModelsLayout() {
  const { projectId } = Route.useParams();
  const { data: models } = useSuspenseQuery(modelsQueryOptions(projectId));

  return (
    <div className="grid items-start gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Models</h2>
          <CreateModelDialog
            projectId={projectId}
            trigger={
              <Button variant="outline" size="icon-sm" aria-label="New model">
                <PlusIcon />
              </Button>
            }
          />
        </div>
        {models.length === 0 ? (
          <p className="text-sm text-muted-foreground">No models yet.</p>
        ) : (
          <nav aria-label="Models" className="grid gap-0.5">
            {models.map((model) => (
              <Link
                key={model.id}
                to="/projects/$projectId/models/$modelId"
                params={{ projectId, modelId: model.id }}
                className="truncate rounded-md px-2 py-1.5 font-mono text-sm hover:bg-muted"
                activeProps={{ className: "bg-muted font-medium" }}
              >
                {model.name}
              </Link>
            ))}
          </nav>
        )}
      </aside>
      <Outlet />
    </div>
  );
}
