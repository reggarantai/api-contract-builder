import { healthResponseSchema } from "@shared/health";
import type { QueryClient } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  Outlet,
} from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { apiGet } from "@/lib/api";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
  {
    component: RootLayout,
  },
);

function RootLayout() {
  return (
    <div className="flex min-h-svh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
          <Link to="/" className="font-heading font-semibold">
            API Contract Builder
          </Link>
          <ServerStatus />
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-10">
        <Outlet />
      </main>
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
