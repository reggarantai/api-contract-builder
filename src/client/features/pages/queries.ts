import {
  type CreatePageInput,
  type Mockup,
  mockupSchema,
  type Page,
  pageSchema,
  pageSummarySchema,
  type UpdatePageInput,
} from "@shared/pages";
import {
  queryOptions,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  apiUpload,
} from "@/lib/api";
import { endpointKeys } from "../endpoints/queries";
import { projectKeys } from "../projects/queries";

export const pageKeys = {
  all: (projectId: string) =>
    [...projectKeys.detail(projectId), "pages"] as const,
  list: (projectId: string) => [...pageKeys.all(projectId), "list"] as const,
  detail: (projectId: string, pageId: string) =>
    [...pageKeys.all(projectId), "detail", pageId] as const,
};

function pagesPath(projectId: string, pageId?: string) {
  const base = `/projects/${encodeURIComponent(projectId)}/pages`;
  return pageId ? `${base}/${encodeURIComponent(pageId)}` : base;
}

function mockupsPath(projectId: string, pageId: string, mockupId?: string) {
  const base = `${pagesPath(projectId, pageId)}/mockups`;
  return mockupId ? `${base}/${encodeURIComponent(mockupId)}` : base;
}

export function pagesQueryOptions(projectId: string) {
  return queryOptions({
    queryKey: pageKeys.list(projectId),
    queryFn: () => apiGet(pagesPath(projectId), pageSummarySchema.array()),
  });
}

export function pageQueryOptions(projectId: string, pageId: string) {
  return queryOptions({
    queryKey: pageKeys.detail(projectId, pageId),
    queryFn: () => apiGet(pagesPath(projectId, pageId), pageSchema),
  });
}

/** Refreshes what a page change affects: page and project lists, and endpoint pages. */
function useInvalidateLists(projectId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: pageKeys.list(projectId) }),
      queryClient.invalidateQueries({ queryKey: endpointKeys.list(projectId) }),
      queryClient.invalidateQueries({ queryKey: projectKeys.list() }),
    ]);
}

export function useCreatePage(projectId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: CreatePageInput) =>
      apiPost(pagesPath(projectId), input, pageSchema),
    onSuccess: (page) => {
      queryClient.setQueryData(pageKeys.detail(projectId, page.id), page);
      return invalidateLists();
    },
  });
}

export function useUpdatePage(projectId: string, pageId: string) {
  const queryClient = useQueryClient();
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (input: UpdatePageInput) =>
      apiPatch(pagesPath(projectId, pageId), input, pageSchema),
    onSuccess: (page) => {
      queryClient.setQueryData(pageKeys.detail(projectId, page.id), page);
      return invalidateLists();
    },
  });
}

/** Like `useDeleteProject`: remove the page's details after navigating away. */
export function useDeletePage(projectId: string) {
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (pageId: string) => apiDelete(pagesPath(projectId, pageId)),
    onSuccess: invalidateLists,
  });
}

/** Saves a new page order, showing it right away and rolling back on failure. */
export function useReorderPages(projectId: string) {
  const queryClient = useQueryClient();
  const key = pagesQueryOptions(projectId).queryKey;
  return useMutation({
    mutationFn: (pageIds: string[]) =>
      apiPut(
        `${pagesPath(projectId)}/order`,
        { pageIds },
        z.object({ pageIds: z.array(z.string()) }),
      ),
    onMutate: async (pageIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      queryClient.setQueryData(key, (pages) =>
        pages
          ? pageIds.flatMap((id) => pages.filter((page) => page.id === id))
          : pages,
      );
      return { previous };
    },
    onError: (_error, _pageIds, context) =>
      queryClient.setQueryData(key, context?.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
}

// --- Mockups (saved right away, outside the page form) ------------------------

function useSetMockups(projectId: string, pageId: string) {
  const queryClient = useQueryClient();
  return (update: (mockups: Mockup[]) => Mockup[]) =>
    queryClient.setQueryData(
      pageKeys.detail(projectId, pageId),
      (page: Page | undefined) =>
        page ? { ...page, mockups: update(page.mockups) } : page,
    );
}

export function useUploadMockups(projectId: string, pageId: string) {
  const setMockups = useSetMockups(projectId, pageId);
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (files: File[]) => {
      const form = new FormData();
      for (const file of files) {
        form.append("files", file);
      }
      return apiUpload(
        mockupsPath(projectId, pageId),
        form,
        mockupSchema.array(),
      );
    },
    onSuccess: (uploaded) => {
      setMockups((mockups) => [...mockups, ...uploaded]);
      return invalidateLists();
    },
  });
}

export function useUpdateMockupCaption(projectId: string, pageId: string) {
  const setMockups = useSetMockups(projectId, pageId);
  return useMutation({
    mutationFn: ({
      mockupId,
      caption,
    }: {
      mockupId: string;
      caption: string;
    }) =>
      apiPatch(
        mockupsPath(projectId, pageId, mockupId),
        { caption },
        mockupSchema,
      ),
    onSuccess: (updated) =>
      setMockups((mockups) =>
        mockups.map((mockup) => (mockup.id === updated.id ? updated : mockup)),
      ),
  });
}

export function useReorderMockups(projectId: string, pageId: string) {
  const queryClient = useQueryClient();
  const key = pageQueryOptions(projectId, pageId).queryKey;
  const setMockups = useSetMockups(projectId, pageId);
  return useMutation({
    mutationFn: (mockupIds: string[]) =>
      apiPut(
        `${mockupsPath(projectId, pageId)}/order`,
        { mockupIds },
        z.object({ mockupIds: z.array(z.string()) }),
      ),
    onMutate: async (mockupIds) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData(key);
      setMockups((mockups) =>
        mockupIds.flatMap((id) => mockups.filter((mockup) => mockup.id === id)),
      );
      return { previous };
    },
    onError: (_error, _mockupIds, context) =>
      queryClient.setQueryData(key, context?.previous),
  });
}

export function useDeleteMockup(projectId: string, pageId: string) {
  const setMockups = useSetMockups(projectId, pageId);
  const invalidateLists = useInvalidateLists(projectId);
  return useMutation({
    mutationFn: (mockupId: string) =>
      apiDelete(mockupsPath(projectId, pageId, mockupId)),
    onSuccess: (_result, mockupId) => {
      setMockups((mockups) =>
        mockups.filter((mockup) => mockup.id !== mockupId),
      );
      return invalidateLists();
    },
  });
}
