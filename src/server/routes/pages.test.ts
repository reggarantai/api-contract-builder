import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import {
  endpointResponseFieldsSchema,
  endpointSummarySchema,
} from "../../shared/endpoints";
import { type Page, pageSchema, pageSummarySchema } from "../../shared/pages";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

describe("pages API", () => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;

  beforeEach(async () => {
    t = createTestApp();
    projectId = await createProject("Shop");
  });

  afterEach(() => {
    t.close();
  });

  async function createProject(name: string) {
    const response = await t.request("POST", "/api/projects", { name });
    return projectSchema.parse(await response.json()).id;
  }

  const pagesUrl = (id = projectId) => `/api/projects/${id}/pages`;

  async function createPage(body: Record<string, unknown>): Promise<Page> {
    const response = await t.request("POST", pagesUrl(), body);
    expect(response.status).toBe(201);
    return pageSchema.parse(await response.json());
  }

  async function listPages() {
    const response = await t.request("GET", pagesUrl());
    return pageSummarySchema.array().parse(await response.json());
  }

  async function createEndpoint(method: string, path: string, id = projectId) {
    const response = await t.request("POST", `/api/projects/${id}/endpoints`, {
      method,
      path,
    });
    return endpointResponseFieldsSchema.parse(await response.json());
  }

  async function errorOf(response: Response) {
    return apiErrorSchema.parse(await response.json());
  }

  function count(table: string) {
    return t.db.$client
      .prepare(`select count(*) as count from ${table}`)
      .get() as { count: number };
  }

  it("creates pages at the end with slugs from their names", async () => {
    const login = await createPage({ name: "Login" });
    const again = await createPage({ name: "Login" });

    expect(login).toMatchObject({
      projectId,
      name: "Login",
      slug: "login",
      description: "",
      acceptanceCriteria: "",
      endpoints: [],
      mockups: [],
    });
    expect(again.slug).toBe("login-2");
    expect(await listPages()).toMatchObject([
      { id: login.id, endpointCount: 0, mockupCount: 0 },
      { id: again.id },
    ]);
  });

  it("rejects a slug used by another page of the project", async () => {
    await createPage({ name: "Login" });

    const response = await t.request("POST", pagesUrl(), {
      name: "Sign in",
      slug: "login",
    });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).issues).toEqual([
      { path: "slug", message: "Already used by another page" },
    ]);
  });

  it("reorders pages", async () => {
    const a = await createPage({ name: "A" });
    const b = await createPage({ name: "B" });
    const c = await createPage({ name: "C" });

    const response = await t.request("PUT", `${pagesUrl()}/order`, {
      pageIds: [c.id, a.id, b.id],
    });

    expect(response.status).toBe(200);
    expect((await listPages()).map((page) => page.name)).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  it("rejects an order that doesn't list every page once", async () => {
    const a = await createPage({ name: "A" });
    const b = await createPage({ name: "B" });

    for (const pageIds of [[a.id], [a.id, a.id], [a.id, b.id, "other"]]) {
      const response = await t.request("PUT", `${pagesUrl()}/order`, {
        pageIds,
      });
      expect(response.status, JSON.stringify(pageIds)).toBe(400);
    }
  });

  it("saves texts and endpoint links in order", async () => {
    const page = await createPage({ name: "Login" });
    const login = await createEndpoint("POST", "/auth/login");
    const me = await createEndpoint("GET", "/me");
    const links = [
      {
        id: "l1",
        endpointId: login.id,
        trigger: "on_submit",
        note: "Show errors inline",
      },
      { id: "l2", endpointId: me.id, trigger: "on_load", note: "" },
    ];

    const response = await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
      description: "# Login\n\nSign in with email.",
      acceptanceCriteria: "- [ ] Wrong password shows an error",
      endpoints: links,
    });

    expect(response.status).toBe(200);
    const saved = pageSchema.parse(
      await (await t.request("GET", `${pagesUrl()}/${page.id}`)).json(),
    );
    expect(saved).toMatchObject({
      description: "# Login\n\nSign in with email.",
      acceptanceCriteria: "- [ ] Wrong password shows an error",
      endpoints: links,
    });
    expect(await listPages()).toMatchObject([{ endpointCount: 2 }]);
  });

  it("rejects links to endpoints of other projects", async () => {
    const page = await createPage({ name: "Login" });
    const otherProject = await createProject("Other");
    const foreign = await createEndpoint("GET", "/me", otherProject);

    const response = await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
      endpoints: [
        { id: "l1", endpointId: foreign.id, trigger: "on_load", note: "" },
      ],
    });

    expect(response.status).toBe(400);
    expect((await errorOf(response)).issues).toEqual([
      {
        path: "endpoints.0.endpointId",
        message: "Pick an endpoint of this project",
      },
    ]);
  });

  it("drops links when their endpoint is deleted", async () => {
    const page = await createPage({ name: "Login" });
    const me = await createEndpoint("GET", "/me");
    await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
      endpoints: [
        { id: "l1", endpointId: me.id, trigger: "on_load", note: "" },
      ],
    });

    await t.request("DELETE", `/api/projects/${projectId}/endpoints/${me.id}`);

    const saved = pageSchema.parse(
      await (await t.request("GET", `${pagesUrl()}/${page.id}`)).json(),
    );
    expect(saved.endpoints).toEqual([]);
  });

  it("tells each endpoint which pages use it", async () => {
    const login = await createPage({ name: "Login" });
    const profile = await createPage({ name: "Profile" });
    const me = await createEndpoint("GET", "/me");
    const unused = await createEndpoint("GET", "/unused");
    for (const page of [login, profile]) {
      await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
        endpoints: [
          { id: "l1", endpointId: me.id, trigger: "on_load", note: "" },
        ],
      });
    }

    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/endpoints`,
    );

    const endpoints = endpointSummarySchema
      .array()
      .parse(await response.json());
    expect(endpoints.find((e) => e.id === me.id)?.pageIds.sort()).toEqual(
      [login.id, profile.id].sort(),
    );
    expect(endpoints.find((e) => e.id === unused.id)?.pageIds).toEqual([]);
  });

  it("keeps pages inside their project", async () => {
    const page = await createPage({ name: "Login" });
    const other = await createProject("Other");

    const response = await t.request("GET", `${pagesUrl(other)}/${page.id}`);

    expect(response.status).toBe(404);
  });

  it("deletes a page with its links", async () => {
    const page = await createPage({ name: "Login" });
    const me = await createEndpoint("GET", "/me");
    await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
      endpoints: [
        { id: "l1", endpointId: me.id, trigger: "on_load", note: "" },
      ],
    });

    const deleted = await t.request("DELETE", `${pagesUrl()}/${page.id}`);

    expect(deleted.status).toBe(204);
    expect((await t.request("GET", `${pagesUrl()}/${page.id}`)).status).toBe(
      404,
    );
    expect(count("page_endpoints")).toEqual({ count: 0 });
  });

  it("marks the project as changed", async () => {
    const before = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );

    await createPage({ name: "Login" });

    const after = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("is deleted with its project", async () => {
    const page = await createPage({ name: "Login" });
    const me = await createEndpoint("GET", "/me");
    await t.request("PATCH", `${pagesUrl()}/${page.id}`, {
      endpoints: [
        { id: "l1", endpointId: me.id, trigger: "on_load", note: "" },
      ],
    });

    await t.request("DELETE", `/api/projects/${projectId}`);

    expect(count("pages")).toEqual({ count: 0 });
    expect(count("page_endpoints")).toEqual({ count: 0 });
  });
});
