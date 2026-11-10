import { describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import { projects } from "../db/schema";
import { createTestApp } from "../test-utils";

// A mistake in the app while it measures an import's exports (nothing a
// document is known to cause): the import is refused, asking for a report,
// rather than answering a server error.
vi.mock("../openapi-import/exports", async (original) => ({
  ...(await original<typeof import("../openapi-import/exports")>()),
  exportOverLimit: () => {
    throw new TypeError("an unexpected mistake");
  },
}));

describe("a mistake while measuring an import's exports", () => {
  it("refuses the import, asking for a report, and writes nothing", async () => {
    const t = createTestApp();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await t.app.request("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          openapi: "3.1.0",
          info: { title: "Shop", version: "1" },
        }),
      });
      expect(response.status).toBe(400);
      expect(apiErrorSchema.parse(await response.json()).error).toMatch(
        /This is a problem in the app: please report it/,
      );
      expect(logged).toHaveBeenCalled();
      expect(t.db.select().from(projects).all()).toHaveLength(0);
    } finally {
      logged.mockRestore();
      t.close();
    }
  });
});
