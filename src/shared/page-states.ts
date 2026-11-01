import { z } from "zod";
import type { ApiIssue } from "./api-error";
import {
  type Endpoint,
  type EndpointResponse,
  endpointLabel,
} from "./endpoints";
import { type ErrorTypeFields, responseForStatus } from "./error-types";
import type { JsonValue } from "./json-schema";
import type { PageEndpointLink } from "./pages";

// A page's UI states: what the page shows, and the calls and responses that
// lead to each. They point at the page's links (its calls) and at responses,
// examples, and error types by ID, so renames are followed; the server keeps
// every reference resolvable.

/**
 * The request lifecycle frontends model (TanStack Query, Redux: idle,
 * loading, success, error), plus the designer's empty state.
 */
export const PAGE_STATE_KINDS = [
  "idle",
  "loading",
  "success",
  "empty",
  "error",
] as const;
export type PageStateKind = (typeof PAGE_STATE_KINDS)[number];

export const PAGE_STATE_KIND_LABELS: Record<PageStateKind, string> = {
  idle: "Idle",
  loading: "Loading",
  success: "Success",
  empty: "Empty",
  error: "Error",
};

export const PAGE_STATE_KIND_HINTS: Record<PageStateKind, string> = {
  idle: "Waiting for the user, like a form before it's sent",
  loading: "While a call runs",
  success: "A call worked, and the page shows what it answered",
  empty: "A call worked, but there's nothing to show",
  error: "An error response, or no response at all",
};

const idSchema = z.string().min(1).max(64);

export const MAX_PAGE_STATES = 30;
export const MAX_STATE_CAUSES = 20;
export const MAX_STATE_MOCKUPS = 20;

export const stateCauseSchema = z.discriminatedUnion("type", [
  /** The call itself, while it runs. */
  z.object({ type: z.literal("request"), linkId: idSchema }),
  /** A response without error types, or one of its body's named examples. */
  z.object({
    type: z.literal("response"),
    linkId: idSchema,
    responseId: idSchema,
    exampleId: idSchema.nullable(),
  }),
  /**
   * An error type the call answers with: its catalog example, or one of the
   * endpoint's own examples of it. The response is the one that holds it.
   */
  z.object({
    type: z.literal("error"),
    linkId: idSchema,
    errorTypeId: idSchema,
    exampleId: idSchema.nullable(),
  }),
]);

export const pageStateSchema = z.object({
  /** Client-generated; unique within the page. */
  id: idSchema,
  kind: z.enum(PAGE_STATE_KINDS),
  name: z.string().trim().min(1, "Name is required").max(100),
  /** What the user sees and can do, in Markdown. */
  description: z.string().trim().max(2000),
  /** What leads to the state; empty for, say, a network error. */
  causes: z
    .array(stateCauseSchema)
    .max(MAX_STATE_CAUSES, `A state has at most ${MAX_STATE_CAUSES} causes`),
  /** The page's mockups that show it. */
  mockupIds: z
    .array(idSchema)
    .max(
      MAX_STATE_MOCKUPS,
      `A state shows at most ${MAX_STATE_MOCKUPS} mockups`,
    ),
});

export const pageStatesSchema = z
  .array(pageStateSchema)
  .max(MAX_PAGE_STATES, `A page has at most ${MAX_PAGE_STATES} states`);

export type StateCause = z.infer<typeof stateCauseSchema>;
export type PageState = z.infer<typeof pageStateSchema>;

