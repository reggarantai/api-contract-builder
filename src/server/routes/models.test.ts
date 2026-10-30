import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import {
  type Model,
  modelSchema,
  modelSummarySchema,
} from "../../shared/models";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

describe("models API", () => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;

  beforeEach(async () => {
    t = createTestApp();
    const response = await t.request("POST", "/api/projects", {
      name: "Shop",
    });
    projectId = projectSchema.parse(await response.json()).id;
  });

  afterEach(() => {
    t.close();
  });

  const modelsUrl = (id = projectId) => `/api/projects/${id}/models`;

  async function createModel(body: Record<string, unknown>): Promise<Model> {
    const response = await t.request("POST", modelsUrl(), body);
    expect(response.status).toBe(201);
    return modelSchema.parse(await response.json());
  }

  async function errorOf(response: Response) {
    return apiErrorSchema.parse(await response.json());
  }

  it("creates a model with an empty object schema by default", async () => {
    const model = await createModel({ name: "User" });

    expect(model).toMatchObject({
      projectId,
      name: "User",
      description: "",
      schema: { type: "object", properties: {} },
    });
  });

  it("lists models of the project sorted by name", async () => {
    await createModel({ name: "order" });
    await createModel({ name: "Customer" });

    const response = await t.request("GET", modelsUrl());

    const models = modelSummarySchema.array().parse(await response.json());
    expect(models.map((model) => model.name)).toEqual(["Customer", "order"]);
  });

  it("rejects names that differ only in case", async () => {
    await createModel({ name: "User" });

    const response = await t.request("POST", modelsUrl(), { name: "user" });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).issues?.[0]?.path).toBe("name");
  });

  it("rejects invalid names and non-object schemas", async () => {
    const response = await t.request("POST", modelsUrl(), {
      name: "Has spaces",
      schema: [1, 2],
    });

    expect(response.status).toBe(400);
    const paths = (await errorOf(response)).issues?.map((issue) => issue.path);
    expect(paths).toEqual(["name", "schema"]);
  });

  it("accepts references to models of the same project", async () => {
    const user = await createModel({ name: "User" });

    const order = await createModel({
      name: "Order",
      schema: {
        type: "object",
        properties: { customer: { $ref: `model:${user.id}` } },
      },
    });

    expect(order.schema).toEqual({
      type: "object",
      properties: { customer: { $ref: `model:${user.id}` } },
    });
  });

  it("rejects unknown and unsupported references", async () => {
    const response = await t.request("POST", modelsUrl(), {
      name: "Order",
      schema: {
        type: "object",
        properties: {
          a: { $ref: "model:missing" },
          b: { $ref: "#/components/schemas/User" },
          c: { $ref: "https://example.com/schema.json" },
        },
      },
    });

    expect(response.status).toBe(400);
    const messages = (await errorOf(response)).issues?.map(
      (issue) => issue.message,
    );
    expect(messages).toHaveLength(3);
  });

  it("allows a model to reference itself", async () => {
    const category = await createModel({ name: "Category" });

    const response = await t.request("PATCH", `${modelsUrl()}/${category.id}`, {
      schema: {
        type: "object",
        properties: {
          children: { type: "array", items: { $ref: `model:${category.id}` } },
        },
      },
    });

    expect(response.status).toBe(200);
  });

  it("updates a model and marks the project as changed", async () => {
    const model = await createModel({ name: "User" });
    const before = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );

    const response = await t.request("PATCH", `${modelsUrl()}/${model.id}`, {
      name: "Account",
      description: "A signed-up user",
    });

    expect(response.status).toBe(200);
    expect(modelSchema.parse(await response.json())).toMatchObject({
      name: "Account",
      description: "A signed-up user",
      schema: model.schema,
    });
    const after = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("refuses to delete a model that other models use", async () => {
    const user = await createModel({ name: "User" });
    await createModel({
      name: "Order",
      schema: { $ref: `model:${user.id}` },
    });

    const response = await t.request("DELETE", `${modelsUrl()}/${user.id}`);

    expect(response.status).toBe(409);
    expect((await errorOf(response)).error).toBe(
      "User is used by Order. Remove those references first.",
    );
  });

  it("deletes a model", async () => {
    const model = await createModel({ name: "User" });

    const deleted = await t.request("DELETE", `${modelsUrl()}/${model.id}`);
    const reloaded = await t.request("GET", `${modelsUrl()}/${model.id}`);

    expect(deleted.status).toBe(204);
    expect(reloaded.status).toBe(404);
  });

  it("does not expose models through another project", async () => {
    const model = await createModel({ name: "User" });
    const other = projectSchema.parse(
      await (
        await t.request("POST", "/api/projects", { name: "Other" })
      ).json(),
    );

    const response = await t.request(
      "GET",
      `${modelsUrl(other.id)}/${model.id}`,
    );

    expect(response.status).toBe(404);
  });

  it("deletes models together with their project", async () => {
    await createModel({ name: "User" });

    await t.request("DELETE", `/api/projects/${projectId}`);
    const response = await t.request("GET", modelsUrl());

    expect(response.status).toBe(404);
    expect(
      t.db.$client.prepare("select count(*) as count from models").get(),
    ).toEqual({ count: 0 });
  });
});
