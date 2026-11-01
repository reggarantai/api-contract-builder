import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateErrorTypeDialog } from "@/features/error-types/create-error-type-dialog";
import { errorTypesQueryOptions } from "@/features/error-types/queries";

export const Route = createFileRoute("/projects/$projectId/error-types")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(
      errorTypesQueryOptions(params.projectId),
    ),
  component: ErrorTypesLayout,
});

function ErrorTypesLayout() {
  const { projectId } = Route.useParams();
  const { data: errorTypes } = useSuspenseQuery(
    errorTypesQueryOptions(projectId),
  );

  return (
    <div className="grid items-start gap-6 md:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">Error types</h2>
          <CreateErrorTypeDialog
            projectId={projectId}
            trigger={
              <Button
                variant="outline"
                size="icon-sm"
                aria-label="New error type"
              >
                <PlusIcon />
              </Button>
            }
          />
        </div>
        {errorTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No error types yet.</p>
        ) : (
          <nav aria-label="Error types" className="grid gap-0.5">
            {errorTypes.map((errorType) => (
              <Link
                key={errorType.id}
                to="/projects/$projectId/error-types/$errorTypeId"
                params={{ projectId, errorTypeId: errorType.id }}
                className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                activeProps={{ className: "bg-muted font-medium" }}
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {errorType.status}
                </span>
                <span className="truncate font-mono">{errorType.name}</span>
              </Link>
            ))}
          </nav>
        )}
      </aside>
      <Outlet />
    </div>
  );
}
