import { healthResponseSchema } from "@shared/health";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
  useParams,
} from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Toaster } from "@/components/ui/sonner";
import { ProjectSwitcher } from "@/features/projects/project-switcher";
import { apiGet } from "@/lib/api";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: RootLayout,
  },
);

function RootLayout() {
  const { projectId } = useParams({ strict: false });

  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-2 px-6">
          <Link to="/" className="font-heading font-semibold">
            API Contract Builder
          </Link>
          {projectId && (
            <>
              <span className="text-muted-foreground">/</span>
              <ProjectSwitcher projectId={projectId} />
            </>
          )}
          <div className="ml-auto">
            <ServerStatus />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <Outlet />
      </main>
      <Toaster position="bottom-right" />
    </div>
  );
}

function ServerStatus() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: () => apiGet("/health", healthResponseSchema),
    refetchInterval: 30_000,
  });

  if (health.isPending) {
    return <Badge variant="outline">Connecting…</Badge>;
  }
  if (health.isError) {
    return <Badge variant="destructive">Server unreachable</Badge>;
  }
  return <Badge variant="secondary">v{health.data.version}</Badge>;
}
