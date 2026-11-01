import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

// Editors send the revision their changes start from, so a save can't
// overwrite one made since in another tab or window. Clients that don't send
// one save as before.
describe("revisions", () => {
  let t: ReturnType<typeof createTestApp>;
  let base: string;

  beforeEach(async () => {
    t = createTestApp();
    const project = projectSchema.parse(
      await (await t.request("POST", "/api/projects", { name: "Shop" })).json(),
    );
    base = `/api/projects/${project.id}`;
  });

  afterEach(() => {
    t.close();
  });

  async function create(url: string, body: unknown) {
    const response = await t.request("POST", `${base}${url}`, body);
    expect(response.status).toBe(201);
    return (await response.json()) as { id: string };
  }

  const resources: [
    what: string,
    url: () => Promise<string>,
    change: (text: string) => Record<string, unknown>,
    read: (saved: Record<string, unknown>) => unknown,
  ][] = [
    [
      "project",
      async () => base,
      (text) => ({ description: text }),
      (saved) => saved.description,
    ],
    [
      "model",
      async () =>
        `${base}/models/${(await create("/models", { name: "Item" })).id}`,
      (text) => ({ description: text }),
      (saved) => saved.description,
    ],
    [
      "error type",
      async () =>
        `${base}/error-types/${
          (
            await create("/error-types", {
              name: "not-found",
              status: "404",
              title: "Not found",
              body: {
                contentType: "application/json",
                schema: { type: "object" },
                example: {},
              },
            })
          ).id
        }`,
      (text) => ({ title: text }),
      (saved) => saved.title,
    ],
    [
      "endpoint",
      async () =>
        `${base}/endpoints/${
          (await create("/endpoints", { method: "GET", path: "/items" })).id
        }`,
      (text) => ({ summary: text }),
      (saved) => saved.summary,
    ],
  ];

  describe.each(resources)("of a %s", (what, urlOf, change, read) => {
    it("count saves, and an older one is refused", async () => {
      const url = await urlOf();
      const get = async () =>
        (await (await t.request("GET", url)).json()) as Record<
          string,
          unknown
        > & { revision: number };
      const before = await get();

      const saved = await t.request("PATCH", url, {
        ...change("One"),
        revision: before.revision,
      });
      expect(saved.status).toBe(200);
      expect(((await saved.json()) as { revision: number }).revision).toBe(
        before.revision + 1,
      );

      const stale = await t.request("PATCH", url, {
        ...change("Two"),
        revision: before.revision,
      });
      expect(stale.status).toBe(409);
      expect(await stale.json()).toEqual({
        error: `This ${what} was saved again since revision ${before.revision}. It's at revision ${before.revision + 1} now: load it, or send that revision to save over it.`,
        revision: before.revision + 1,
      });
      expect(read(await get())).toBe("One");

      expect((await t.request("PATCH", url, change("Three"))).status).toBe(200);
      const after = await get();
      expect(read(after)).toBe("Three");
      expect(after.revision).toBe(before.revision + 2);
    });
  });
});
