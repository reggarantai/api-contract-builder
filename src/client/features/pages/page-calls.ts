import type { Endpoint } from "@shared/endpoints";
import type { ErrorType } from "@shared/error-types";
import {
  causeText,
  type PageStateKind,
  type ResolvedCause,
  resolveCause,
  type StateCause,
} from "@shared/page-states";
import { linkLabel, type PageEndpointLink } from "@shared/pages";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { endpointQueryOptions } from "../endpoints/queries";
import { errorTypesQueryOptions } from "../error-types/queries";

/** The details states need about a page's calls: their endpoints and the error catalog. */
export function usePageCalls(
  projectId: string,
  endpointIds: string[],
  enabled: boolean,
) {
  const endpoints = useQueries({
    queries: [...new Set(endpointIds)].map((id) => ({
      ...endpointQueryOptions(projectId, id),
      enabled,
    })),
    combine: (results) =>
      results.flatMap((result) => (result.data ? [result.data] : [])),
  });
  const errorTypes = useQuery({
    ...errorTypesQueryOptions(projectId),
    enabled,
  }).data;
  return useMemo(
    () => ({
      endpointsById: new Map<string, Endpoint>(
        endpoints.map((endpoint) => [endpoint.id, endpoint]),
      ),
      errorTypesById: new Map<string, ErrorType>(
        (errorTypes ?? []).map((errorType) => [errorType.id, errorType]),
      ),
    }),
    [endpoints, errorTypes],
  );
}

export type PageCalls = ReturnType<typeof usePageCalls>;

/** A stable key for a cause, as a select value. */
export function causeKey(cause: StateCause) {
  return JSON.stringify([
    cause.type,
    cause.linkId,
    cause.type === "response"
      ? cause.responseId
      : cause.type === "error"
        ? cause.errorTypeId
        : null,
    cause.type === "request" ? null : cause.exampleId,
  ]);
}

/** "GET /items — 200 OK, example empty" */
export function causeLabel(
  cause: StateCause,
  resolved: ResolvedCause,
  links: PageEndpointLink[],
) {
  return `${linkLabel(resolved.link, resolved.endpoint, links)} — ${causeText(cause, resolved)}`;
}

export type CauseChoice = {
  cause: StateCause;
  key: string;
  label: string;
};

/**
 * Everything that can lead to a state of a page, call by call: the call
 * itself (for loading states), each response without error types and its
 * body's examples, and each error type with the endpoint's own examples.
 */
export function causeChoices(
  links: PageEndpointLink[],
  { endpointsById, errorTypesById }: PageCalls,
): CauseChoice[] {
  return links.flatMap((link) => {
    const endpoint = endpointsById.get(link.endpointId);
    if (!endpoint) {
      return [];
    }
    const candidates: StateCause[] = [
      { type: "request", linkId: link.id },
      ...endpoint.responses.flatMap((response): StateCause[] =>
        response.errors.length > 0
          ? response.errors.flatMap((usage) => [
              {
                type: "error",
                linkId: link.id,
                errorTypeId: usage.errorTypeId,
                exampleId: null,
              },
              ...usage.examples.map(
                (example): StateCause => ({
                  type: "error",
                  linkId: link.id,
                  errorTypeId: usage.errorTypeId,
                  exampleId: example.id,
                }),
              ),
            ])
          : [
              {
                type: "response",
                linkId: link.id,
                responseId: response.id,
                exampleId: null,
              },
              ...(response.body?.examples ?? []).map(
                (example): StateCause => ({
                  type: "response",
                  linkId: link.id,
                  responseId: response.id,
                  exampleId: example.id,
                }),
              ),
            ],
      ),
    ];
    return candidates.flatMap((cause) => {
      const resolved = resolveCause(
        cause,
        links,
        endpointsById,
        errorTypesById,
      );
      return "error" in resolved
        ? []
        : [
            {
              cause,
              key: causeKey(cause),
              label: causeLabel(cause, resolved, links),
            },
          ];
    });
  });
}

/** Whether a state of this kind can have the cause: only loading states wait for a call. */
export function fitsKind(kind: PageStateKind, cause: StateCause) {
  if (kind === "idle") {
    return false;
  }
  return cause.type !== "request" || kind === "loading";
}
