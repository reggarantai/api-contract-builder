import { describe, expect, it } from "vitest";
import {
  createEndpointDefaults,
  type Endpoint,
  type EndpointResponse,
} from "./endpoints";
import {
  checkPageStates,
  type PageState,
  resolveCause,
  type StateCause,
} from "./page-states";
import {
  type PageEndpointLink,
  type PageFields,
  pageFieldsSchema,
} from "./pages";

const NO_HEADERS = { type: "object", properties: {} };
const PROBLEMS = "https://api.example.com/problems/";

function errorType(id: string, name: string, status: string) {
  return {
    id,
    name,
    status,
    body: {
      contentType: "application/problem+json",
      example: { type: `${PROBLEMS}${name}`, status: Number(status) },
    },
  };
}

const catalog = [
  errorType("et-params", "invalid-parameters", "400"),
  errorType("et-missing", "not-found", "404"),
  errorType("et-stock", "item-has-stock", "409"),
  errorType("et-progress", "request-in-progress", "409"),
  errorType("et-invalid", "validation-failed", "422"),
  errorType("et-down", "maintenance", "503"),
];
const errorTypesById = new Map(catalog.map((entry) => [entry.id, entry]));

function response(
  id: string,
  status: string,
  changes: Partial<EndpointResponse> = {},
): EndpointResponse {
  return {
    id,
    status,
    description: status,
    headers: NO_HEADERS,
    body: null,
    errors: [],
    ...changes,
  };
}

function jsonBody(names: string[], contentType = "application/json") {
  return {
    contentType,
    schema: { type: "object" },
    examples: names.map((name) => ({
      id: `x-${name}`,
      name,
      summary: "",
      value: { example: name },
    })),
  };
}

