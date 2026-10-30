import { describe, expect, it } from "vitest";
import { type PageFields, pageFieldsSchema } from "./pages";

const base: PageFields = {
  name: "Login",
  slug: "login",
  description: "",
  acceptanceCriteria: "",
  endpoints: [],
};

function issuePaths(page: PageFields) {
  const result = pageFieldsSchema.safeParse(page);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("pageFieldsSchema", () => {
  it("accepts endpoint links with triggers and notes", () => {
    expect(
      issuePaths({
        ...base,
        endpoints: [
          {
            id: "1",
            endpointId: "login",
            trigger: "on_submit",
            note: "Show errors inline",
          },
          { id: "2", endpointId: "me", trigger: "on_load", note: "" },
        ],
      }),
    ).toEqual([]);
  });

  it("allows one endpoint with different triggers", () => {
    expect(
      issuePaths({
        ...base,
        endpoints: [
          { id: "1", endpointId: "stocks", trigger: "on_load", note: "" },
          {
            id: "2",
            endpointId: "stocks",
            trigger: "on_action",
            note: "Refresh",
          },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects the same endpoint twice with the same trigger", () => {
    expect(
      issuePaths({
        ...base,
        endpoints: [
          { id: "1", endpointId: "stocks", trigger: "on_load", note: "" },
          { id: "2", endpointId: "stocks", trigger: "on_load", note: "" },
        ],
      }),
    ).toEqual(["endpoints.1.endpointId"]);
  });

  it("requires a name and a valid slug", () => {
    expect(issuePaths({ ...base, name: " ", slug: "Not a slug" })).toEqual([
      "name",
      "slug",
    ]);
  });
});
