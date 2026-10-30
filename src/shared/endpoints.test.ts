import { describe, expect, it } from "vitest";
import {
  createEndpointDefaults,
  type EndpointFields,
  endpointSchema,
  parsePathTemplate,
  pathMatchKey,
  suggestOperationId,
  syncPathParameters,
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
        body: { contentType: "application/json" },
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
});