function endpoint(
  id: string,
  method: "GET" | "DELETE",
  path: string,
  responses: EndpointResponse[],
): Endpoint {
  return {
    ...createEndpointDefaults(method, path),
    responses,
    id,
    projectId: "p1",
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const listItems = endpoint("e-list", "GET", "/items", [
  response("r200", "200", { body: jsonBody(["first-page", "empty"]) }),
  response("r400", "400", {
    errors: [{ errorTypeId: "et-params", examples: [] }],
  }),
  response("r304", "304"),
]);
const deleteItem = endpoint("e-delete", "DELETE", "/items/{id}", [
  response("r204", "204"),
  response("r409", "409", {
    errors: [
      { errorTypeId: "et-stock", examples: [] },
      { errorTypeId: "et-progress", examples: [] },
    ],
  }),
  response("r422", "422", {
    errors: [
      {
        errorTypeId: "et-invalid",
        examples: [
          { id: "o-bad", name: "bad-id", summary: "", value: { bad: true } },
          { id: "o-gone", name: "gone-id", summary: "", value: { gone: true } },
        ],
      },
    ],
  }),
]);
const links: PageEndpointLink[] = [
  { id: "l-list", endpointId: "e-list", trigger: "on_load", note: "" },
  { id: "l-delete", endpointId: "e-delete", trigger: "on_action", note: "" },
];

function resolve(
  cause: StateCause,
  endpoints: Endpoint[] = [listItems, deleteItem],
) {
  return resolveCause(
    cause,
    links,
    new Map(endpoints.map((item) => [item.id, item])),
    errorTypesById,
  );
}

/** The headers that make Prism answer with what a cause names. */
function mockOf(cause: StateCause, endpoints?: Endpoint[]) {
  const resolved = resolve(cause, endpoints);
  if ("error" in resolved) {
    throw new Error(resolved.error);
  }
  return resolved.mock;
}

function errorOf(cause: StateCause, endpoints?: Endpoint[]) {
  const resolved = resolve(cause, endpoints);
  return "error" in resolved ? resolved.error : undefined;
}

describe("resolveCause", () => {
  it("names a body example with the response's code and the example", () => {
    const resolved = resolve({
      type: "response",
      linkId: "l-list",
      responseId: "r200",
      exampleId: "x-empty",
    });

    expect(resolved).toMatchObject({
      link: { id: "l-list" },
      endpoint: { id: "e-list" },
      response: { id: "r200" },
      example: { name: "empty", value: { example: "empty" } },
      mock: { prefer: "code=200, example=empty", accept: null },
    });
  });

  it("asks only for the code when the cause is the whole response", () => {
    expect(
      mockOf({
        type: "response",
        linkId: "l-list",
        responseId: "r200",
        exampleId: null,
      }),
    ).toEqual({ prefer: "code=200", accept: null });
    expect(
      mockOf({
        type: "response",
        linkId: "l-delete",
        responseId: "r204",
        exampleId: null,
      }),
    ).toEqual({ prefer: "code=204", accept: null });
  });

  it("names a catalog error by its name, with its content type", () => {
    const resolved = resolve({
      type: "error",
      linkId: "l-delete",
      errorTypeId: "et-stock",
      exampleId: null,
    });

    expect(resolved).toMatchObject({
      response: { id: "r409" },
      errorType: { name: "item-has-stock" },
      example: { name: "item-has-stock", value: { status: 409 } },
      mock: {
        prefer: "code=409, example=item-has-stock",
        accept: "application/problem+json",
      },
    });
  });

  it("names an endpoint's own example of an error, or its first one", () => {
    expect(
      mockOf({
        type: "error",
        linkId: "l-delete",
        errorTypeId: "et-invalid",
        exampleId: "o-gone",
      }),
    ).toMatchObject({ prefer: "code=422, example=gone-id" });
    expect(
      mockOf({
        type: "error",
        linkId: "l-delete",
        errorTypeId: "et-invalid",
        exampleId: null,
      }),
    ).toMatchObject({ prefer: "code=422, example=bad-id" });
  });

  it("asks for an error's own status when a range or default response holds it", () => {
    const ranged = endpoint("e-list", "GET", "/items", [
      response("r200", "200", { body: jsonBody(["first-page"]) }),
      response("r4xx", "4XX", {
        errors: [
          { errorTypeId: "et-missing", examples: [] },
          { errorTypeId: "et-stock", examples: [] },
        ],
      }),
      response("rdefault", "default", {
        errors: [{ errorTypeId: "et-down", examples: [] }],
      }),
    ]);
    const error = (errorTypeId: string): StateCause => ({
      type: "error",
      linkId: "l-list",
      errorTypeId,
      exampleId: null,
    });

    expect(mockOf(error("et-stock"), [ranged])?.prefer).toBe(
      "code=409, example=item-has-stock",
    );
    expect(mockOf(error("et-down"), [ranged])?.prefer).toBe(
      "code=503, example=maintenance",
    );
  });

  it("picks a code a range response answers, skipping ones clients handle on their own", () => {
    const ranged = (responses: EndpointResponse[]) => [
      endpoint("e-list", "GET", "/items", [
        response("r200", "200", { body: jsonBody(["first-page"]) }),
        ...responses,
      ]),
    ];
    const whole = (responseId: string): StateCause => ({
      type: "response",
      linkId: "l-list",
      responseId,
      exampleId: null,
    });
    const body = { body: jsonBody(["oops"]) };

    expect(
      mockOf(whole("r4xx"), ranged([response("r4xx", "4XX", body)])),
    ).toEqual({ prefer: "code=400", accept: null });
    // 400 has its own response, and 401 would make a frontend refresh its token.
    expect(
      mockOf(
        whole("r4xx"),
        ranged([response("r400", "400", body), response("r4xx", "4XX", body)]),
      )?.prefer,
    ).toBe("code=422");
    expect(
      mockOf(whole("r5xx"), ranged([response("r5xx", "5XX", body)]))?.prefer,
    ).toBe("code=500");
  });

  it("picks a code only the default response answers, or none when there's no such code", () => {
    const body = { body: jsonBody(["unexpected"]) };
    const whole: StateCause = {
      type: "response",
      linkId: "l-list",
      responseId: "rdefault",
      exampleId: "x-unexpected",
    };

    expect(
      mockOf(whole, [
        endpoint("e-list", "GET", "/items", [
          response("r200", "200", { body: jsonBody(["first-page"]) }),
          response("r500", "500", body),
          response("rdefault", "default", body),
        ]),
      ])?.prefer,
    ).toBe("code=502, example=unexpected");
    expect(
      mockOf(whole, [
        endpoint("e-list", "GET", "/items", [
          response("r2xx", "2XX", { body: jsonBody(["first-page"]) }),
          response("r4xx", "4XX", body),
          response("r5xx", "5XX", body),
          response("rdefault", "default", body),
        ]),
      ]),
    ).toBeNull();
  });

  it("asks for the content type unless it's JSON", () => {
    const withBody = (contentType: string) => [
      endpoint("e-list", "GET", "/items", [
        response("r200", "200", { body: jsonBody(["rows"], contentType) }),
      ]),
    ];
    const cause: StateCause = {
      type: "response",
      linkId: "l-list",
      responseId: "r200",
      exampleId: "x-rows",
    };

    expect(mockOf(cause, withBody("application/json; charset=utf-8"))).toEqual({
      prefer: "code=200, example=rows",
      accept: null,
    });
    expect(mockOf(cause, withBody("text/csv"))?.accept).toBe("text/csv");
  });

  it("has no Prism header for a call that's still running", () => {
    const resolved = resolve({ type: "request", linkId: "l-list" });

    expect(resolved).toMatchObject({
      link: { id: "l-list" },
      endpoint: { id: "e-list" },
      mock: null,
    });
    expect(resolved).not.toHaveProperty("response");
  });

  it("says what's missing when a cause points at something that's gone", () => {
    expect(errorOf({ type: "request", linkId: "l-gone" })).toBe(
      "This page doesn't make this call anymore",
    );
    expect(
      errorOf({
        type: "response",
        linkId: "l-list",
        responseId: "r-gone",
        exampleId: null,
      }),
    ).toBe("GET /items has no such response anymore");
    expect(
      errorOf({
        type: "response",
        linkId: "l-list",
        responseId: "r200",
        exampleId: "x-gone",
      }),
    ).toBe("The 200 response of GET /items has no such example anymore");
    expect(
      errorOf({
        type: "error",
        linkId: "l-list",
        errorTypeId: "et-stock",
        exampleId: null,
      }),
    ).toBe("GET /items doesn't answer with item-has-stock");
    expect(
      errorOf({
        type: "error",
        linkId: "l-delete",
        errorTypeId: "et-invalid",
        exampleId: "o-gone-too",
      }),
    ).toBe(
      "DELETE /items/{id} has no such example of validation-failed anymore",
    );
  });

  it("leaves responses with error types to their error types", () => {
    expect(
      errorOf({
        type: "response",
        linkId: "l-delete",
        responseId: "r409",
        exampleId: null,
      }),
    ).toBe("The 409 response answers with error types; pick one of them");
  });

  it("refuses 1xx and 3xx responses, which a page never sees", () => {
    expect(
      errorOf({
        type: "response",
        linkId: "l-list",
        responseId: "r304",
        exampleId: null,
      }),
    ).toBe("A page never sees a 304 response: the browser handles it");
  });
});

describe("page states in pageFieldsSchema", () => {
  const base: PageFields = {
    name: "Stock list",
    slug: "stock-list",
    description: "",
    acceptanceCriteria: "",
    endpoints: links,
    states: [],
  };
  function state(changes: Partial<PageState>): PageState {
    return {
      id: "s1",
      kind: "success",
      name: "Items",
      description: "",
      causes: [],
      mockupIds: [],
      ...changes,
    };
  }
  const items: StateCause = {
    type: "response",
    linkId: "l-list",
    responseId: "r200",
    exampleId: "x-first-page",
  };

  function issues(states: PageState[]) {
    const result = pageFieldsSchema.safeParse({ ...base, states });
    return result.success
      ? []
      : result.error.issues.map(
          (issue) => `${issue.path.join(".")}: ${issue.message}`,
        );
  }

  it("accepts states of every kind with what leads to them", () => {
    expect(
      issues([
        state({ id: "s1", kind: "idle", name: "Filters" }),
        state({
          id: "s2",
          kind: "loading",
          name: "Loading items",
          causes: [{ type: "request", linkId: "l-list" }],
        }),
        state({ id: "s3", kind: "success", name: "Items", causes: [items] }),
        state({
          id: "s4",
          kind: "empty",
          name: "No items",
          causes: [{ ...items, exampleId: "x-empty" }],
          mockupIds: ["m1"],
        }),
        state({
          id: "s5",
          kind: "error",
          name: "Can't delete",
          causes: [
            {
              type: "error",
              linkId: "l-delete",
              errorTypeId: "et-stock",
              exampleId: null,
            },
          ],
        }),
        // A request still running when the API answers that it is.
        state({
          id: "s6",
          kind: "loading",
          name: "Still deleting",
          causes: [
            {
              type: "error",
              linkId: "l-delete",
              errorTypeId: "et-progress",
              exampleId: null,
            },
          ],
        }),
        state({ id: "s7", kind: "error", name: "Offline" }),
      ]),
    ).toEqual([]);
  });

  it("gives idle states no causes, and only loading states a running call", () => {
    expect(
      issues([
        state({ id: "s1", kind: "idle", name: "Form", causes: [items] }),
        state({
          id: "s2",
          kind: "error",
          name: "Failed",
          causes: [{ type: "request", linkId: "l-list" }],
        }),
      ]),
    ).toEqual([
      "states.0.causes: An idle state comes before any call, so nothing leads to it",
      "states.1.causes.0: Only a loading state waits for a call to finish",
    ]);
  });

  it("takes causes only from calls the page makes, each once", () => {
    expect(
      issues([
        state({
          causes: [items, items, { type: "request", linkId: "l-gone" }],
          kind: "loading",
        }),
      ]),
    ).toEqual([
      "states.0.causes.1: Already listed",
      "states.0.causes.2: This page doesn't make this call anymore",
    ]);
  });

  it("needs unique names, ignoring case, and unique IDs and mockups", () => {
    expect(
      issues([
        state({ id: "s1", name: "Items" }),
        state({ id: "s1", name: "items", mockupIds: ["m1", "m1"] }),
      ]),
    ).toEqual([
      "states.1.id: Another state has this ID",
      "states.1.name: Another state has this name",
      "states.1.mockupIds: A mockup is listed twice",
    ]);
  });

  it("requires a name and keeps to the limits", () => {
    expect(issues([state({ name: " " })])).toEqual([
      "states.0.name: Name is required",
    ]);
    expect(
      issues(
        Array.from({ length: 31 }, (_, index) =>
          state({ id: `s${index}`, name: `State ${index}` }),
        ),
      ),
    ).toEqual(["states: A page has at most 30 states"]);
    expect(
      issues([
        state({
          mockupIds: Array.from({ length: 21 }, (_, index) => `m${index}`),
        }),
      ]),
    ).toEqual(["states.0.mockupIds: A state shows at most 20 mockups"]);
  });
});

describe("checkPageStates", () => {
  const endpointsById = new Map(
    [listItems, deleteItem].map((item) => [item.id, item]),
  );

  it("reports causes that don't resolve and mockups the page doesn't have", () => {
    expect(
      checkPageStates(
        {
          endpoints: links,
          states: [
            {
              id: "s1",
              kind: "empty",
              name: "No items",
              description: "",
              causes: [
                {
                  type: "response",
                  linkId: "l-list",
                  responseId: "r200",
                  exampleId: "x-empty",
                },
                {
                  type: "response",
                  linkId: "l-list",
                  responseId: "r200",
                  exampleId: "x-gone",
                },
              ],
              mockupIds: ["m1", "m-gone"],
            },
          ],
        },
        { endpointsById, errorTypesById, mockupIds: new Set(["m1"]) },
      ),
    ).toEqual([
      {
        path: "states.0.causes.1",
        message: "The 200 response of GET /items has no such example anymore",
      },
      { path: "states.0.mockupIds", message: "This page has no such mockup" },
    ]);
  });
});
