import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";
import { apiErrorSchema } from "../../shared/api-error";
import { projectImportResultSchema } from "../../shared/project-file";
import { projects } from "../db/schema";
import { createTestApp } from "../test-utils";

// biome-ignore lint/suspicious/noExplicitAny: tests read API answers loosely.
type Loose = any;

type TestApp = ReturnType<typeof createTestApp>;
const apps: TestApp[] = [];
function app(options: Parameters<typeof createTestApp>[0] = {}) {
  const created = createTestApp(options);
  apps.push(created);
  return created;
}
afterEach(() => {
  for (const created of apps.splice(0)) {
    created.close();
  }
});

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

const PETS = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1.0.0", description: "Pet store." },
  servers: [{ url: "https://pets.example/v1", description: "Production" }],
  components: {
    schemas: {
      Pet: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
    securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  },
  security: [{ bearer: [] }],
  paths: {
    "/pets": {
      get: {
        summary: "List pets",
        parameters: [
          { name: "session", in: "cookie", schema: { type: "string" } },
        ],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Pet" },
                },
                examples: {
                  two: { value: [{ name: "Rex" }, { name: "Tom" }] },
                },
              },
            },
          },
        },
      },
    },
  },
};

function send(
  t: TestApp,
  body: string | Uint8Array,
  contentType: string | null,
) {
  return t.app.request("/api/projects/import", {
    method: "POST",
    headers: contentType === null ? {} : { "Content-Type": contentType },
    body,
  });
}

function projectCount(t: TestApp) {
  return t.db.select().from(projects).all().length;
}

function tmpFiles(t: TestApp) {
  return fs.existsSync(t.tmpDir) ? fs.readdirSync(t.tmpDir) : [];
}

