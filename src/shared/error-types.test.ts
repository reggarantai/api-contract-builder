import { describe, expect, it } from "vitest";
import {
  createEndpointDefaults,
  type EndpointResponse,
  newResponse,
} from "./endpoints";
import {
  checkResponseErrors,
  type ErrorTypeFields,
  errorTypeFieldsSchema,
  statusMatches,
} from "./error-types";

const PROBLEMS = "https://api.example.com/problems/";

function errorType(
  id: string,
  name: string,
  status: string,
  changes: Partial<ErrorTypeFields> = {},
) {
  return {
    id,
    name,
    status,
    title: name,
    description: "",
    headers: { type: "object", properties: {} },
    body: {
      contentType: "application/problem+json",
      schema: { $ref: "model:problem" },
      example: { type: `${PROBLEMS}${name}`, title: name, status: +status },
    },
    ...changes,
  };
}

describe("errorTypeFieldsSchema", () => {
  const valid = errorType("e1", "sku-taken", "409");

  function issuePaths(fields: unknown) {
    const result = errorTypeFieldsSchema.safeParse(fields);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.path.join("."));
  }

  it("accepts an error type with a problem details body, and requires a body", () => {
    expect(issuePaths(valid)).toEqual([]);
    expect(issuePaths({ ...valid, body: null })).toEqual(["body"]);
  });

  it("takes only 4xx and 5xx status codes", () => {
    expect(issuePaths({ ...valid, status: "503" })).toEqual([]);
    for (const status of ["200", "302", "4XX", "default", "40"]) {
      expect(issuePaths({ ...valid, status })).toEqual(["status"]);
    }
  });

  it("requires a name, a title, and an example for the body", () => {
    expect(issuePaths({ ...valid, name: "sku taken" })).toEqual(["name"]);
    expect(issuePaths({ ...valid, title: " " })).toEqual(["title"]);
    const withoutExample = { contentType: "application/json", schema: {} };
    expect(issuePaths({ ...valid, body: withoutExample })).toEqual([
      "body.example",
    ]);
  });

  it("rejects headers that OpenAPI ignores and duplicate header names", () => {
    expect(
      issuePaths({
        ...valid,
        headers: {
          type: "object",
          properties: {
            "Content-Type": { type: "string" },
            "Retry-After": { type: "integer" },
            "retry-after": { type: "integer" },
          },
        },
      }),
    ).toEqual(["headers", "headers"]);
  });
});

describe("statusMatches", () => {
  it.each([
    ["404", "404", true],
    ["404", "409", false],
    ["404", "4XX", true],
    ["503", "4XX", false],
    ["503", "5XX", true],
    ["503", "default", true],
    ["404", "200", false],
  ])("a %s error in a %s response: %s", (errorStatus, responseStatus, ok) => {
    expect(statusMatches(errorStatus, responseStatus)).toBe(ok);
  });
});

describe("checkResponseErrors", () => {
  const catalog = [
    errorType("taken", "sku-taken", "409"),
    errorType("busy", "request-in-progress", "409"),
    errorType("missing", "not-found", "404"),
  ];
  const example = (id: string, name: string) => ({
    id,
    name,
    summary: "",
    value: { type: `${PROBLEMS}${name}` },
  });

  function withResponses(...responses: EndpointResponse[]) {
    return { ...createEndpointDefaults("POST", "/items"), responses };
  }
  function errorResponse(
    status: string,
    errors: EndpointResponse["errors"],
  ): EndpointResponse {
    return { ...newResponse(`r${status}`, status), body: null, errors };
  }

  it("accepts catalog errors whose status matches the response", () => {
    expect(
      checkResponseErrors(
        withResponses(
          errorResponse("409", [
            { errorTypeId: "taken", examples: [] },
            { errorTypeId: "busy", examples: [] },
          ]),
          errorResponse("4XX", [{ errorTypeId: "missing", examples: [] }]),
        ),
        catalog,
      ),
    ).toEqual([]);
  });

  it("reports errors that aren't in the catalog or don't match the status", () => {
    expect(
      checkResponseErrors(
        withResponses(
          errorResponse("409", [
            { errorTypeId: "deleted", examples: [] },
            { errorTypeId: "missing", examples: [] },
          ]),
        ),
        catalog,
      ),
    ).toEqual([
      {
        path: "responses.0.errors.0.errorTypeId",
        message: "This error type isn't in the project",
      },
      {
        path: "responses.0.errors.1.errorTypeId",
        message: "not-found is a 404 error, so a 409 response can't use it",
      },
    ]);
  });

  it("requires the example names in a response to be unique", () => {
    expect(
      checkResponseErrors(
        withResponses(
          errorResponse("409", [
            { errorTypeId: "taken", examples: [] },
            {
              errorTypeId: "busy",
              examples: [
                example("x1", "sku-taken"),
                example("x2", "in-progress"),
                example("x3", "in-progress"),
              ],
            },
          ]),
        ),
        catalog,
      ),
    ).toEqual([
      {
        path: "responses.0.errors.1.examples.0.name",
        message: "Example names must be unique: sku-taken is already used",
      },
      {
        path: "responses.0.errors.1.examples.2.name",
        message: "Example names must be unique: in-progress is already used",
      },
    ]);
  });

  it("lets an endpoint's own example reuse the name of the error it replaces", () => {
    expect(
      checkResponseErrors(
        withResponses(
          errorResponse("404", [
            {
              errorTypeId: "missing",
              examples: [example("x1", "not-found")],
            },
          ]),
        ),
        catalog,
      ),
    ).toEqual([]);
  });

  it("puts each error in the response that answers its status", () => {
    // OpenAPI picks 409 over 4XX, and 4XX over default.
    expect(
      checkResponseErrors(
        withResponses(
          errorResponse("409", [{ errorTypeId: "busy", examples: [] }]),
          errorResponse("4XX", [{ errorTypeId: "taken", examples: [] }]),
          errorResponse("default", [{ errorTypeId: "missing", examples: [] }]),
        ),
        catalog,
      ),
    ).toEqual([
      {
        path: "responses.1.errors.0.errorTypeId",
        message:
          "sku-taken belongs in the 409 response, which answers 409 instead of 4XX",
      },
      {
        path: "responses.2.errors.0.errorTypeId",
        message:
          "not-found belongs in the 4XX response, which answers 404 instead of default",
      },
    ]);
  });
});
