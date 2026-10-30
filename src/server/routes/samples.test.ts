import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { endpointSummarySchema } from "../../shared/endpoints";
import { exportReportSchema } from "../../shared/export";
import { modelSummarySchema } from "../../shared/models";
import { pageSummarySchema } from "../../shared/pages";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

describe("sample project", () => {
  let t: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    t = createTestApp();
  });

  afterEach(() => {
    t.close();
  });

  async function createSample() {
    const response = await t.request("POST", "/api/samples");
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  async function get<T>(url: string, parse: (data: unknown) => T) {
    return parse(await (await t.request("GET", url)).json());
  }

  it("creates pages with mockups, the endpoints they call, and models", async () => {
    const project = await createSample();
    const base = `/api/projects/${project.id}`;

    expect(project).toMatchObject({
      name: "Inventory App",
      slug: "inventory-app",
    });
    const pages = await get(`${base}/pages`, (data) =>
      pageSummarySchema.array().parse(data),
    );
    expect(
      pages.map((page) => [page.name, page.mockupCount, page.endpointCount]),
    ).toEqual([
      ["Login", 2, 2],
      ["Registration", 1, 1],
      ["Stock list", 1, 2],
      ["Create schedule", 1, 3],
    ]);
    const endpoints = await get(`${base}/endpoints`, (data) =>
      endpointSummarySchema.array().parse(data),
    );
    expect(
      endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ).toEqual([
      "POST /auth/login",
      "POST /auth/register",
      "GET /health",
      "GET /me",
      "POST /schedules",
      "GET /stocks",
      "DELETE /stocks/{sku}",
      "GET /suppliers",
    ]);
    // One endpoint serves two pages.
    const list = endpoints.find((endpoint) => endpoint.path === "/stocks");
    expect(list?.pageIds).toHaveLength(2);
    const models = await get(`${base}/models`, (data) =>
      modelSummarySchema.array().parse(data),
    );
    expect(models.map((model) => model.name)).toEqual([
      "Category",
      "Error",
      "Schedule",
      "Stock",
      "Supplier",
      "User",
    ]);
  });

  it("exports as valid OpenAPI, warning only about the endpoint left out on purpose", async () => {
    const project = await createSample();

    const report = await get(
      `/api/projects/${project.id}/export/report`,
      (data) => exportReportSchema.parse(data),
    );

    expect(report.valid).toBe(true);
    expect(report.warnings.map((warning) => warning.message)).toEqual([
      "GET /health: the 200 response has no example",
      "GET /health isn't used by any page",
    ]);
  });

  it("can be created more than once", async () => {
    await createSample();
    const second = await createSample();

    expect(second.slug).toBe("inventory-app-2");
  });
});
