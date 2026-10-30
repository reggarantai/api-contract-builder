import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { projectsQueryOptions } from "./queries";

/** Header menu for jumping between projects. */
export function ProjectSwitcher({ projectId }: { projectId: string }) {
  const projects = useQuery(projectsQueryOptions());
  const current = projects.data?.find((project) => project.id === projectId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="max-w-64 gap-1.5 px-2">
          <span className="truncate">{current?.name ?? "Projects"}</span>
          <ChevronsUpDownIcon className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {projects.data?.map((project) => (
          <DropdownMenuItem key={project.id} asChild>
            <Link to="/projects/$projectId" params={{ projectId: project.id }}>
              <span className="truncate">{project.name}</span>
              {project.id === projectId && <CheckIcon className="ml-auto" />}
            </Link>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link to="/">All projects</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
