import { describe, expect, it } from "vitest";
import {
  createEndpointDefaults,
  type EndpointFields,
  endpointSchema,
  examplesOfEndpoint,
  newBody,
  newResponse,
  parsePathTemplate,
  pathMatchKey,
  schemasOfEndpoint,
  suggestOperationId,
  syncPathParameters,
  updateEndpointInputSchema,
  withUniqueIds,
} from "./endpoints";

describe("parsePathTemplate", () => {
  it.each([
    ["/", []],
    ["/stocks", []],
    ["/stocks/{id}", ["id"]],
    ["/users/{userId}/orders/{order_id}", ["userId", "order_id"]],
    ["/files/{name}.{ext}", ["name", "ext"]],
  ])("%s → %j", (path, params) => {
    expect(parsePathTemplate(path)).toEqual({ params });
  });

  it.each([
    ["stocks", "Path must start with /"],
    ["/stocks?page=1", "Leave out query strings, fragments, and spaces"],
    ["/stock items", "Leave out query strings, fragments, and spaces"],
    ["/stocks//items", "Remove empty segments (//)"],
    ["/stocks/{id", "Braces must come in pairs, like {id}"],
    ["/stocks/{}", "Name the parameter inside {}"],
    ["/stocks/{a b}", "Leave out query strings, fragments, and spaces"],
    ["/stocks/{id}/{id}", "{id} appears more than once"],
  ])("rejects %s", (path, error) => {
    expect(parsePathTemplate(path)).toEqual({ error });
  });
});

describe("pathMatchKey", () => {
  it("treats paths that differ only in parameter names as the same", () => {
    expect(pathMatchKey("/users/{id}")).toBe(pathMatchKey("/users/{userId}"));
    expect(pathMatchKey("/users/{id}")).not.toBe(pathMatchKey("/users/me"));
  });
});

describe("suggestOperationId", () => {
  it.each([
    ["GET", "/stocks", "getStocks"],
    ["GET", "/stocks/{id}", "getStocksById"],
    ["POST", "/auth/login", "postAuthLogin"],
    ["DELETE", "/stock-items/{item_id}", "deleteStockItemsByItemId"],
    ["GET", "/", "getRoot"],
  ])("%s %s → %s", (method, path, expected) => {
    expect(suggestOperationId(method, path)).toBe(expected);
  });
});

describe("syncPathParameters", () => {
  it("adds parameters from the path as required strings", () => {
    expect(
      syncPathParameters({ type: "object", properties: {} }, "/stocks/{id}"),
    ).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
  });

  it("keeps schemas of parameters that stay and drops removed ones", () => {
    const current = {
      type: "object",
      properties: {
        shopId: { type: "integer", description: "Shop" },
        id: { type: "string" },
      },
      required: ["shopId", "id"],
    };

    expect(syncPathParameters(current, "/shops/{shopId}/stocks")).toEqual({
      type: "object",
      properties: { shopId: { type: "integer", description: "Shop" } },
      required: ["shopId"],
    });
  });

  it("carries a parameter's schema over when it is renamed in place", () => {
    const current = {
      type: "object",
      properties: { id: { type: "integer", minimum: 1 } },
      required: ["id"],
    };

    expect(syncPathParameters(current, "/stocks/{stockId}")).toEqual({
      type: "object",
      properties: { stockId: { type: "integer", minimum: 1 } },
      required: ["stockId"],
    });
  });

  it("leaves parameters alone while the path is invalid", () => {
    const current = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    };

    expect(syncPathParameters(current, "/stocks/{id")).toBe(current);
  });
});

describe("createEndpointDefaults", () => {
  it("starts with path parameters, a 200 response, and no body for GET", () => {
    const endpoint = createEndpointDefaults("GET", "/stocks/{id}");

    expect(endpoint.parameters.path).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    expect(endpoint.requestBody).toBeNull();
    expect(endpoint.responses).toMatchObject([
      {
        status: "200",
        description: "OK",
        headers: { type: "object", properties: {} },
        body: { contentType: "application/json" },
        errors: [],
      },
    ]);
    expect(endpoint).toMatchObject({
      status: "draft",
      security: { type: "default" },
    });
    expect(endpointSchema.safeParse(endpoint).success).toBe(true);
  });

  it("gives POST a required JSON body and a 201 response", () => {
    const endpoint = createEndpointDefaults("POST", "/stocks");

    expect(endpoint.requestBody).toMatchObject({
      contentType: "application/json",
      required: true,
    });
    expect(endpoint.responses[0]).toMatchObject({
      status: "201",
      description: "Created",
    });
  });
});

