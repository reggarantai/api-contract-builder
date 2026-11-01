import type { ErrorType } from "@shared/error-types";
import { describe, expect, it } from "vitest";
import { PROBLEM_SCHEMA, suggestErrorTypeBody } from "./suggest-body";

const fields = { name: "sku-taken", status: "409", title: "SKU already used" };

function existing(
  name: string,
  body: ErrorType["body"],
  updatedAt = "2026-01-01T00:00:00.000Z",
): ErrorType {
  return {
    id: name,
    projectId: "p1",
    name,
    status: "404",
    title: name,
    description: "",
    headers: { type: "object", properties: {} },
    body,
    endpointIds: [],
    createdAt: updatedAt,
    updatedAt,
  };
}

describe("suggestErrorTypeBody", () => {
  it("starts the first error type as problem details with the Problem model", () => {
    expect(
      suggestErrorTypeBody(fields, [], [{ id: "m1", name: "problem" }]),
    ).toEqual({
      contentType: "application/problem+json",
      schema: { $ref: "model:m1" },
      example: {
        type: "https://example.com/problems/sku-taken",
        title: "SKU already used",
        status: 409,
      },
    });
  });

  it("describes the problem details members when there's no Problem model", () => {
    expect(suggestErrorTypeBody(fields, [], []).schema).toEqual(PROBLEM_SCHEMA);
  });

  it("follows the most recently changed error type, type URIs included", () => {
    const older = existing("not-found", {
      contentType: "application/problem+json",
      schema: { $ref: "model:old" },
      example: { type: "https://example.com/problems/not-found" },
    });
    const newer = existing(
      "gone",
      {
        contentType: "application/problem+json",
        schema: { $ref: "model:m2" },
        example: { type: "https://api.shop.example/errors#gone" },
      },
      "2026-02-01T00:00:00.000Z",
    );

    expect(suggestErrorTypeBody(fields, [older, newer], [])).toEqual({
      contentType: "application/problem+json",
      schema: { $ref: "model:m2" },
      example: {
        type: "https://api.shop.example/errors#sku-taken",
        title: "SKU already used",
        status: 409,
      },
    });
  });

  it("leaves the example of other formats to the author", () => {
    const custom = existing("not-found", {
      contentType: "application/json",
      schema: { $ref: "model:error" },
      example: { error: { code: "not-found" } },
    });

    expect(suggestErrorTypeBody(fields, [custom], [])).toEqual({
      contentType: "application/json",
      schema: { $ref: "model:error" },
      example: {},
    });
  });
});
