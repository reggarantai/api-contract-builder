import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import {
  type Project,
  projectSchema,
  projectSummarySchema,
} from "../../shared/projects";
import { createTestApp } from "../test-utils";

describe("projects API", () => {
  let t: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    t = createTestApp();
  });

  afterEach(() => {
    vi.useRealTimers();
    t.close();
  });

  async function createProject(
    body: Record<string, unknown>,
  ): Promise<Project> {
    const response = await t.request("POST", "/api/projects", body);
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  async function errorOf(response: Response) {
    return apiErrorSchema.parse(await response.json());
  }

  describe("POST /api/projects", () => {
    it("creates a project with defaults and a slug derived from the name", async () => {
      const project = await createProject({ name: "  Inventory App  " });

      expect(project).toMatchObject({
        name: "Inventory App",
        slug: "inventory-app",
        description: "",
        apiVersion: "1.0.0",
        servers: [],
        securitySchemes: [],
        defaultSecuritySchemeId: null,
      });
    });

    it("adds a numeric suffix when the derived slug is taken", async () => {
      await createProject({ name: "Inventory App" });
      const second = await createProject({ name: "Inventory app" });

      expect(second.slug).toBe("inventory-app-2");
    });

    it("falls back to a generic slug for names without latin characters", async () => {
      const project = await createProject({ name: "日本語" });

      expect(project.slug).toBe("project");
    });

    it("rejects an explicit slug that is already taken", async () => {
      await createProject({ name: "Inventory", slug: "inventory" });

      const response = await t.request("POST", "/api/projects", {
        name: "Other",
        slug: "inventory",
      });

      expect(response.status).toBe(409);
      expect((await errorOf(response)).issues).toEqual([
        { path: "slug", message: "Already used by another project" },
      ]);
    });

    it("reports invalid fields", async () => {
      const response = await t.request("POST", "/api/projects", {
        name: " ",
        slug: "Not A Slug",
      });

      expect(response.status).toBe(400);
      const paths = (await errorOf(response)).issues?.map(
        (issue) => issue.path,
      );
      expect(paths).toEqual(["name", "slug"]);
    });

    it("rejects malformed JSON", async () => {
      const response = await t.app.request("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });

      expect(response.status).toBe(400);
      expect(await errorOf(response)).toHaveProperty("error");
    });
  });

  it("lists projects sorted by name, ignoring case", async () => {
    await createProject({ name: "beta" });
    await createProject({ name: "Alpha" });

    const response = await t.request("GET", "/api/projects");

    expect(response.status).toBe(200);
    const projects = projectSummarySchema.array().parse(await response.json());
    expect(projects.map((project) => project.name)).toEqual(["Alpha", "beta"]);
  });

  it("returns 404 for unknown projects", async () => {
    for (const method of ["GET", "PATCH", "DELETE"]) {
      const response = await t.request(
        method,
        "/api/projects/unknown",
        method === "PATCH" ? { name: "x" } : undefined,
      );
      expect(response.status, method).toBe(404);
    }
  });

  describe("PATCH /api/projects/:id", () => {
    it("updates settings and bumps updatedAt", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
      const project = await createProject({ name: "Inventory" });

      vi.setSystemTime(new Date("2026-01-02T00:00:00.000Z"));
      const response = await t.request("PATCH", `/api/projects/${project.id}`, {
        servers: [
          {
            id: "s1",
            name: "Production",
            url: "https://api.example.com",
            description: "",
          },
        ],
        securitySchemes: [
          {
            id: "a1",
            key: "bearerAuth",
            type: "bearer",
            bearerFormat: "JWT",
            description: "",
          },
        ],
        defaultSecuritySchemeId: "a1",
      });

      expect(response.status).toBe(200);
      const updated = projectSchema.parse(await response.json());
      expect(updated.servers).toHaveLength(1);
      expect(updated.defaultSecuritySchemeId).toBe("a1");
      expect(updated.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(updated.updatedAt).toBe("2026-01-02T00:00:00.000Z");

      const reloaded = await t.request("GET", `/api/projects/${project.id}`);
      expect(projectSchema.parse(await reloaded.json())).toEqual(updated);
    });

    it("keeps fields that are not in the request", async () => {
      const project = await createProject({
        name: "Inventory",
        description: "Stock",
      });

      const response = await t.request("PATCH", `/api/projects/${project.id}`, {
        name: "Inventory v2",
      });

      const updated = projectSchema.parse(await response.json());
      expect(updated).toMatchObject({
        name: "Inventory v2",
        description: "Stock",
      });
    });

    it("checks rules that span several fields", async () => {
      const project = await createProject({ name: "Inventory" });

      const response = await t.request("PATCH", `/api/projects/${project.id}`, {
        defaultSecuritySchemeId: "missing",
      });

      expect(response.status).toBe(400);
      expect(
        (await errorOf(response)).issues?.map((issue) => issue.path),
      ).toEqual(["defaultSecuritySchemeId"]);
    });

    it("rejects a slug used by another project", async () => {
      await createProject({ name: "Inventory" });
      const other = await createProject({ name: "Orders" });

      const response = await t.request("PATCH", `/api/projects/${other.id}`, {
        slug: "inventory",
      });

      expect(response.status).toBe(409);
    });

    it("allows saving a project with its own slug", async () => {
      const project = await createProject({ name: "Inventory" });

      const response = await t.request("PATCH", `/api/projects/${project.id}`, {
        slug: "inventory",
        name: "Inventory",
      });

      expect(response.status).toBe(200);
    });
  });

  it("deletes a project", async () => {
    const project = await createProject({ name: "Inventory" });

    const deleted = await t.request("DELETE", `/api/projects/${project.id}`);
    const reloaded = await t.request("GET", `/api/projects/${project.id}`);

    expect(deleted.status).toBe(204);
    expect(reloaded.status).toBe(404);
  });
});