describe("endpointSchema", () => {
  const base = createEndpointDefaults("GET", "/stocks/{id}");

  function issuePaths(endpoint: EndpointFields) {
    const result = endpointSchema.safeParse(endpoint);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("requires path parameters to match the path", () => {
    expect(
      issuePaths({
        ...base,
        parameters: {
          ...base.parameters,
          path: { type: "object", properties: { other: { type: "string" } } },
        },
      }),
    ).toEqual(["parameters.path"]);
  });

  it("requires every path parameter to be required", () => {
    expect(
      issuePaths({
        ...base,
        parameters: {
          ...base.parameters,
          path: { type: "object", properties: { id: { type: "string" } } },
        },
      }),
    ).toEqual(["parameters.path"]);
  });

  it("rejects headers that OpenAPI ignores and duplicate header names", () => {
    expect(
      issuePaths({
        ...base,
        parameters: {
          ...base.parameters,
          header: {
            type: "object",
            properties: {
              Authorization: { type: "string" },
              "X-Request-Id": { type: "string" },
              "x-request-id": { type: "string" },
            },
          },
        },
      }),
    ).toEqual(["parameters.header", "parameters.header"]);
  });

  it("rejects response headers that OpenAPI ignores and duplicate header names", () => {
    const [ok] = base.responses;
    if (!ok) throw new Error("expected a default response");

    expect(
      issuePaths({
        ...base,
        responses: [
          {
            ...ok,
            headers: {
              type: "object",
              properties: {
                "Content-Type": { type: "string" },
                ETag: { type: "string" },
                etag: { type: "string" },
              },
            },
          },
        ],
      }),
    ).toEqual(["responses.0.headers", "responses.0.headers"]);
  });

  it("requires response headers to be an object schema", () => {
    const [ok] = base.responses;
    if (!ok) throw new Error("expected a default response");

    expect(
      issuePaths({
        ...base,
        responses: [{ ...ok, headers: { type: "string" } }],
      }),
    ).toEqual(["responses.0.headers"]);
  });

  it("rejects a request body on GET", () => {
    const post = createEndpointDefaults("POST", "/stocks");
    expect(issuePaths({ ...base, requestBody: post.requestBody })).toEqual([
      "requestBody",
    ]);
  });

  it("checks response status codes", () => {
    const [ok] = base.responses;
    if (!ok) throw new Error("expected a default response");

    expect(issuePaths({ ...base, responses: [] })).toEqual(["responses"]);
    expect(
      issuePaths({
        ...base,
        responses: [
          ok,
          { ...ok, id: "dup" },
          { ...ok, id: "bad", status: "299x" },
        ],
      }).sort(),
    ).toEqual(["responses.1.status", "responses.2.status"]);
    expect(
      issuePaths({
        ...base,
        responses: [
          { ...ok, status: "4XX" },
          { ...ok, id: "d", status: "default" },
        ],
      }),
    ).toEqual([]);
  });

  it("requires unique example names within a body", () => {
    const [ok] = base.responses;
    if (!ok?.body) throw new Error("expected a default body");
    const example = {
      id: "e1",
      name: "found",
      summary: "",
      value: { id: "1" },
    };

    expect(
      issuePaths({
        ...base,
        responses: [
          {
            ...ok,
            body: { ...ok.body, examples: [example, { ...example, id: "e2" }] },
          },
        ],
      }),
    ).toEqual(["responses.0.body.examples.1.name"]);
  });

  it("lets clients leave out catalog errors, and the examples of one", () => {
    const [ok] = base.responses;
    if (!ok) throw new Error("expected a default response");
    const { errors: _errors, ...withoutErrors } = ok;

    const result = updateEndpointInputSchema.safeParse({
      responses: [
        withoutErrors,
        { ...withoutErrors, id: "r2", errors: [{ errorTypeId: "gone" }] },
      ],
    });

    if (!result.success) throw result.error;
    expect(result.data.responses?.[0]).not.toHaveProperty("errors");
    expect(result.data.responses?.[1]?.errors).toEqual([
      { errorTypeId: "gone", examples: [] },
    ]);
    // Stored and edited responses always have them.
    expect(
      endpointSchema.safeParse({ ...base, responses: [withoutErrors] }).success,
    ).toBe(false);
  });

  it("takes the body of a response with catalog errors from them, once each", () => {
    const [ok] = base.responses;
    if (!ok) throw new Error("expected a default response");
    const notFound = { errorTypeId: "missing", examples: [] };

    expect(
      issuePaths({
        ...base,
        responses: [
          { ...ok, status: "404", body: null, errors: [notFound] },
          {
            ...ok,
            id: "with-body",
            status: "410",
            errors: [{ errorTypeId: "gone", examples: [] }],
          },
          {
            ...ok,
            id: "twice",
            status: "4XX",
            body: null,
            errors: [notFound, notFound],
          },
        ],
      }),
    ).toEqual(["responses.1.body", "responses.2.errors.1.errorTypeId"]);
  });
});

describe("schemasOfEndpoint", () => {
  it("lists every schema with where it sits, response headers included", () => {
    const endpoint = createEndpointDefaults("POST", "/stocks");

    expect(schemasOfEndpoint(endpoint).map(([path]) => path)).toEqual([
      "parameters.path",
      "parameters.query",
      "parameters.header",
      "requestBody.schema",
      "responses.0.headers",
      "responses.0.body.schema",
    ]);
  });
});

// Page states refer to responses and examples by ID, so IDs must be unique
// where a reference looks them up.
describe("endpointSchema IDs", () => {
  const example = (id: string, name: string) => ({
    id,
    name,
    summary: "",
    value: {},
  });

  function issuePaths(fields: EndpointFields) {
    const result = endpointSchema.safeParse(fields);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("rejects two responses with the same ID", () => {
    const endpoint = createEndpointDefaults("GET", "/items", "", () => "r1");
    endpoint.responses.push(newResponse("r1", "404"));

    expect(issuePaths(endpoint)).toEqual(["responses.1.id"]);
  });

  it("rejects two examples with the same ID in one body or one error", () => {
    const endpoint = createEndpointDefaults("POST", "/items", "", () => "r1");
    const [created] = endpoint.responses;
    if (!endpoint.requestBody || !created?.body) {
      throw new Error("A POST has a body and a 201 with one");
    }
    // The request body and a response may share IDs: they're looked up apart.
    endpoint.requestBody.examples = [example("x1", "new")];
    created.body.examples = [example("x1", "created"), example("x1", "again")];
    endpoint.responses.push({
      ...newResponse("r2", "422"),
      body: null,
      errors: [
        {
          errorTypeId: "et1",
          examples: [example("o1", "short"), example("o1", "long")],
        },
      ],
    });

    expect(issuePaths(endpoint)).toEqual([
      "responses.0.body.examples.1.id",
      "responses.1.errors.0.examples.1.id",
    ]);
  });
});

// Data saved before IDs had to be unique can have duplicates; reading it
// renames the later ones, so references and saves keep working.
describe("withUniqueIds", () => {
  const example = (id: string, name: string) => ({
    id,
    name,
    summary: "",
    value: {},
  });

  it("renames later duplicates and leaves the first and unique IDs alone", () => {
    const responses = [
      {
        ...newResponse("r", "200"),
        body: {
          ...newBody(),
          examples: [example("x", "a"), example("x", "b"), example("x-2", "c")],
        },
      },
      newResponse("r", "404"),
      {
        ...newResponse("e", "409"),
        body: null,
        errors: [
          {
            errorTypeId: "t",
            examples: [example("o", "p"), example("o", "q")],
          },
        ],
      },
    ];

    const fixed = withUniqueIds(responses);

    expect(fixed.map((response) => response.id)).toEqual(["r", "r-2", "e"]);
    expect(fixed[0]?.body?.examples.map((item) => item.id)).toEqual([
      "x",
      "x-3",
      "x-2",
    ]);
    expect(fixed[2]?.errors[0]?.examples.map((item) => item.id)).toEqual([
      "o",
      "o-2",
    ]);
    const clean = [newResponse("a", "200"), newResponse("b", "404")];
    expect(withUniqueIds(clean)).toEqual(clean);
  });

  it("keeps renamed IDs within 64 characters", () => {
    const long = "r".repeat(64);

    const fixed = withUniqueIds([
      newResponse(long, "200"),
      newResponse(long, "404"),
    ]);

    expect(fixed[1]?.id).toBe(`${"r".repeat(62)}-2`);
  });
});

describe("examplesOfEndpoint", () => {
  it("lists every example value with its path", () => {
    const endpoint = createEndpointDefaults("POST", "/orders");
    const example = (name: string, value: unknown) => ({
      id: name,
      name,
      summary: "",
      value: value as never,
    });
    const body = { ...newBody(), examples: [example("a", 1), example("b", 2)] };
    const fields = {
      ...endpoint,
      requestBody: endpoint.requestBody && {
        ...endpoint.requestBody,
        examples: [example("r", "request")],
      },
      responses: [
        { ...newResponse("ok", "200"), body },
        {
          ...newResponse("gone", "404"),
          errors: [
            { errorTypeId: "e1", examples: [] },
            { errorTypeId: "e2", examples: [example("x", { error: true })] },
          ],
        },
      ],
    };

    expect(examplesOfEndpoint(fields)).toEqual([
      ["requestBody.examples.0.value", "request"],
      ["responses.0.body.examples.0.value", 1],
      ["responses.0.body.examples.1.value", 2],
      ["responses.1.errors.1.examples.0.value", { error: true }],
    ]);
  });
});
