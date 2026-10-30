import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
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
      ["Registration", 2, 1],
      ["Verify email", 1, 2],
      ["Forgot password", 1, 1],
      ["Reset password", 1, 1],
      ["App shell", 1, 4],
      ["Stock list", 1, 3],
      ["Stock item", 2, 3],
      ["Add or edit stock item", 1, 4],
    ]);
    const endpoints = await get(`${base}/endpoints`, (data) =>
      endpointSummarySchema.array().parse(data),
    );
    expect(
      endpoints.map((endpoint) => `${endpoint.method} ${endpoint.path}`),
    ).toEqual([
      "POST /auth/forgot-password",
      "POST /auth/login",
      "POST /auth/logout",
      "POST /auth/refresh",
      "POST /auth/register",
      "POST /auth/reset-password",
      "POST /auth/verify-email",
      "POST /auth/verify-email/resend",
      "GET /categories",
      "GET /me",
      "GET /stock-items",
      "POST /stock-items",
      "GET /stock-items/{itemId}",
      "PATCH /stock-items/{itemId}",
      "DELETE /stock-items/{itemId}",
      "GET /stock-items/{itemId}/movements",
      "POST /stock-items/{itemId}/movements",
    ]);
    // Some endpoints serve more than one page.
    const pageCount = (label: string) =>
      endpoints.find(
        (endpoint) => `${endpoint.method} ${endpoint.path}` === label,
      )?.pageIds.length;
    expect(pageCount("GET /categories")).toBe(2);
    expect(pageCount("GET /stock-items/{itemId}")).toBe(2);
    expect(pageCount("POST /auth/verify-email/resend")).toBe(2);
    const models = await get(`${base}/models`, (data) =>
      modelSummarySchema.array().parse(data),
    );
    expect(models.map((model) => model.name)).toEqual([
      "Category",
      "PageMeta",
      "Problem",
      "Session",
      "StockItem",
      "StockItemInput",
      "StockItemUpdate",
      "StockMovement",
      "StockMovementInput",
      "User",
      "ValidationProblem",
    ]);
  });

  it("exports as valid OpenAPI without warnings", async () => {
    const project = await createSample();

    const report = await get(
      `/api/projects/${project.id}/export/report`,
      (data) => exportReportSchema.parse(data),
    );

    expect(report.valid).toBe(true);
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it("can be created more than once", async () => {
    await createSample();
    const second = await createSample();

    expect(second.slug).toBe("inventory-app-2");
  });

  // The sample is meant to show a production contract, so these check the
  // conventions it promises on every operation, not just the ones in the
  // golden files someone happened to read.
  describe("follows its own conventions", () => {
    type Schema = {
      $ref?: string;
      enum?: unknown[];
      properties?: Record<string, Schema>;
    };
    type Header = { required?: boolean; schema: Schema };
    type Response = {
      headers?: Record<string, Header>;
      content?: Record<string, { schema: Schema }>;
    };
    type Operation = {
      security?: Record<string, string[]>[];
      parameters?: { name: string; in: string; required?: boolean }[];
      requestBody?: { content: Record<string, unknown> };
      responses: Record<string, Response>;
    };
    let app: ReturnType<typeof createTestApp>;
    let operations: { label: string; method: string; op: Operation }[];

    beforeAll(async () => {
      app = createTestApp();
      const project = projectSchema.parse(
        await (await app.request("POST", "/api/samples")).json(),
      );
      const doc = (await (
        await app.request(
          "GET",
          `/api/projects/${project.id}/export/openapi?format=json`,
        )
      ).json()) as { paths: Record<string, Record<string, Operation>> };
      operations = Object.entries(doc.paths).flatMap(([path, item]) =>
        Object.entries(item).map(([method, op]) => ({
          label: `${method.toUpperCase()} ${path}`,
          method,
          op,
        })),
      );
    });

    afterAll(() => {
      app.close();
    });

    /** Labels of the operations for which `check` is false. */
    function failing(check: (op: Operation, method: string) => boolean) {
      return operations
        .filter(({ op, method }) => !check(op, method))
        .map(({ label }) => label);
    }
    const statuses = (op: Operation) => Object.keys(op.responses);
    const queryOrHeader = (op: Operation) =>
      (op.parameters ?? []).filter(
        (p) => p.in === "query" || p.in === "header",
      );
    const model = (name: string) => `#/components/schemas/${name}`;

    it("answers errors as problem details, with per-field errors on 422", () => {
      expect(
        failing((op) =>
          Object.entries(op.responses)
            .filter(([status]) => Number(status) >= 400)
            .every(([status, response]) => {
              const content = response.content ?? {};
              return (
                Object.keys(content).join() === "application/problem+json" &&
                content["application/problem+json"]?.schema.$ref ===
                  model(status === "422" ? "ValidationProblem" : "Problem")
              );
            }),
        ),
      ).toEqual([]);
    });

    it("can answer 422 wherever there's a request body", () => {
      expect(
        failing((op) => !op.requestBody || statuses(op).includes("422")),
      ).toEqual([]);
    });

    it("answers 400 wherever query or header parameters can be invalid", () => {
      expect(
        failing(
          (op) =>
            queryOrHeader(op).length === 0 || statuses(op).includes("400"),
        ),
      ).toEqual([]);
    });

    it("keeps 401 for credentials the request must send, with a bearer challenge", () => {
      const isPublic = (op: Operation) => op.security?.length === 0;
      const usesBearer = (op: Operation) =>
        op.security === undefined ||
        op.security.some((requirement) => "bearerAuth" in requirement);

      expect(
        failing((op) =>
          isPublic(op)
            ? !statuses(op).includes("401")
            : statuses(op).includes("401"),
        ),
      ).toEqual([]);
      expect(
        failing(
          (op) =>
            !usesBearer(op) ||
            op.responses["401"]?.headers?.["WWW-Authenticate"]?.required ===
              true,
        ),
      ).toEqual([]);
    });

    it("says when to retry after a 429", () => {
      expect(
        failing(
          (op) =>
            !op.responses["429"] ||
            op.responses["429"].headers?.["Retry-After"]?.required === true,
        ),
      ).toEqual([]);
    });

    it("takes an Idempotency-Key on every create", () => {
      expect(
        failing(
          (op) =>
            !op.responses["201"] ||
            (op.parameters ?? []).some(
              (p) =>
                p.in === "header" &&
                p.name === "Idempotency-Key" &&
                p.required === true,
            ),
        ),
      ).toEqual([]);
    });

    it("doesn't let token responses be cached", () => {
      expect(
        failing((op) =>
          Object.values(op.responses)
            .filter(
              (response) =>
                response.content?.["application/json"]?.schema.$ref ===
                model("Session"),
            )
            .every(
              (response) =>
                response.headers?.["Cache-Control"]?.required === true &&
                JSON.stringify(
                  response.headers["Cache-Control"].schema.enum,
                ) === '["no-store"]',
            ),
        ),
      ).toEqual([]);
    });

    it("pages every list that has a meta block", () => {
      expect(
        failing((op) => {
          const list =
            op.responses["200"]?.content?.["application/json"]?.schema
              .properties?.meta?.$ref === model("PageMeta");
          const names = queryOrHeader(op).map((p) => p.name);
          return (
            !list || (names.includes("page") && names.includes("pageSize"))
          );
        }),
      ).toEqual([]);
    });

    it("updates with JSON Merge Patch", () => {
      expect(
        failing(
          (op, method) =>
            method !== "patch" ||
            Object.keys(op.requestBody?.content ?? {}).join() ===
              "application/merge-patch+json",
        ),
      ).toEqual([]);
    });

    it("doesn't show which emails have accounts", () => {
      expect(
        failing((op) => {
          const takesEmail = JSON.stringify(op.requestBody ?? {}).includes(
            '"format":"email"',
          );
          return (
            !takesEmail ||
            !statuses(op).some((status) => status === "404" || status === "409")
          );
        }),
      ).toEqual([]);
    });
  });
});
