import {
  type CreateModelInput,
  modelSchema,
  modelSummarySchema,
  type UpdateModelInput,
} from "@shared/models";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { projectKeys } from "../projects/queries";

// Nested under the project's key, so removing a project's cache entries also
// removes its models.
export const modelKeys = {
  all: (projectId: string) =>
    [...projectKeys.detail(projectId), "models"] as const,
  list: (projectId: string) => [...modelKeys.all(projectId), "list"] as const,
  detail: (projectId: string, modelId: string) =>
    [...modelKeys.all(projectId), "detail", modelId] as const,
};

function modelsPath(projectId: string, modelId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/models`;
  return modelId ? `${base}/${encodeURIComponent(modelId)}` : base;
}

export function modelsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: modelKeys.list(projectId),
    queryFn: () => apiGet(modelsPath(projectId), modelSummarySchema.array()),
  });
}

export function modelQueryOptions(projectId: string, modelId: string) {
  return queryOptions({
    queryKey: modelKeys.detail(projectId, modelId),
    queryFn: () => apiGet(modelsPath(projectId, modelId), modelSchema),
  });
}

function useInvalidateLists(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: modelKeys.list(projectId) }),
      // The project's "updated" time changes with its models.
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
    ]);
}

export function useCreateModel(projectId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: CreateModelInput) =>
      apiPost(modelsPath(projectId), input, modelSchema),
    onSuccess: (model) => {
      queryClient.setQueryData(modelKeys.detail(projectId, model.id), model);
      return invalidateLists();
    },
  });
}

export function useUpdateModel(projectId: string, modelId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: UpdateModelInput) =>
      apiPatch(modelsPath(projectId, modelId), input, modelSchema),
    onSuccess: (model) => {
      queryClient.setQueryData(modelKeys.detail(projectId, model.id), model);
      return invalidateLists();
    },
  });
}

/** Like `useDeleteProject`: remove the model's details after navigating away. */
export function useDeleteModel(projectId: string) {
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (modelId: string) => apiDelete(modelsPath(projectId, modelId)),
    onSuccess: invalidateLists,
  });
}
