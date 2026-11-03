import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { apiErrorSchema } from "../../shared/api-error";
import {
  type Endpoint,
  type EndpointResponse,
  endpointResponseFieldsSchema,
} from "../../shared/endpoints";
import { type ErrorType, errorTypeSchema } from "../../shared/error-types";
import { modelSchema } from "../../shared/models";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

const PROBLEMS = "https://api.example.com/problems/";

describe("error types API", () => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;
  let problemId: string;

  beforeEach(async () => {
    t = createTestApp();
    const project = await t.request("POST", "/api/projects", { name: "Shop" });
    projectId = projectSchema.parse(await project.json()).id;
    const model = await t.request("POST", `/api/projects/${projectId}/models`, {
      name: "Problem",
    });
    problemId = modelSchema.parse(await model.json()).id;
  });

  afterEach(() => {
    t.close();
  });

  const errorsUrl = (id = projectId) => `/api/projects/${id}/error-types`;

  const problemBody = (name: string, status: number, title: string) => ({
    contentType: "application/problem+json",
    schema: { $ref: `model:${problemId}` },
    example: { type: `${PROBLEMS}${name}`, title, status },
  });

  async function createError(
    name: string,
    status: string,
    changes: Record<string, unknown> = {},
  ): Promise<ErrorType> {
    const response = await t.request("POST", errorsUrl(), {
      name,
      status,
      title: name,
      body: problemBody(name, Number(status), name),
      ...changes,
    });
    expect(response.status).toBe(201);
    return errorTypeSchema.parse(await response.json());
  }

  async function getError(id: string) {
    const response = await t.request("GET", `${errorsUrl()}/${id}`);
    expect(response.status).toBe(200);
    return errorTypeSchema.parse(await response.json());
  }

  async function errorOf(response: Response) {
    return apiErrorSchema.parse(await response.json());
  }

  const endpointsUrl = () => `/api/projects/${projectId}/endpoints`;

  /** An endpoint whose only response answers `status` with these errors. */
  async function endpointAnswering(
    method: string,
    path: string,
    status: string,
    errors: EndpointResponse["errors"],
  ): Promise<Endpoint> {
    const created = await t.request("POST", endpointsUrl(), { method, path });
    const endpoint = endpointResponseFieldsSchema.parse(await created.json());
    const updated = await t.request(
      "PATCH",
      `${endpointsUrl()}/${endpoint.id}`,
      {
        responses: [
          ...endpoint.responses,
          {
            id: "error",
            status,
            description: "Error",
            headers: noHeaders,
            body: null,
            errors,
          },
        ],
      },
    );
    expect(updated.status).toBe(200);
    return endpointResponseFieldsSchema.parse(await updated.json());
  }

  const noHeaders = { type: "object", properties: {} };

  it("creates an error type with no description or headers by default", async () => {
    const response = await t.request("POST", errorsUrl(), {
      name: "gone",
      status: "410",
      title: "Gone for good",
      body: problemBody("gone", 410, "Gone for good"),
    });

    expect(response.status).toBe(201);
    expect(errorTypeSchema.parse(await response.json())).toMatchObject({
      projectId,
      name: "gone",
      status: "410",
      title: "Gone for good",
      description: "",
      headers: noHeaders,
      body: problemBody("gone", 410, "Gone for good"),
      endpointIds: [],
    });
  });

  it("lists errors by status, then name", async () => {
    await createError("sku-taken", "409");
    await createError("Not-found", "404");
    await createError("request-in-progress", "409");
    await createError("item-has-stock", "409");

    const response = await t.request("GET", errorsUrl());

    const errors = errorTypeSchema.array().parse(await response.json());
    expect(errors.map((error) => error.name)).toEqual([
      "Not-found",
      "item-has-stock",
      "request-in-progress",
      "sku-taken",
    ]);
  });

  it("rejects names that differ only in case", async () => {
    await createError("sku-taken", "409");

    const response = await t.request("POST", errorsUrl(), {
      name: "SKU-taken",
      status: "409",
      title: "Taken",
      body: problemBody("SKU-taken", 409, "Taken"),
    });

    expect(response.status).toBe(409);
    expect((await errorOf(response)).issues).toEqual([
      { path: "name", message: "Already used by another error type" },
    ]);
  });

  it("rejects invalid fields, and requires a body", async () => {
    const response = await t.request("POST", errorsUrl(), {
      name: "sku taken",
      status: "200",
      title: "",
      headers: {
        type: "object",
        properties: { "content-type": { type: "string" } },
      },
    });

    expect(response.status).toBe(400);
    const paths = (await errorOf(response)).issues?.map((issue) => issue.path);
    expect(paths).toEqual(["name", "status", "title", "headers", "body"]);
  });

  it("requires the models its schemas reference to exist", async () => {
    const response = await t.request("POST", errorsUrl(), {
      name: "slow-down",
      status: "429",
      title: "Slow down",
      headers: {
        type: "object",
        properties: { "Retry-After": { $ref: "model:nope" } },
      },
      body: {
        ...problemBody("slow-down", 429, "Slow down"),
        schema: { $ref: "model:gone" },
      },
    });

    expect(response.status).toBe(400);
    expect((await errorOf(response)).issues).toEqual([
      {
        path: "headers",
        message: "References a model that doesn't exist: model:nope",
      },
      {
        path: "body.schema",
        message: "References a model that doesn't exist: model:gone",
      },
    ]);
  });

  it("saves an example nested up to 256 levels deep, and refuses a deeper one", async () => {
    const nested = (levels: number) => {
      let value: unknown = 0;
      for (let level = 0; level < levels; level++) {
        value = [value];
      }
      return value;
    };
    const body = (levels: number) => ({
      ...problemBody("deep", 400, "Deep"),
      example: nested(levels),
    });

    const created = await createError("deep", "400", { body: body(256) });
    const refused = await t.request("POST", errorsUrl(), {
      name: "deeper",
      status: "400",
      title: "Deeper",
      body: body(257),
    });
    expect(refused.status).toBe(400);
    const tooDeep = [
      {
        path: "body.example",
        message: "This example is nested more than 256 levels deep",
      },
    ];
    expect((await errorOf(refused)).issues).toEqual(tooDeep);
    const changed = await t.request("PATCH", `${errorsUrl()}/${created.id}`, {
      body: body(257),
      revision: created.revision,
    });
    expect(changed.status).toBe(400);
    expect((await errorOf(changed)).issues).toEqual(tooDeep);
  });

  it("keeps saving an example nested deeper than 256 levels from before the limit, while it stays as it was", async () => {
    const nested = (levels: number) => {
      let value: unknown = 0;
      for (let level = 0; level < levels; level++) {
        value = [value];
      }
      return value;
    };
    const created = await createError("old", "400");
    const old = { ...problemBody("old", 400, "Old"), example: nested(300) };
    // Saved before the limit: straight into the database.
    t.db.$client
      .prepare("update error_types set body = ? where id = ?")
      .run(JSON.stringify(old), created.id);

    const renamed = await t.request("PATCH", `${errorsUrl()}/${created.id}`, {
      title: "Renamed",
    });
    expect(renamed.status).toBe(200);
    const read = errorTypeSchema.parse(await renamed.json());
    const resaved = await t.request("PATCH", `${errorsUrl()}/${created.id}`, {
      ...read,
      title: "Saved again",
    });
    expect(resaved.status).toBe(200);
    const changed = await t.request("PATCH", `${errorsUrl()}/${created.id}`, {
      body: { ...old, example: nested(301) },
    });
    expect(changed.status).toBe(400);
    expect((await errorOf(changed)).issues).toEqual([
      {
        path: "body.example",
        message: "This example is nested more than 256 levels deep",
      },
    ]);
  });

  it("updates an error and marks the project as changed", async () => {
    const error = await createError("sku-taken", "409");
    const before = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );

    const response = await t.request("PATCH", `${errorsUrl()}/${error.id}`, {
      title: "SKU already used",
      description: "Another item has this SKU.",
    });

    expect(response.status).toBe(200);
    expect(await getError(error.id)).toMatchObject({
      name: "sku-taken",
      title: "SKU already used",
      description: "Another item has this SKU.",
    });
    const after = projectSchema.parse(
      await (await t.request("GET", `/api/projects/${projectId}`)).json(),
    );
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it("deletes an error", async () => {
    const error = await createError("sku-taken", "409");

    const response = await t.request("DELETE", `${errorsUrl()}/${error.id}`);

    expect(response.status).toBe(204);
    expect((await t.request("GET", `${errorsUrl()}/${error.id}`)).status).toBe(
      404,
    );
  });

  it("keeps errors inside their project", async () => {
    const error = await createError("sku-taken", "409");
    const other = await t.request("POST", "/api/projects", { name: "Other" });
    const otherId = projectSchema.parse(await other.json()).id;

    expect(
      (await t.request("GET", `${errorsUrl(otherId)}/${error.id}`)).status,
    ).toBe(404);
    expect((await t.request("GET", errorsUrl("nope"))).status).toBe(404);
  });

  it("deletes errors together with their project", async () => {
    await createError("sku-taken", "409");

    await t.request("DELETE", `/api/projects/${projectId}`);

    expect(
      t.db.$client.prepare("select count(*) as count from error_types").get(),
    ).toEqual({ count: 0 });
  });

  describe("used by endpoint responses", () => {
    it("lists the endpoints whose responses use an error", async () => {
      const notFound = await createError("not-found", "404");
      const second = await endpointAnswering("GET", "/stocks/{id}", "404", [
        { errorTypeId: notFound.id, examples: [] },
      ]);
      const first = await endpointAnswering("DELETE", "/orders/{id}", "4XX", [
        { errorTypeId: notFound.id, examples: [] },
      ]);

      expect((await getError(notFound.id)).endpointIds).toEqual([
        first.id,
        second.id,
      ]);
      expect(second.responses.at(-1)?.errors).toEqual([
        { errorTypeId: notFound.id, examples: [] },
      ]);
    });

    it("rejects errors the catalog lacks and statuses that don't match", async () => {
      const notFound = await createError("not-found", "404");
      const url = endpointsUrl();
      const created = await t.request("POST", url, {
        method: "GET",
        path: "/stocks",
      });
      const endpoint = endpointResponseFieldsSchema.parse(await created.json());

      const response = await t.request("PATCH", `${url}/${endpoint.id}`, {
        responses: [
          ...endpoint.responses,
          {
            id: "conflict",
            status: "409",
            description: "Conflict",
            headers: noHeaders,
            body: null,
            errors: [
              { errorTypeId: "nope", examples: [] },
              { errorTypeId: notFound.id, examples: [] },
            ],
          },
        ],
      });

      expect(response.status).toBe(400);
      expect((await errorOf(response)).issues).toEqual([
        {
          path: "responses.1.errors.0.errorTypeId",
          message: "This error type isn't in the project",
        },
        {
          path: "responses.1.errors.1.errorTypeId",
          message: "not-found is a 404 error, so a 409 response can't use it",
        },
      ]);
    });

    it("still takes responses that don't mention errors, as before the catalog", async () => {
      const url = endpointsUrl();
      const created = await t.request("POST", url, {
        method: "GET",
        path: "/stocks",
      });
      const endpoint = endpointResponseFieldsSchema.parse(await created.json());
      const { errors: _errors, ...ok } = endpoint.responses[0] ?? {};

      const response = await t.request("PATCH", `${url}/${endpoint.id}`, {
        responses: [{ ...ok, description: "The stocks" }],
      });

      expect(response.status).toBe(200);
      const saved = endpointResponseFieldsSchema.parse(await response.json());
      expect(saved.responses[0]).toMatchObject({
        description: "The stocks",
        errors: [],
      });
    });

    it("refuses to delete an error a response uses", async () => {
      const notFound = await createError("not-found", "404");
      await endpointAnswering("GET", "/stocks/{id}", "404", [
        { errorTypeId: notFound.id, examples: [] },
      ]);

      const response = await t.request(
        "DELETE",
        `${errorsUrl()}/${notFound.id}`,
      );

      expect(response.status).toBe(409);
      expect((await errorOf(response)).error).toBe(
        "not-found is used by GET /stocks/{id}. Remove it from those responses first.",
      );
    });

    it("refuses changes that would break the responses using it", async () => {
      const taken = await createError("sku-taken", "409");
      const busy = await createError("request-in-progress", "409");
      await endpointAnswering("POST", "/stocks", "409", [
        { errorTypeId: taken.id, examples: [] },
        {
          errorTypeId: busy.id,
          examples: [
            {
              id: "x1",
              name: "in-progress",
              summary: "",
              value: { type: `${PROBLEMS}request-in-progress` },
            },
          ],
        },
      ]);
      const change = (id: string, body: Record<string, unknown>) =>
        t.request("PATCH", `${errorsUrl()}/${id}`, body);

      const status = await change(taken.id, { status: "422" });
      const name = await change(taken.id, { name: "in-progress" });

      expect(status.status).toBe(409);
      expect(await errorOf(status)).toEqual({
        error:
          "POST /stocks would stop being valid: sku-taken is a 422 error, so a 409 response can't use it",
        issues: [
          {
            path: "status",
            message:
              "POST /stocks would stop being valid: sku-taken is a 422 error, so a 409 response can't use it",
          },
        ],
      });
      expect(name.status).toBe(409);
      expect((await errorOf(name)).issues).toEqual([
        {
          path: "name",
          message:
            "POST /stocks would stop being valid: Example names must be unique: in-progress is already used",
        },
      ]);
      // Changes that responses allow still go through.
      expect((await change(taken.id, { title: "SKU used" })).status).toBe(200);
    });

    it("keeps a response's errors when a client leaves them out", async () => {
      const notFound = await createError("not-found", "404");
      const endpoint = await endpointAnswering("GET", "/stocks/{id}", "404", [
        { errorTypeId: notFound.id, examples: [] },
      ]);
      // A client from before the catalog drops the field it doesn't know.
      const responses = endpoint.responses.map(
        ({ errors: _errors, ...response }) => response,
      );

      const response = await t.request(
        "PATCH",
        `${endpointsUrl()}/${endpoint.id}`,
        { summary: "Get a stock", responses },
      );

      expect(response.status).toBe(200);
      const saved = endpointResponseFieldsSchema.parse(await response.json());
      expect(saved.responses.map((item) => item.errors)).toEqual([
        [],
        [{ errorTypeId: notFound.id, examples: [] }],
      ]);
    });

    it("blocks deleting a model an error uses", async () => {
      await createError("sku-taken", "409");

      const response = await t.request(
        "DELETE",
        `/api/projects/${projectId}/models/${problemId}`,
      );

      expect(response.status).toBe(409);
      expect((await errorOf(response)).error).toBe(
        "Problem is used by error type sku-taken. Remove those references first.",
      );
    });
  });
});
