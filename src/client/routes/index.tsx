import type { ProjectSummary } from "@shared/projects";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CreateProjectDialog } from "@/features/projects/create-project-dialog";
import { CreateSampleButton } from "@/features/projects/create-sample-button";
import { ImportProjectButton } from "@/features/projects/import-project-button";
import { projectsQueryOptions } from "@/features/projects/queries";
import { firstParagraph, formatRelativeTime } from "@/lib/format";

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    context.queryClient.ensureQueryData(projectsQueryOptions()),
  component: HomePage,
});

function HomePage() {
  const projects = useQuery(projectsQueryOptions());

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="font-heading text-2xl font-semibold">Projects</h1>
        {projects.data && projects.data.length > 0 && (
          <div className="flex gap-2">
            <ImportProjectButton />
            <CreateSampleButton />
            <CreateProjectDialog />
          </div>
        )}
      </div>

      {projects.data?.length === 0 && (
        <Card className="border-dashed">
          <CardHeader className="text-center">
            <CardTitle>No projects yet</CardTitle>
            <CardDescription>
              Create a project to start writing API contracts page by page, look
              around a finished sample first, or import a project file.
            </CardDescription>
          </CardHeader>
          <CardFooter className="justify-center gap-2">
            <ImportProjectButton />
            <CreateSampleButton />
            <CreateProjectDialog />
          </CardFooter>
        </Card>
      )}

      {projects.data && projects.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.data.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              showSlug={
                projects.data.filter((item) => item.name === project.name)
                  .length > 1
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** `showSlug` tells projects with the same name apart, like an imported copy. */
function ProjectCard({
  project,
  showSlug,
}: {
  project: ProjectSummary;
  showSlug: boolean;
}) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="rounded-xl focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <Card className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardTitle className="truncate">{project.name}</CardTitle>
          {showSlug && (
            <p className="truncate font-mono text-xs text-muted-foreground">
              {project.slug}
            </p>
          )}
          <CardDescription className="line-clamp-2">
            {firstParagraph(project.description) || "No description"}
          </CardDescription>
        </CardHeader>
        <CardFooter className="mt-auto justify-between gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">v{project.apiVersion}</Badge>
          <span>Updated {formatRelativeTime(project.updatedAt)}</span>
        </CardFooter>
      </Card>
    </Link>
  );
}
