import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { projectQueryOptions } from "@/features/projects/queries";
import {
  describeSecurityScheme,
  SECURITY_SCHEME_LABELS,
} from "@/features/projects/security-schemes";

export const Route = createFileRoute("/projects/$projectId/")({
  component: ProjectOverview,
});

function ProjectOverview() {
  const { projectId } = Route.useParams();
  const { data: project } = useSuspenseQuery(projectQueryOptions(projectId));
  const settingsLink = (
    <Link
      to="/projects/$projectId/settings"
      params={{ projectId }}
      className="underline underline-offset-4"
    >
      Settings
    </Link>
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Description</CardTitle>
          <CardDescription className="whitespace-pre-wrap">
            {project.description || "No description yet."}
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Servers</CardTitle>
          {project.servers.length === 0 && (
            <CardDescription>
              No servers yet. Add them in {settingsLink}.
            </CardDescription>
          )}
        </CardHeader>
        {project.servers.length > 0 && (
          <CardContent>
            <ul className="space-y-3 text-sm">
              {project.servers.map((server, index) => (
                <li key={server.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 font-medium">
                    {server.name}
                    {index === 0 && <Badge variant="secondary">Default</Badge>}
                  </div>
                  <code className="break-all text-muted-foreground">
                    {server.url}
                  </code>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Authentication</CardTitle>
          {project.securitySchemes.length === 0 && (
            <CardDescription>
              Public — no authentication schemes. Add them in {settingsLink}.
            </CardDescription>
          )}
        </CardHeader>
        {project.securitySchemes.length > 0 && (
          <CardContent>
            <ul className="space-y-3 text-sm">
              {project.securitySchemes.map((scheme) => (
                <li key={scheme.id} className="space-y-0.5">
                  <div className="flex items-center gap-2 font-medium">
                    {scheme.key}
                    <span className="font-normal text-muted-foreground">
                      {SECURITY_SCHEME_LABELS[scheme.type]}
                    </span>
                    {scheme.id === project.defaultSecuritySchemeId && (
                      <Badge variant="secondary">Default</Badge>
                    )}
                  </div>
                  <code className="text-muted-foreground">
                    {describeSecurityScheme(scheme)}
                  </code>
                </li>
              ))}
            </ul>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
