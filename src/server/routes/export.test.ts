import fs from "node:fs";
import path from "node:path";
import prismHttp from "@stoplight/prism-http";
import prismClient from "@stoplight/prism-http/dist/client.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { SAMPLE_STOCK_ITEMS_PAGE } from "../samples/inventory";
import { buildSample, createTestApp } from "../test-utils";

const GOLDEN = path.resolve("test/golden/inventory.openapi.yaml");

/** Prism logs every request; tests don't need to see that. */
const silentLogger: unknown = new Proxy(
  {},
  { get: (_target, key) => (key === "child" ? () => silentLogger : () => {}) },
);

describe("export API", () => {
  let t: ReturnType<typeof createTestApp>;
  let fixture: Awaited<ReturnType<typeof buildSample>>;

  beforeEach(async () => {
    t = createTestApp();
    fixture = await buildSample(t);
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
      exportUrl(`?format=json&page=${fixture.pageIds.stockList}`),
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
    expect(Object.keys(doc.paths)).toEqual([
      "/categories",
      "/stock-items",
      "/stock-items/{itemId}",
    ]);
    expect(Object.keys(doc.paths["/stock-items"] ?? {})).toEqual(["get"]);
    expect(Object.keys(doc.paths["/stock-items/{itemId}"] ?? {})).toEqual([
      "delete",
    ]);
    // Errors are Problems; the list pages with PageMeta.
    expect(Object.keys(doc.components.schemas)).toEqual([
      "Category",
      "PageMeta",
      "Problem",
      "StockItem",
    ]);
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
    expect(report.warnings).toEqual([]);
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

    // The in-process client throws Prism's own problem responses instead of
    // returning them; where the contract has the status, Prism answers with
    // the contract's example. Headers keep the contract's names and values.
    const header = (response: { headers?: object }, name: string) =>
      Object.entries(response.headers ?? {}).find(
        ([key]) => key.toLowerCase() === name,
      )?.[1] as unknown;

    const auth = { authorization: "Bearer token" };
    const createHeaders = {
      ...auth,
      "content-type": "application/json",
      "idempotency-key": "3f1d8a52-6b0e-4c1a-9d7e-2b4c6a8e0f13",
    };
    const itemId = SAMPLE_STOCK_ITEMS_PAGE.data[0].id;
    const newItem = {
      sku: "LBL-100",
      name: "Shipping labels, 100 x 150 mm",
      categoryId: SAMPLE_STOCK_ITEMS_PAGE.data[0].category.id,
      unit: "box",
    };

    it("returns the first example by default and others by name", async () => {
      const client = await mockClient();

      const first = await client.get("/stock-items", { headers: auth });
      const empty = await client.get(
        "/stock-items",
        { headers: auth },
        { mock: { dynamic: false, exampleKey: "empty" } },
      );

      expect(first.status).toBe(200);
      expect(first.data).toEqual(SAMPLE_STOCK_ITEMS_PAGE);
      expect(first.violations.output).toEqual([]);
      expect(empty.data).toMatchObject({ data: [], meta: { totalItems: 0 } });
    });

    it("returns errors as problem details", async () => {
      const client = await mockClient();

      const response = await client.delete(
        `/stock-items/${itemId}`,
        { headers: auth },
        { mock: { dynamic: false, code: 409 } },
      );

      expect(response.status).toBe(409);
      expect(header(response, "content-type")).toBe("application/problem+json");
      expect(response.data).toMatchObject({
        type: "https://api.inventory.example/problems/item-has-stock",
        status: 409,
      });
      expect(response.violations.output).toEqual([]);
    });

    it("returns the response headers the contract describes", async () => {
      const client = await mockClient();

      const created = await client.post("/stock-items", newItem, {
        headers: createHeaders,
      });
      const signedIn = await client.post(
        "/auth/login",
        { email: "ana@example.com", password: "correct-horse-battery" },
        { headers: { "content-type": "application/json" } },
      );
      const limited = await client.post(
        "/auth/login",
        { email: "ana@example.com", password: "correct-horse-battery" },
        { headers: { "content-type": "application/json" } },
        { mock: { dynamic: false, code: 429 } },
      );

      expect(created.status).toBe(201);
      expect(header(created, "location")).toMatch(/^\/v1\/stock-items\//);
      expect(header(signedIn, "set-cookie")).toMatch(
        /^refresh_token=.+; HttpOnly; Secure/,
      );
      expect(header(signedIn, "cache-control")).toBe("no-store");
      expect(limited.status).toBe(429);
      expect(header(limited, "retry-after")).toBe(900);
    });

    it("validates requests against the contract", async () => {
      const client = await mockClient();

      const valid = await client.post("/stock-items", newItem, {
        headers: createHeaders,
      });

      expect(valid.status).toBe(201);
      expect(valid.violations.input).toEqual([]);
      // The contract defines its own 422, so Prism answers with that example.
      const invalid = await client.post(
        "/stock-items",
        { ...newItem, unit: "crate" },
        { headers: createHeaders },
      );
      expect(invalid.status).toBe(422);
      expect(invalid.violations.input).not.toEqual([]);
      expect(invalid.data).toMatchObject({
        type: "https://api.inventory.example/problems/validation-failed",
        errors: [expect.objectContaining({ pointer: expect.any(String) })],
      });
      // The API answers 400 without the key; Prism prefers a 422 for any
      // invalid request, so this only checks that the key is required.
      const withoutKey = await client.post("/stock-items", newItem, {
        headers: { ...auth, "content-type": "application/json" },
      });
      expect(withoutKey.violations.input).not.toEqual([]);
    });

    it("enforces each endpoint's security", async () => {
      const client = await mockClient();

      const publicEndpoint = await client.post(
        "/auth/login",
        { email: "ana@example.com", password: "correct-horse-battery" },
        { headers: { "content-type": "application/json" } },
      );

      expect(publicEndpoint.status).toBe(200);
      const signedOut = await client.get("/stock-items");
      expect(signedOut.status).toBe(401);
      expect(signedOut.data).toMatchObject({
        type: "https://api.inventory.example/problems/token-expired",
      });
      expect(header(signedOut, "www-authenticate")).toMatch(
        /^Bearer realm="inventory"/,
      );
      // Refreshing takes the cookie, not the access token.
      const withoutCookie = await client.post("/auth/refresh", undefined, {
        headers: auth,
      });
      expect(withoutCookie.status).toBe(401);
      const refreshed = await client.post("/auth/refresh", undefined, {
        headers: { cookie: "refresh_token=rt_1" },
      });
      expect(refreshed.status).toBe(200);
    });
  });
});