/** Rules within the page: unique IDs and names, causes that fit the kind and come from the page's calls. */
export function addPageStateIssues(
  ctx: z.RefinementCtx,
  page: { endpoints: PageEndpointLink[]; states: PageState[] },
) {
  const linkIds = new Set(page.endpoints.map((link) => link.id));
  const ids = new Set<string>();
  const names = new Set<string>();
  const issue = (path: (string | number)[], message: string) =>
    ctx.addIssue({ code: "custom", path, message });

  page.states.forEach((state, index) => {
    const path = ["states", index];
    if (ids.has(state.id)) {
      issue([...path, "id"], "Another state has this ID");
    }
    ids.add(state.id);
    const name = state.name.toLowerCase();
    if (names.has(name)) {
      issue([...path, "name"], "Another state has this name");
    }
    names.add(name);
    if (new Set(state.mockupIds).size !== state.mockupIds.length) {
      issue([...path, "mockupIds"], "A mockup is listed twice");
    }
    if (state.kind === "idle" && state.causes.length > 0) {
      issue(
        [...path, "causes"],
        "An idle state comes before any call, so nothing leads to it",
      );
    }

    const seen = new Set<string>();
    state.causes.forEach((cause, causeIndex) => {
      const causePath = [...path, "causes", causeIndex];
      const key = JSON.stringify(cause);
      if (seen.has(key)) {
        issue(causePath, "Already listed");
        return;
      }
      seen.add(key);
      if (!linkIds.has(cause.linkId)) {
        issue(causePath, "This page doesn't make this call anymore");
      } else if (
        cause.type === "request" &&
        state.kind !== "loading" &&
        state.kind !== "idle"
      ) {
        issue(causePath, "Only a loading state waits for a call to finish");
      }
    });
  });
}

// --- Resolving causes ---------------------------------------------------------

type CauseEndpoint = Pick<Endpoint, "id" | "method" | "path" | "responses">;

type CauseErrorType = Pick<ErrorTypeFields, "name" | "status"> & {
  id: string;
  body: { contentType: string; example: JsonValue };
};

/** Headers that make Prism's mock server answer with what a cause names. */
export type PrismHeaders = {
  /** Preferences separated by commas (RFC 7240); Prism reads `;` as a parameter. */
  prefer: string;
  /** The content type to ask for, when it isn't JSON. */
  accept: string | null;
};

export type ResolvedCause<E extends CauseEndpoint = CauseEndpoint> = {
  link: PageEndpointLink;
  endpoint: E;
  /** The response; none for a call that's still running. */
  response?: EndpointResponse;
  errorType?: CauseErrorType;
  /** The example the cause names, or the one Prism is asked for. */
  example?: { name: string; value: JsonValue };
  /** Null for a running call (Prism answers at once), or a response no code reaches. */
  mock: PrismHeaders | null;
};

/**
 * Codes Prism can be asked for to reach a range or default response, most
 * usual first. Left out: 401, 407, 408, and 429, which frontends handle on
 * their own (refreshing a token, retrying), and codes without a body.
 */
const PRISM_CODES: Record<string, number[]> = {
  "2": [200, 201, 202, 203],
  "4": [
    400, 422, 404, 409, 403, 410, 412, 413, 415, 405, 406, 411, 414, 416, 417,
    421, 426, 428, 431,
  ],
  "5": [500, 502, 503, 504, 501, 505],
};

/** A three-digit code Prism maps to `response`, as OpenAPI does: exact, then range, then default. */
function prismCode(response: EndpointResponse, responses: EndpointResponse[]) {
  const { status } = response;
  if (/^\d{3}$/.test(status)) {
    return Number(status);
  }
  const candidates =
    status === "default"
      ? [...PRISM_CODES["5"], ...PRISM_CODES["4"], ...PRISM_CODES["2"]]
      : (PRISM_CODES[status[0] ?? ""] ?? []);
  return (
    candidates.find(
      (code) => responseForStatus(responses, String(code)) === response,
    ) ?? null
  );
}

/** Prism only finds an example in the content type it negotiates. */
function acceptFor(contentType: string | undefined) {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  return !mediaType || mediaType === "application/json" ? null : mediaType;
}

function prismHeaders(code: number | null, exampleName?: string) {
  if (code === null) {
    return null;
  }
  return exampleName ? `code=${code}, example=${exampleName}` : `code=${code}`;
}

