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
      // Error types list the endpoints that use them.
      queryClient.invalidateQueries({
        queryKey: [...projectKeys.detail(projectId), "error-types"],
      }),
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

/**
 * Saves an endpoint. With `detachStates`, page states that come from what the
 * change removes lose those causes instead of refusing the save.
 */
export function useUpdateEndpoint(projectId: string, endpointId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: ({
      input,
      detachStates = false,
    }: {
      input: UpdateEndpointInput;
      detachStates?: boolean;
    }) =>
      apiPatch(
        `${endpointsPath(projectId, endpointId)}${detachStates ? "?detachStates=true" : ""}`,
        input,
        endpointResponseFieldsSchema,
      ),
    onSuccess: (endpoint, { detachStates }) => {
      queryClient.setQueryData(
        endpointKeys.detail(projectId, endpoint.id),
        endpoint,
      );
      // Lists refresh in the background: the editor resets from the saved
      // item, and doesn't wait for them.
      void invalidateLists();
      if (detachStates) {
        void queryClient.invalidateQueries({
          queryKey: [...projectKeys.detail(projectId), "pages"],
        });
      }
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
        // Pages drop their links to the deleted endpoint, and their states
        // what came from them.
        queryClient.invalidateQueries({
          queryKey: [...projectKeys.detail(projectId), "pages"],
        }),
      ]),
  });
}
