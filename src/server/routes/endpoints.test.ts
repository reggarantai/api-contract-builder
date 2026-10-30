import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import {
  type Endpoint,
  endpointResponseFieldsSchema,
  endpointSummarySchema,
} from "../../shared/endpoints";
import { modelSchema } from "../../shared/models";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

const bearer = {
  id: "bearer",
  key: "bearerAuth",
  type: "bearer",
  bearerFormat: "JWT",
  description: "",
};

describe("endpoints API", () => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;

  beforeEach(async () => {
    t = createTestApp();
    const response = await t.request("POST", "/api/projects", { name: "Shop" });
    projectId = projectSchema.parse(await response.json()).id;
  });

  afterEach(() => {
    t.close();
  });

  const endpointsUrl = (id = projectId) => `/api/projects/${id}/endpoints`;

  async function createEndpoint(
    body: Record<string, unknown>,
  ): Promise<Endpoint> {
    const response = await t.request("POST", endpointsUrl(), body);
    expect(response.status).toBe(201);
    return endpointResponseFieldsSchema.parse(await response.json());
  }

  async function patchEndpoint(id: string, body: Record<string, unknown>) {
    return t.request("PATCH", `${endpointsUrl()}/${id}`, body);
  }

  async function errorOf(response: Response) {
    return apiErrorSchema.parse(await response.json());
  }

  async function createModel(name: string) {
    const response = await t.request(
      "POST",
      `/api/projects/${projectId}/models`,
      {
        name,
      },
    );
    return modelSchema.parse(await response.json());
  }

  it("creates an endpoint with defaults", async () => {
    const endpoint = await createEndpoint({
      method: "GET",
      path: "/stocks/{id}",
      summary: "Get a stock item",
    });

    expect(endpoint).toMatchObject({
      projectId,
      method: "GET",
      path: "/stocks/{id}",
      summary: "Get a stock item",
      operationId: "",
      status: "draft",
      security: { type: "default" },
      requestBody: null,
      parameters: {
        path: {
          type: "object",
          properties: { id: { type: "string" } },
          required: ["id"],
        },
      },
      responses: [{ status: "200", description: "OK" }],
    });
  });

  it("lists endpoints by path, then method", async () => {
    await createEndpoint({ method: "POST", path: "/stocks" });
    await createEndpoint({ method: "GET", path: "/stocks/{id}" });
    await createEndpoint({ method: "GET", path: "/stocks" });
    await createEndpoint({ method: "DELETE", path: "/auth/session" });

    const response = await t.request("GET", endpointsUrl());

    const endpoints = endpointSummarySchema
      .array()
      .parse(await response.json());
    expect(endpoints.map((e) => `${e.method} ${e.path}`)).toEqual([
      "DELETE /auth/session",
      "GET /stocks",
      "POST /stocks",
      "GET /stocks/{id}",
    ]);
  });

  it("rejects the same method and path, even with other parameter names", async () => {
    await createEndpoint({ method: "GET", path: "/stocks/{id}" });

    const response = await t.request("POST", endpointsUrl(), {
      method: "GET",
      path: "/stocks/{stockId}",
    });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).issues).toEqual([
      { path: "path", message: "GET /stocks/{id} already exists" },
    ]);
  });

  it("allows the same path with another method", async () => {
    await createEndpoint({ method: "GET", path: "/stocks" });

    const response = await t.request("POST", endpointsUrl(), {
      method: "POST",
      path: "/stocks",
    });

    expect(response.status).toBe(201);
  });

  it("reports an invalid path", async () => {
    const response = await t.request("POST", endpointsUrl(), {
      method: "GET",
      path: "stocks",
    });

    expect(response.status).toBe(400);
    expect((await errorOf(response)).issues).toEqual([
      { path: "path", message: "Path must start with /" },
    ]);
  });

  it("updates an endpoint and checks the merged result", async () => {
    const endpoint = await createEndpoint({
      method: "GET",
      path: "/stocks/{id}",
    });

    const updated = await patchEndpoint(endpoint.id, {
      summary: "Get a stock item",
      status: "review",
    });
    expect(updated.status).toBe(200);
    expect(
      endpointResponseFieldsSchema.parse(await updated.json()),
    ).toMatchObject({
      summary: "Get a stock item",
      status: "review",
      path: "/stocks/{id}",
    });

    // Changing the path alone leaves the path parameters out of sync.
    const invalid = await patchEndpoint(endpoint.id, { path: "/stocks/{sku}" });
    expect(invalid.status).toBe(400);
    expect((await errorOf(invalid)).issues?.map((issue) => issue.path)).toEqual(
      ["parameters.path"],
    );
  });

  it("requires unique operation IDs but allows many empty ones", async () => {
    const first = await createEndpoint({ method: "GET", path: "/a" });
    const second = await createEndpoint({ method: "GET", path: "/b" });
    await createEndpoint({ method: "GET", path: "/c" });

    expect(
      (await patchEndpoint(first.id, { operationId: "getThing" })).status,
    ).toBe(200);
    const duplicate = await patchEndpoint(second.id, {
      operationId: "getThing",
    });

    expect(duplicate.status).toBe(409);
    expect((await errorOf(duplicate)).issues).toEqual([
      { path: "operationId", message: "Already used by GET /a" },
    ]);
  });

  it("requires security schemes of the project", async () => {
    const endpoint = await createEndpoint({ method: "GET", path: "/stocks" });

    const unknown = await patchEndpoint(endpoint.id, {
      security: { type: "schemes", schemeIds: ["missing"] },
    });
    expect(unknown.status).toBe(400);
    expect((await errorOf(unknown)).issues?.map((issue) => issue.path)).toEqual(
      ["security.schemeIds"],
    );

    await t.request("PATCH", `/api/projects/${projectId}`, {
      securitySchemes: [bearer],
    });
    const known = await patchEndpoint(endpoint.id, {
      security: { type: "schemes", schemeIds: ["bearer"] },
    });
    expect(known.status).toBe(200);
  });

  it("requires model references to exist, wherever they are", async () => {
    const endpoint = await createEndpoint({ method: "GET", path: "/stocks" });
    const [response] = endpoint.responses;

    const result = await patchEndpoint(endpoint.id, {
      parameters: {
        ...endpoint.parameters,
        query: {
          type: "object",
          properties: { filter: { $ref: "model:missing" } },
        },
      },
      responses: [
        {
          ...response,
          body: {
            contentType: "application/json",
            schema: { type: "array", items: { $ref: "model:gone" } },
            examples: [],
          },
        },
      ],
    });

    expect(result.status).toBe(400);
    expect((await errorOf(result)).issues?.map((issue) => issue.path)).toEqual([
      "parameters.query",
      "responses.0.body.schema",
    ]);
  });

  it("deletes an endpoint", async () => {
    const endpoint = await createEndpoint({ method: "GET", path: "/stocks" });

    const deleted = await t.request(
      "DELETE",
      `${endpointsUrl()}/${endpoint.id}`,
    );
    const reloaded = await t.request("GET", `${endpointsUrl()}/${endpoint.id}`);

    expect(deleted.status).toBe(204);
    expect(reloaded.status).toBe(404);
  });

  it("keeps endpoints inside their project", async () => {
    const endpoint = await createEndpoint({ method: "GET", path: "/stocks" });
    const other = projectSchema.parse(
      await (
        await t.request("POST", "/api/projects", { name: "Other" })
      ).json(),
    );

    const response = await t.request(
      "GET",
      `${endpointsUrl(other.id)}/${endpoint.id}`,
    );

    expect(response.status).toBe(404);
  });

  it("marks the project as changed", async () => {
    const before = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );

    await createEndpoint({ method: "GET", path: "/stocks" });

    const after = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("is deleted with its project", async () => {
    await createEndpoint({ method: "GET", path: "/stocks" });

    await t.request("DELETE", `/api/projects/${projectId}`);

    expect(
      t.db.$client.prepare("select count(*) as count from endpoints").get(),
    ).toEqual({ count: 0 });
  });

  describe("references from other features", () => {
    it("blocks deleting a model an endpoint uses", async () => {
      const user = await createModel("User");
      const endpoint = await createEndpoint({
        method: "GET",
        path: "/users/{id}",
      });
      const [response] = endpoint.responses;
      await patchEndpoint(endpoint.id, {
        responses: [
          {
            ...response,
            body: {
              contentType: "application/json",
              schema: { $ref: `model:${user.id}` },
              examples: [],
            },
          },
        ],
      });

      const deleted = await t.request(
        "DELETE",
        `/api/projects/${projectId}/models/${user.id}`,
      );

      expect(deleted.status).toBe(409);
      expect((await errorOf(deleted)).error).toBe(
        "User is used by GET /users/{id}. Remove those references first.",
      );
    });

    it("blocks removing a security scheme an endpoint uses", async () => {
      await t.request("PATCH", `/api/projects/${projectId}`, {
        securitySchemes: [bearer],
      });
      const endpoint = await createEndpoint({ method: "GET", path: "/stocks" });
      await patchEndpoint(endpoint.id, {
        security: { type: "schemes", schemeIds: ["bearer"] },
      });

      const removed = await t.request("PATCH", `/api/projects/${projectId}`, {
        securitySchemes: [],
      });

      expect(removed.status).toBe(409);
      expect((await errorOf(removed)).issues).toEqual([
        {
          path: "securitySchemes",
          message: "bearerAuth is used by GET /stocks",
        },
      ]);
    });
  });
});