/** What a cause points at in the page's calls, or why it can't be found. */
export function resolveCause<E extends CauseEndpoint>(
  cause: StateCause,
  links: PageEndpointLink[],
  endpointsById: ReadonlyMap<string, E>,
  errorTypesById: ReadonlyMap<string, CauseErrorType>,
): ResolvedCause<E> | { error: string } {
  const link = links.find((item) => item.id === cause.linkId);
  const endpoint = link && endpointsById.get(link.endpointId);
  if (!link || !endpoint) {
    return { error: "This page doesn't make this call anymore" };
  }
  const label = endpointLabel(endpoint);

  if (cause.type === "request") {
    return { link, endpoint, mock: null };
  }

  if (cause.type === "response") {
    const response = endpoint.responses.find(
      (item) => item.id === cause.responseId,
    );
    if (!response) {
      return { error: `${label} has no such response anymore` };
    }
    if (response.errors.length > 0) {
      return {
        error: `The ${response.status} response answers with error types; pick one of them`,
      };
    }
    if (/^[13]/.test(response.status)) {
      return {
        error: `A page never sees a ${response.status} response: the browser handles it`,
      };
    }
    let example: ResolvedCause<E>["example"];
    if (cause.exampleId !== null) {
      const found = response.body?.examples.find(
        (item) => item.id === cause.exampleId,
      );
      if (!found) {
        return {
          error: `The ${response.status} response of ${label} has no such example anymore`,
        };
      }
      example = { name: found.name, value: found.value as JsonValue };
    }
    const prefer = prismHeaders(
      prismCode(response, endpoint.responses),
      example?.name,
    );
    return {
      link,
      endpoint,
      response,
      ...(example ? { example } : {}),
      mock: prefer
        ? { prefer, accept: acceptFor(response.body?.contentType) }
        : null,
    };
  }

  const errorType = errorTypesById.get(cause.errorTypeId);
  const response = endpoint.responses.find((item) =>
    item.errors.some((usage) => usage.errorTypeId === cause.errorTypeId),
  );
  const usage = response?.errors.find(
    (item) => item.errorTypeId === cause.errorTypeId,
  );
  if (!errorType || !response || !usage) {
    return {
      error: `${label} doesn't answer with ${errorType?.name ?? "this error type"}`,
    };
  }
  const own =
    cause.exampleId === null
      ? usage.examples[0]
      : usage.examples.find((item) => item.id === cause.exampleId);
  if (cause.exampleId !== null && !own) {
    return {
      error: `${label} has no such example of ${errorType.name} anymore`,
    };
  }
  const example = own
    ? { name: own.name, value: own.value as JsonValue }
    : { name: errorType.name, value: errorType.body.example };
  return {
    link,
    endpoint,
    response,
    errorType,
    example,
    mock: {
      prefer: `code=${errorType.status}, example=${example.name}`,
      accept: acceptFor(errorType.body.contentType),
    },
  };
}

/** "200 OK, example empty", "409 item-has-stock", or "while it runs". */
export function causeText(cause: StateCause, resolved: ResolvedCause) {
  if (cause.type === "error" && resolved.errorType) {
    const { errorType, example } = resolved;
    return cause.exampleId !== null && example
      ? `${errorType.status} ${errorType.name}, example ${example.name}`
      : `${errorType.status} ${errorType.name}`;
  }
  if (resolved.response) {
    const { status, description } = resolved.response;
    return resolved.example
      ? `${status} ${description}, example ${resolved.example.name}`
      : `${status} ${description}`;
  }
  return "while it runs";
}

/** The headers as lines to send with a request. */
export function prismHeaderLines(mock: PrismHeaders) {
  return [
    `Prefer: ${mock.prefer}`,
    ...(mock.accept ? [`Accept: ${mock.accept}`] : []),
  ];
}

/**
 * Issues with what a page's states point at: causes that don't resolve
 * against the project's endpoints and error types, and mockups the page
 * doesn't have.
 */
export function checkPageStates(
  page: { endpoints: PageEndpointLink[]; states: PageState[] },
  project: {
    endpointsById: ReadonlyMap<string, CauseEndpoint>;
    errorTypesById: ReadonlyMap<string, CauseErrorType>;
    mockupIds: ReadonlySet<string>;
  },
): ApiIssue[] {
  return page.states.flatMap((state, index) => {
    const issues: ApiIssue[] = state.causes.flatMap((cause, causeIndex) => {
      const resolved = resolveCause(
        cause,
        page.endpoints,
        project.endpointsById,
        project.errorTypesById,
      );
      return "error" in resolved
        ? [
            {
              path: `states.${index}.causes.${causeIndex}`,
              message: resolved.error,
            },
          ]
        : [];
    });
    if (state.mockupIds.some((id) => !project.mockupIds.has(id))) {
      issues.push({
        path: `states.${index}.mockupIds`,
        message: "This page has no such mockup",
      });
    }
    return issues;
  });
}