describe("importing an OpenAPI document", () => {
  it("makes a project from JSON, with new IDs, and says what it couldn't keep", async () => {
    const t = app();
    const response = await send(t, JSON.stringify(PETS), "application/json");
    const body = (await response.json()) as Loose;
    expect(response.status, JSON.stringify(body)).toBe(201);
    const { project, notices } = projectImportResultSchema.parse(body);
    expect(response.headers.get("location")).toBe(
      `/api/projects/${project.id}`,
    );
    expect(project).toMatchObject({
      id: expect.stringMatching(ULID),
      name: "Pets",
      slug: "pets",
      description: "Pet store.",
      apiVersion: "1.0.0",
      servers: [{ name: "Production", url: "https://pets.example/v1" }],
      securitySchemes: [{ key: "bearer", type: "bearer" }],
    });
    expect(project.defaultSecuritySchemeId).toBe(
      project.securitySchemes[0]?.id,
    );
    expect(notices).toContainEqual({
      path: "/paths/~1pets/get/parameters/0",
      message: expect.stringMatching(/Cookie parameters.*session/s),
    });

    const models = (await (
      await t.request("GET", `/api/projects/${project.id}/models`)
    ).json()) as Loose[];
    expect(models).toMatchObject([
      { name: "Pet", id: expect.stringMatching(ULID) },
    ]);
    const list = (await (
      await t.request("GET", `/api/projects/${project.id}/endpoints`)
    ).json()) as Loose[];
    expect(list).toMatchObject([
      { method: "GET", path: "/pets", summary: "List pets", pageIds: [] },
    ]);
    const detail = (await (
      await t.request(
        "GET",
        `/api/projects/${project.id}/endpoints/${list[0].id}`,
      )
    ).json()) as Loose;
    expect(detail.responses[0].body.schema).toEqual({
      type: "array",
      items: { $ref: `model:${models[0].id}` },
    });

    // The Export tab: the endpoint waits for a page, as the issue says.
    const report = (await (
      await t.request("GET", `/api/projects/${project.id}/export/report`)
    ).json()) as Loose;
    expect(report.valid).toBe(true);
    expect(report.warnings).toContainEqual(
      expect.objectContaining({
        kind: "unused-endpoint",
        message: "GET /pets isn't used by any page",
      }),
    );
  });

  it("takes YAML under every name RFC 9512 and the OpenAPI media types give it, and JSON under its own", async () => {
    const t = app();
    const yaml = stringify(PETS);
    for (const type of [
      "application/yaml",
      "application/yaml; charset=utf-8",
      "application/x-yaml",
      "text/yaml",
      "text/x-yaml",
      "application/openapi+yaml; version=3.1",
      "application/vnd.oai.openapi",
    ]) {
      expect((await send(t, yaml, type)).status, type).toBe(201);
    }
    for (const type of [
      "application/openapi+json",
      "application/vnd.oai.openapi+json",
      "Application/JSON",
    ]) {
      expect((await send(t, JSON.stringify(PETS), type)).status, type).toBe(
        201,
      );
    }
    // Slugs that are taken get the next free one, and the notice points at the title.
    const response = await send(t, JSON.stringify(PETS), "application/json");
    const { project, notices } = projectImportResultSchema.parse(
      await response.json(),
    );
    expect(project.slug).toBe("pets-11");
    expect(notices).toContainEqual({
      path: "/info/title",
      message: "pets is used by another project, so this one is pets-11",
    });
  });

  it("refuses types a browser sends from another site without asking (CSRF), listing the ones it takes", async () => {
    const t = app();
    for (const type of [
      null,
      "text/plain",
      "text/plain; charset=utf-8",
      "application/x-www-form-urlencoded",
      "multipart/form-data; boundary=x",
      "application/octet-stream",
      "application/json, text/plain",
    ]) {
      const response = await send(t, JSON.stringify(PETS), type);
      expect(response.status, String(type)).toBe(415);
      expect(response.headers.get("accept"), String(type)).toBe(
        "application/zip, application/x-zip-compressed, application/json, application/yaml, application/openapi+json, application/openapi+yaml, application/vnd.oai.openapi+json, application/vnd.oai.openapi, application/x-yaml, text/yaml, text/x-yaml",
      );
      expect(apiErrorSchema.parse(await response.json()).error).toMatch(
        /project file as application\/zip, or an OpenAPI document as application\/json or application\/yaml/,
      );
    }
    expect(projectCount(t)).toBe(0);
  });

  it("refuses a document over 16 MB, naming that limit, and MAX_IMPORT_MB when it's lower", async () => {
    const t = app({ maxImportBytes: 64 * 1024 * 1024 });
    const big = new Uint8Array(16 * 1024 * 1024 + 1).fill(0x20);
    const response = await t.app.request("/api/projects/import", {
      method: "POST",
      headers: {
        "Content-Type": "application/yaml",
        "Content-Length": String(big.length),
      },
      body: big,
    });
    expect(response.status).toBe(413);
    expect(apiErrorSchema.parse(await response.json()).error).toMatch(
      /OpenAPI document may be at most 16 MB/,
    );
    // Sent without a length, it's stopped while it's read.
    const streamed = await t.app.request("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/yaml" },
      body: new ReadableStream({
        start(controller) {
          for (let sent = 0; sent <= 16 * 1024 * 1024; sent += 1024 * 1024) {
            controller.enqueue(new Uint8Array(1024 * 1024).fill(0x20));
          }
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);
    expect(streamed.status).toBe(413);

    const small = app({ maxImportBytes: 1000 });
    const refused = await send(
      small,
      JSON.stringify({ ...PETS, padding: "x".repeat(2000) }),
      "application/json",
    );
    expect(refused.status).toBe(413);
    expect(apiErrorSchema.parse(await refused.json()).error).toMatch(
      /MAX_IMPORT_MB/,
    );
  });

  it("refuses what it can't import with a reason and places, and writes nothing", async () => {
    const t = app();
    const cases: [string | Uint8Array, string, RegExp][] = [
      [
        "openapi: 3.1.0\ninfo: [",
        "application/yaml",
        /isn't valid YAML at line/,
      ],
      [
        '{"openapi": "3.1.0",}',
        "application/json",
        /isn't valid JSON at line 1/,
      ],
      [JSON.stringify({ swagger: "2.0" }), "application/json", /Swagger 2\.0/],
      [
        JSON.stringify({
          ...PETS,
          components: { schemas: { Pet: { $ref: "pet.yaml" } } },
        }),
        "application/json",
        /refers to other files.*Bundle/s,
      ],
      [
        new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]),
        "application/json",
        /zip.*application\/zip/s,
      ],
    ];
    for (const [body, type, error] of cases) {
      const response = await send(t, body, type);
      expect(response.status, String(error)).toBe(400);
      const parsed = apiErrorSchema.parse(await response.json());
      expect(
        [
          parsed.error,
          ...(parsed.issues ?? []).map(
            (issue) => `${issue.path} ${issue.message}`,
          ),
        ].join("\n"),
      ).toMatch(error);
    }
    expect(projectCount(t)).toBe(0);
    expect(tmpFiles(t)).toEqual([]);
  });

  it("imports the frozen 3.0 and 3.1 fixtures, the same from JSON as from YAML", async () => {
    const t = app();
    const fixture = (name: string) =>
      fs.readFileSync(path.resolve("test/fixtures/openapi", name));
    for (const [json, yaml] of [
      ["bookshop-3.0.json", "bookshop-3.0.yaml"],
      ["events-3.1.json", "events-3.1.yaml"],
    ]) {
      const fromJson = projectImportResultSchema.parse(
        await (await send(t, fixture(json), "application/json")).json(),
      );
      const fromYaml = projectImportResultSchema.parse(
        await (await send(t, fixture(yaml), "application/yaml")).json(),
      );
      const exported = async (id: string) =>
        (
          await t.request(
            "GET",
            `/api/projects/${id}/export/openapi?format=json`,
          )
        ).text();
      expect(await exported(fromYaml.project.id), yaml).toBe(
        await exported(fromJson.project.id),
      );
      expect(
        fromYaml.notices.filter((notice) => notice.path !== "/info/title"),
      ).toEqual(
        fromJson.notices.filter((notice) => notice.path !== "/info/title"),
      );
    }
  });
});

