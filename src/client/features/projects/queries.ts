import { projectImportResultSchema } from "@shared/project-file";
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
import { apiDelete, apiGet, apiPatch, apiPost, apiPostFile } from "@/lib/api";

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
      // Lists refresh in the background: the editor resets from the saved
      // item, and doesn't wait for them.
      void queryClient.invalidateQueries({ queryKey: projectKeys.list() });
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

/** Creates the sample project (Login, Registration, Stock list, Create schedule). */
export function useCreateSampleProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => apiPost("/samples", undefined, projectSchema),
    onSuccess: (project) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}

/** Running imports share this key, so any button can tell one is running. */
export const importProjectKey = [...projectKeys.all, "import"] as const;

/** Imports a project file (.project.zip) as a new project. */
export function useImportProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: importProjectKey,
    mutationFn: (file: File) =>
      apiPostFile(
        "/projects/import",
        file,
        "application/zip",
        projectImportResultSchema,
      ),
    onSuccess: ({ project }) => {
      queryClient.setQueryData(projectKeys.detail(project.id), project);
      return queryClient.invalidateQueries({ queryKey: projectKeys.list() });
    },
  });
}
