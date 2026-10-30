import { PAGE_TRIGGER_LABELS } from "@shared/pages";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PencilIcon } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { MethodBadge, StatusLabel } from "@/features/endpoints/badges";
import { endpointsQueryOptions } from "@/features/endpoints/queries";
import { MockupGallery } from "@/features/pages/mockup-gallery";
import { pageQueryOptions } from "@/features/pages/queries";
import { ensureFound } from "@/lib/router";

export const Route = createFileRoute("/projects/$projectId/pages/$pageId/")({
  loader: ({ context, params }) =>
    ensureFound(
      context.queryClient.ensureQueryData(
        pageQueryOptions(params.projectId, params.pageId),
      ),
    ),
  component: PageView,
});

function ViewSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="grid gap-3">
      <h3 className="font-heading text-lg font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

/** The page as stakeholders read it. */
function PageView() {
  const { projectId, pageId } = Route.useParams();
  const { data: page } = useSuspenseQuery(pageQueryOptions(projectId, pageId));
  const { data: endpoints } = useSuspenseQuery(
    endpointsQueryOptions(projectId),
  );
  const links = page.endpoints.flatMap((link) => {
    const endpoint = endpoints.find((item) => item.id === link.endpointId);
    return endpoint ? [{ ...link, endpoint }] : [];
  });

  return (
    <article className="grid gap-8">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-heading text-xl font-semibold">{page.name}</h2>
        <Button asChild variant="outline" size="sm">
          <Link
            to="/projects/$projectId/pages/$pageId/edit"
            params={{ projectId, pageId }}
          >
            <PencilIcon />
            Edit page
          </Link>
        </Button>
      </div>

      <ViewSection title="Description">
        {page.description ? (
          <Markdown>{page.description}</Markdown>
        ) : (
          <Empty>No description yet.</Empty>
        )}
      </ViewSection>

      <ViewSection title="Acceptance criteria">
        {page.acceptanceCriteria ? (
          <Markdown>{page.acceptanceCriteria}</Markdown>
        ) : (
          <Empty>No acceptance criteria yet.</Empty>
        )}
      </ViewSection>

      <ViewSection title="Mockups">
        {page.mockups.length > 0 ? (
          <MockupGallery mockups={page.mockups} />
        ) : (
          <Empty>No mockups yet.</Empty>
        )}
      </ViewSection>

      <ViewSection title="Endpoints">
        {links.length > 0 ? (
          <ol className="divide-y rounded-xl border">
            {links.map((link) => (
              <li key={link.id}>
                <Link
                  to="/projects/$projectId/endpoints/$endpointId"
                  params={{ projectId, endpointId: link.endpoint.id }}
                  className="grid gap-1 px-4 py-3 hover:bg-muted/50"
                >
                  <span className="flex items-center gap-3">
                    <MethodBadge method={link.endpoint.method} />
                    <span className="font-mono text-sm">
                      {link.endpoint.path}
                    </span>
                    <span className="truncate text-sm text-muted-foreground">
                      {link.endpoint.summary}
                    </span>
                    <span className="ml-auto shrink-0">
                      <StatusLabel status={link.endpoint.status} />
                    </span>
                  </span>
                  <span className="text-sm">
                    <span className="font-medium">
                      {PAGE_TRIGGER_LABELS[link.trigger]}
                    </span>
                    {link.note && (
                      <span className="text-muted-foreground">
                        {" "}
                        — {link.note}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <Empty>This page doesn't call any endpoints yet.</Empty>
        )}
      </ViewSection>
    </article>
  );
}
