import { useSuspenseQuery } from "@tanstack/react-query";
import {
  createFileRoute,
  Link,
  notFound,
  Outlet,
} from "@tanstack/react-router";
import { projectQueryOptions } from "@/features/projects/queries";
import { ApiError } from "@/lib/api";

export const Route = createFileRoute("/projects/$projectId")({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(
        projectQueryOptions(params.projectId),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        throw notFound();
      }
      throw error;
    }
  },
  component: ProjectLayout,
});

const tabClassName =
  "-mb-px border-b-2 border-transparent px-3 py-2 text-sm text-muted-foreground transition-colors hover:text-foreground";
const activeTabClassName = "border-foreground text-foreground";

function ProjectLayout() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));

  return (
    <div className="space-y-8">
      <div className="space-y-4">
        <div className="flex items-baseline gap-3">
          <h1 className="font-heading text-2xl font-semibold">
            {project.name}
          </h1>
          <span className="text-sm text-muted-foreground">
            v{project.apiVersion}
          </span>
        </div>
        <nav className="flex gap-1 border-b">
          <Link
            to="/projects/$projectId"
            params={{ projectId }}
            activeOptions={{ exact: true }}
            className={tabClassName}
            activeProps={{ className: activeTabClassName }}
          >
            Overview
          </Link>
          <Link
            to="/projects/$projectId/settings"
            params={{ projectId }}
            className={tabClassName}
            activeProps={{ className: activeTabClassName }}
          >
            Settings
          </Link>
        </nav>
      </div>
      <Outlet />
    </div>
  );
}
