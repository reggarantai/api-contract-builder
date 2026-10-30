import {
  type CreateEndpointInput,
  endpointResponseFieldsSchema,
  endpointSummarySchema,
  type UpdateEndpointInput,
} from "@shared/endpoints";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api";
import { projectKeys } from "../projects/queries";

// Nested under the project's key, like models.
export const endpointKeys = {
  all: (projectId: string) =>
    [...projectKeys.detail(projectId), "endpoints"] as const,
  list: (projectId: string) =>
    [...endpointKeys.all(projectId), "list"] as const,
  detail: (projectId: string, endpointId: string) =>
    [...endpointKeys.all(projectId), "detail", endpointId] as const,
};

function endpointsPath(projectId: string, endpointId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/endpoints`;
  return endpointId ? `${base}/${encodeURIComponent(endpointId)}` : base;
}

export function endpointsQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: endpointKeys.list(projectId),
    queryFn: () =>
      apiGet(endpointsPath(projectId), endpointSummarySchema.array()),
  });
}

export function endpointQueryOptions(projectId: string, endpointId: string) {
  return queryOptions({
    queryKey: endpointKeys.detail(projectId, endpointId),
    queryFn: () =>
      apiGet(
        endpointsPath(projectId, endpointId),
        endpointResponseFieldsSchema,
      ),
  });
}

function useInvalidateLists(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: endpointKeys.list(projectId) }),
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
    ]);
}

export function useCreateEndpoint(projectId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: CreateEndpointInput) =>
      apiPost(endpointsPath(projectId), input, endpointResponseFieldsSchema),
    onSuccess: (endpoint) => {
      queryClient.setQueryData(
        endpointKeys.detail(projectId, endpoint.id),
        endpoint,
      );
      return invalidateLists();
    },
  });
}

export function useUpdateEndpoint(projectId: string, endpointId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: UpdateEndpointInput) =>
      apiPatch(
        endpointsPath(projectId, endpointId),
        input,
        endpointResponseFieldsSchema,
      ),
    onSuccess: (endpoint) => {
      queryClient.setQueryData(
        endpointKeys.detail(projectId, endpoint.id),
        endpoint,
      );
      return invalidateLists();
    },
  });
}

/** Like `useDeleteProject`: remove the endpoint's details after navigating away. */
export function useDeleteEndpoint(projectId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (endpointId: string) =>
      apiDelete(endpointsPath(projectId, endpointId)),
    onSuccess: () =>
      Promise.all([
        invalidateLists(),
        // Pages drop their links to the deleted endpoint.
        queryClient.invalidateQueries({
          queryKey: [...projectKeys.detail(projectId), "pages"],
        }),
      ]),
  });
}
