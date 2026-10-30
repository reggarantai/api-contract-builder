import fs from "node:fs";
import path from "node:path";
import prismHttp from "@stoplight/prism-http";
import prismClient from "@stoplight/prism-http/dist/client.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { buildInventoryProject } from "../../../test/fixtures/inventory";
import { createTestApp } from "../test-utils";

const GOLDEN = path.resolve("test/golden/inventory.openapi.yaml");

/** Prism logs every request; tests don't need to see that. */
const silentLogger: unknown = new Proxy(
  {},
  { get: (_target, key) => (key === "child" ? () => silentLogger : () => {}) },
);

describe("export API", () => {
  let t: ReturnType<typeof createTestApp>;
  let fixture: Awaited<ReturnType<typeof buildInventoryProject>>;

  beforeEach(async () => {
    t = createTestApp();
    fixture = await buildInventoryProject(t.request);
  });

  afterEach(() => {
    t.close();
  });

  const exportUrl = (query = "") =>
    `/api/projects/${fixture.projectId}/export/openapi${query}`;

  it("exports the project as OpenAPI YAML matching the golden file", async () => {
    const response = await t.request("GET", exportUrl("?format=yaml"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/yaml; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.openapi.yaml"',
    );
    const yaml = await response.text();
    if (process.env.UPDATE_GOLDEN) {
      fs.writeFileSync(GOLDEN, yaml);
    }
    expect(yaml).toBe(fs.readFileSync(GOLDEN, "utf8"));
  });

  it("exports the same document as JSON", async () => {
    const yaml = await (
      await t.request("GET", exportUrl("?format=yaml"))
    ).text();
    const response = await t.request("GET", exportUrl("?format=json"));

    expect(response.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.openapi.json"',
    );
    expect(await response.json()).toEqual(parse(yaml));
  });

  it("exports a single page", async () => {
    const response = await t.request(
      "GET",
      exportUrl(`?format=json&page=${fixture.stockListPageId}`),
    );

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.stock-list.openapi.json"',
    );
    const doc = (await response.json()) as {
      info: { title: string };
      paths: Record<string, Record<string, unknown>>;
      components: { schemas: Record<string, unknown> };
    };
    expect(doc.info.title).toBe("Inventory App: Stock list");
    expect(Object.keys(doc.paths)).toEqual(["/stocks", "/stocks/{sku}"]);
    expect(Object.keys(doc.paths["/stocks/{sku}"] ?? {})).toEqual(["delete"]);
    expect(Object.keys(doc.components.schemas)).toEqual(["Category", "Stock"]);
  });

  it("reports warnings and validity", async () => {
    const response = await t.request(
      "GET",
      `/api/projects/${fixture.projectId}/export/report`,
    );

    expect(response.status).toBe(200);
    const report = (await response.json()) as {
      valid: boolean;
      errors: string[];
      warnings: { message: string }[];
    };
    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings.map((warning) => warning.message)).toEqual([
      "GET /health: the 200 response has no example",
      "GET /health isn't used by any page",
    ]);
  });

  it("refuses to export a contract that isn't valid", async () => {
    await t.request("POST", `/api/projects/${fixture.projectId}/models`, {
      name: "Broken",
      schema: { type: "strng" },
    });

    const report = (await (
      await t.request("GET", `/api/projects/${fixture.projectId}/export/report`)
    ).json()) as { valid: boolean; errors: string[] };
    const response = await t.request("GET", exportUrl("?format=yaml"));

    expect(report).toMatchObject({
      valid: false,
      errors: [
        "Model Broken: /type must be equal to one of the allowed values",
      ],
    });
    expect(response.status).toBe(422);
  });

  it("rejects unknown formats, pages, and projects", async () => {
    expect((await t.request("GET", exportUrl("?format=xml"))).status).toBe(400);
    expect((await t.request("GET", exportUrl("?page=nope"))).status).toBe(404);
    expect(
      (await t.request("GET", "/api/projects/nope/export/openapi")).status,
    ).toBe(404);
  });

  describe("with Prism as a mock server", () => {
    async function mockClient() {
      const doc = (await (
        await t.request("GET", exportUrl("?format=json"))
      ).json()) as Record<string, unknown>;
      const operations = await prismHttp.getHttpOperationsFromSpec(doc);
      return prismClient.createClientFromOperations(operations, {
        mock: { dynamic: false },
        validateRequest: true,
        validateResponse: true,
        checkSecurity: true,
        errors: false,
        upstreamProxy: undefined,
        isProxy: false,
        logger: silentLogger as never,
      });
    }

    // The in-process client throws Prism's problem responses (422, 401, …)
    // instead of returning them, so those are checked as rejections.

    const auth = { authorization: "Bearer token" };

    it("returns the first example by default and others by name", async () => {
      const client = await mockClient();

      const first = await client.get("/stocks", { headers: auth });
      const empty = await client.get(
        "/stocks",
        { headers: auth },
        { mock: { dynamic: false, exampleKey: "empty" } },
      );

      expect(first.status).toBe(200);
      expect(first.data).toEqual(fixture.items);
      expect(first.violations.output).toEqual([]);
      expect(empty.data).toEqual([]);
    });

    it("returns error responses with their examples", async () => {
      const client = await mockClient();

      const response = await client.get(
        "/stocks/SKU-999",
        { headers: auth },
        { mock: { dynamic: false, code: 404 } },
      );

      expect(response.status).toBe(404);
      expect(response.data).toEqual({ message: "No item SKU-999" });
    });

    it("validates request bodies against the contract", async () => {
      const client = await mockClient();
      const headers = { ...auth, "content-type": "application/json" };

      const valid = await client.post("/stocks", fixture.items[1], { headers });

      expect(valid.status).toBe(201);
      expect(valid.violations.input).toEqual([]);
      await expect(
        client.post("/stocks", { name: "No SKU" }, { headers }),
      ).rejects.toMatchObject({ status: 422 });
    });

    it("enforces each endpoint's security", async () => {
      const client = await mockClient();

      const publicEndpoint = await client.post(
        "/auth/login",
        { email: "ana@example.com", password: "correct-horse" },
        { headers: { "content-type": "application/json" } },
      );

      expect(publicEndpoint.status).toBe(200);
      await expect(client.get("/stocks")).rejects.toMatchObject({
        status: 401,
      });
      await expect(
        client.delete("/stocks/SKU-001", { headers: auth }),
      ).rejects.toMatchObject({ status: 401 });
      const withApiKey = await client.delete("/stocks/SKU-001", {
        headers: { "x-api-key": "secret" },
      });
      expect(withApiKey.status).toBe(204);
    });
  });
});
