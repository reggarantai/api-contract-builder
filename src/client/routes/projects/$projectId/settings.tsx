import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { projectQueryOptions } from "@/features/projects/queries";
import { AuthSettings } from "@/features/projects/settings/auth-settings";
import { DeleteProject } from "@/features/projects/settings/delete-project";
import { GeneralSettings } from "@/features/projects/settings/general-settings";
import { ServersSettings } from "@/features/projects/settings/servers-settings";

export const Route = createFileRoute("/projects/$projectId/settings")({
  component: ProjectSettingsPage,
});

function ProjectSettingsPage() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));

  return (
    <div className="max-w-3xl space-y-6">
      <GeneralSettings project={project} />
      <ServersSettings project={project} />
      <AuthSettings project={project} />
      <DeleteProject project={project} />
    </div>
  );
}
