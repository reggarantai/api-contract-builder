import {
  type CreateErrorTypeInput,
  errorTypeSchema,
  type UpdateErrorTypeInput,
} from "@shared/error-types";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { projectKeys } from "../projects/queries";

// Nested under the project's key, like models.
export const errorTypeKeys = {
  all: (projectId: string) =>
    [...projectKeys.detail(projectId), "error-types"] as const,
  list: (projectId: string) =>
    [...errorTypeKeys.all(projectId), "list"] as const,
  detail: (projectId: string, errorTypeId: string) =>
    [...errorTypeKeys.all(projectId), "detail", errorTypeId] as const,
};

function errorTypesPath(projectId: string, errorTypeId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/error-types`;
  return errorTypeId ? `${base}/${encodeURIComponent(errorTypeId)}` : base;
}

/** The whole catalog, by status and name; error types are small. */
export function errorTypesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: errorTypeKeys.list(projectId),
    queryFn: () => apiGet(errorTypesPath(projectId), errorTypeSchema.array()),
  });
}

export function errorTypeQueryOptions(projectId: string, errorTypeId: string) {
  return queryOptions({
    queryKey: errorTypeKeys.detail(projectId, errorTypeId),
    queryFn: () =>
      apiGet(errorTypesPath(projectId, errorTypeId), errorTypeSchema),
  });
}

function useInvalidateLists(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: errorTypeKeys.list(projectId),
      }),
      // The project's "updated" time changes with its error types.
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
    ]);
}

export function useCreateErrorType(projectId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: CreateErrorTypeInput) =>
      apiPost(errorTypesPath(projectId), input, errorTypeSchema),
    onSuccess: (errorType) => {
      queryClient.setQueryData(
        errorTypeKeys.detail(projectId, errorType.id),
        errorType,
      );
      return invalidateLists();
    },
  });
}

export function useUpdateErrorType(projectId: string, errorTypeId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: UpdateErrorTypeInput) =>
      apiPatch(errorTypesPath(projectId, errorTypeId), input, errorTypeSchema),
    onSuccess: (errorType) => {
      queryClient.setQueryData(
        errorTypeKeys.detail(projectId, errorType.id),
        errorType,
      );
      return invalidateLists();
    },
  });
}

/** Like `useDeleteModel`: remove the error type's details after navigating away. */
export function useDeleteErrorType(projectId: string) {
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (errorTypeId: string) =>
      apiDelete(errorTypesPath(projectId, errorTypeId)),
    onSuccess: invalidateLists,
  });
}
