import {
  type CreateProjectInput,
  projectSchema,
  projectSummarySchema,
  type UpdateProjectInput,
} from "@shared/projects";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";

export const projectKeys = {
  all: ["projects"] as const,
  list: () => [...projectKeys.all, "list"] as const,
  detail: (id: string) => [...projectKeys.all, "detail", id] as const,
};

function projectPath(id: string) {
  return `/projects/${encodeURIComponent(id)}`;
}

export function projectsQueryOptions() {
  return queryOptions({
    queryKey: projectKeys.list(),
    queryFn: () => apiGet("/projects", projectSummarySchema.array()),
  });
}

export function projectQueryOptions(id: string) {
  return queryOptions({
    queryKey: projectKeys.detail(id),
    queryFn: () => apiGet(projectPath(id), projectSchema),
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      apiPost("/projects", input, projectSchema),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

export function useUpdateProject(id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      apiPatch(projectPath(id), input, projectSchema),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

/**
 * The deleted project's cached details are left in place so the page that is
 * still showing it doesn't refetch; remove them after navigating away.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiDelete(projectPath(id)),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
  });
}
