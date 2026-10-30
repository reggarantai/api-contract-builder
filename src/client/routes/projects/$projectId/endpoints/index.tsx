import {
  ENDPOINT_STATUSES,
  type EndpointStatus,
  HTTP_METHODS,
  type HttpMethod,
} from "@shared/endpoints";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MethodBadge, StatusLabel } from "@/features/endpoints/badges";
import { CreateEndpointDialog } from "@/features/endpoints/create-endpoint-dialog";
import { STATUS_LABELS } from "@/features/endpoints/labels";
import { endpointsQueryOptions } from "@/features/endpoints/queries";

export const Route = createFileRoute("/projects/$projectId/endpoints/")({
  component: EndpointList,
});

const ALL = "all";

function EndpointList() {
  const { projectId } = Route.useParams();
  const { data: endpoints } = useSuspenseQuery(
    endpointsQueryOptions(projectId),
  );
  const [method, setMethod] = useState<HttpMethod | typeof ALL>(ALL);
  const [status, setStatus] = useState<EndpointStatus | typeof ALL>(ALL);
  const [search, setSearch] = useState("");

  if (endpoints.length === 0) {
    return (
      <Card className="border-dashed">
        <CardHeader className="text-center">
          <CardTitle>No endpoints yet</CardTitle>
          <CardDescription>
            Describe each API call once: its parameters, request body, and
            responses. Pages then reference the endpoints they use.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center">
          <CreateEndpointDialog
            projectId={projectId}
            trigger={
              <Button>
                <PlusIcon />
                Create an endpoint
              </Button>
            }
          />
        </CardFooter>
      </Card>
    );
  }

  const query = search.trim().toLowerCase();
  const visible = endpoints.filter(
    (endpoint) =>
      (method === ALL || endpoint.method === method) &&
      (status === ALL || endpoint.status === status) &&
      (query === "" ||
        endpoint.path.toLowerCase().includes(query) ||
        endpoint.summary.toLowerCase().includes(query)),
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          aria-label="Search endpoints"
          placeholder="Search path or summary"
          className="w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Select
          value={method}
          onValueChange={(next) => setMethod(next as HttpMethod | typeof ALL)}
        >
          <SelectTrigger aria-label="Method filter" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All methods</SelectItem>
            {HTTP_METHODS.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(next) =>
            setStatus(next as EndpointStatus | typeof ALL)
          }
        >
          <SelectTrigger aria-label="Status filter" className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {ENDPOINT_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {STATUS_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <CreateEndpointDialog
            projectId={projectId}
            trigger={
              <Button>
                <PlusIcon />
                New endpoint
              </Button>
            }
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No endpoints match the filters.
        </p>
      ) : (
        <ul aria-label="Endpoints" className="divide-y rounded-xl border">
          {visible.map((endpoint) => (
            <li key={endpoint.id}>
              <Link
                to="/projects/$projectId/endpoints/$endpointId"
                params={{ projectId, endpointId: endpoint.id }}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
              >
                <MethodBadge method={endpoint.method} />
                <span className="truncate font-mono text-sm">
                  {endpoint.path}
                </span>
                <span className="truncate text-sm text-muted-foreground">
                  {endpoint.summary}
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-2">
                  {endpoint.deprecated && (
                    <Badge variant="outline">Deprecated</Badge>
                  )}
                  <StatusLabel status={endpoint.status} />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