describe("imports at the same time", () => {
  /** A YAML document slow enough to still be importing when the others come. */
  const slow = () =>
    stringify({
      ...PETS,
      "x-padding": Array.from({ length: 300_000 }, (_, index) => index),
    });
  const pause = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  it("run one at a time, three waiting, and one more answers busy", {
    timeout: 60_000,
  }, async () => {
    const t = app();
    const order: string[] = [];
    const first = Promise.resolve(send(t, slow(), "application/yaml")).then(
      (response) => {
        order.push("first");
        return response;
      },
    );
    await pause(150);
    const waiting = ["second", "third", "fourth"].map((name) =>
      Promise.resolve(send(t, JSON.stringify(PETS), "application/json")).then(
        (response) => {
          order.push(name);
          return response;
        },
      ),
    );
    await pause(50);
    const fifth = await send(t, JSON.stringify(PETS), "application/json");
    expect(fifth.status).toBe(503);
    expect(fifth.headers.get("Retry-After")).toBe("1");
    expect(apiErrorSchema.parse(await fifth.json()).error).toMatch(
      /Other imports are running and waiting/,
    );
    expect((await first).status).toBe(201);
    for (const response of await Promise.all(waiting)) {
      expect(response.status).toBe(201);
    }
    expect(order).toEqual(["first", "second", "third", "fourth"]);
    // Once they're done, imports go through again.
    expect(
      (await send(t, JSON.stringify(PETS), "application/json")).status,
    ).toBe(201);
  });

  it("answers busy before reading its body", { timeout: 60_000 }, async () => {
    const t = app();
    const first = send(t, slow(), "application/yaml");
    await pause(150);
    const waiting = [1, 2, 3].map(() =>
      send(t, JSON.stringify(PETS), "application/json"),
    );
    await pause(50);
    // A body that never ends: reading it first would never answer.
    const endless = new ReadableStream<Uint8Array>({ pull() {} });
    const fifth = await t.app.request("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: endless,
      duplex: "half",
    } as RequestInit);
    expect(fifth.status).toBe(503);
    expect((await first).status).toBe(201);
    for (const response of await Promise.all(waiting)) {
      expect(response.status).toBe(201);
    }
  });
});

describe("imports of two instances", () => {
  it("wait in each instance's own line, not in the other's", {
    timeout: 60_000,
  }, async () => {
    const busy = app();
    const other = app();
    const slow = stringify({
      ...PETS,
      "x-padding": Array.from({ length: 300_000 }, (_, index) => index),
    });
    const running = [
      send(busy, slow, "application/yaml"),
      ...[1, 2, 3].map(() =>
        send(busy, JSON.stringify(PETS), "application/json"),
      ),
    ];
    await new Promise((resolve) => setTimeout(resolve, 150));
    // The first instance's line is full; the second's isn't.
    expect(
      (await send(other, JSON.stringify(PETS), "application/json")).status,
    ).toBe(201);
    for (const response of await Promise.all(running)) {
      expect(response.status).toBe(201);
    }
  });
});

describe("an upload that doesn't arrive", () => {
  it("is stopped after a while, and gives its turn back", {
    timeout: 60_000,
  }, async () => {
    const t = app({ openApiBodyTimeoutMs: 200 });
    const endless = () =>
      t.app.request("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: new ReadableStream<Uint8Array>({ pull() {} }),
        duplex: "half",
      } as RequestInit);
    const [first, second] = await Promise.all([endless(), endless()]);
    expect(first.status).toBe(408);
    expect(second.status).toBe(408);
    expect(apiErrorSchema.parse(await first.json()).error).toMatch(
      /took longer than/,
    );
    // Their turns came back: imports go through again.
    expect(
      (await send(t, JSON.stringify(PETS), "application/json")).status,
    ).toBe(201);
  });
});

describe("importing a project file, as before", () => {
  it("still says what to do with an OpenAPI document sent as a zip", async () => {
    const t = app();
    const response = await send(
      t,
      "openapi: 3.1.0\ninfo:\n  title: Shop\n",
      "application/zip",
    );
    expect(response.status).toBe(400);
    expect(apiErrorSchema.parse(await response.json()).error).toMatch(
      /OpenAPI document.*application\/json or application\/yaml.*Import project/s,
    );
  });
});
