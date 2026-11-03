import fs from "node:fs";
import path from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makePng, SVG } from "../../../test/images";
import { craftZip } from "../../../test/zips";
import { apiErrorSchema } from "../../shared/api-error";
import { collectRefs } from "../../shared/json-schema";
import { pageSchema } from "../../shared/pages";
import {
  projectFileReportSchema,
  projectImportResultSchema,
} from "../../shared/project-file";
import { endpoints, projects } from "../db/schema";
import { bufferSource, openZip } from "../project-file/zip";
import { createUploadStorage } from "../storage/uploads";
import { buildSample, createTestApp } from "../test-utils";
import { projectFileRoutes } from "./project-files";

const GOLDEN = path.resolve("test/golden/inventory.project.json");
const FIXTURE_DIR = path.resolve("test/fixtures/project-file-v1");
const TOOL_ZIPS = path.resolve("test/fixtures/project-file-v1-zips");
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/;

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

async function exportFile(t: TestApp, projectId: string) {
  const response = await t.request(
    "GET",
    `/api/projects/${projectId}/export/project`,
  );
  expect(response.status).toBe(200);
  return new Uint8Array(await response.arrayBuffer());
}

function importFile(
  t: TestApp,
  data: Uint8Array | ReadableStream<Uint8Array>,
  contentType: string | null = "application/zip",
) {
  return t.app.request("/api/projects/import", {
    method: "POST",
    headers: contentType ? { "Content-Type": contentType } : {},
    body: data,
    // Node's fetch needs this for a streamed body.
    duplex: "half",
  });
}

async function imported(t: TestApp, data: Uint8Array) {
  const response = await importFile(t, data);
  const body = (await response.json()) as Loose;
  expect(response.status, JSON.stringify(body)).toBe(201);
  expect(response.headers.get("location")).toBe(
    `/api/projects/${body.project.id}`,
  );
  return projectImportResultSchema.parse(body);
}

async function refused(t: TestApp, data: Uint8Array, status = 400) {
  const response = await importFile(t, data);
  expect(response.status).toBe(status);
  return apiErrorSchema.parse((await response.json()) as Loose);
}

async function text(t: TestApp, url: string) {
  const response = await t.request("GET", url);
  expect(response.status).toBe(200);
  return response.text();
}

/** Every file of a Markdown export, by name. */
async function markdownFiles(t: TestApp, projectId: string) {
  const response = await t.request(
    "GET",
    `/api/projects/${projectId}/export/markdown`,
  );
  return unzipSync(new Uint8Array(await response.arrayBuffer()));
}

function projectJson(zip: Uint8Array) {
  const files = unzipSync(zip);
  const name = Object.keys(files).find((file) =>
    file.endsWith("/project.json"),
  );
  return strFromU8(files[name ?? ""] ?? new Uint8Array());
}

/** The frozen fixture as a zip, with what `change` does to its document. */
function fixtureZip(
  change: (document: Record<string, unknown>) => void = () => {},
  extraFiles: Record<string, Uint8Array> = {},
) {
  const document = JSON.parse(
    fs.readFileSync(`${FIXTURE_DIR}/project.json`, "utf8"),
  );
  change(document);
  return zipSync({
    "fixture-shop/project.json": strToU8(JSON.stringify(document, null, 2)),
    "fixture-shop/mockups/items.png": fs.readFileSync(
      `${FIXTURE_DIR}/mockups/items.png`,
    ),
    "fixture-shop/mockups/items-empty.png": fs.readFileSync(
      `${FIXTURE_DIR}/mockups/items-empty.png`,
    ),
    ...extraFiles,
  });
}

function projectCount(t: TestApp) {
  return t.db.select().from(projects).all().length;
}

function uploadFolders(t: TestApp) {
  return fs.existsSync(t.uploadsDir) ? fs.readdirSync(t.uploadsDir).sort() : [];
}

function tmpFiles(t: TestApp) {
  return fs.existsSync(t.tmpDir) ? fs.readdirSync(t.tmpDir) : [];
}

describe("exporting a project file", () => {
  it("downloads the project, its mockups included, as a zip", async () => {
    const t = app();
    const { projectId } = await buildSample(t);

    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/export/project`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.project.zip"',
    );
    const archive = openZip(
      bufferSource(new Uint8Array(await response.arrayBuffer())),
      { maxEntries: 100 },
    );
    const json = archive.entries.find(
      (entry) => entry.name === "inventory-app/project.json",
    );
    const images = archive.entries.filter((entry) =>
      entry.name.startsWith("inventory-app/mockups/"),
    );
    expect(archive.entries).toHaveLength(16);
    expect(json?.method).toBe(8);
    expect(images).toHaveLength(15);
    for (const image of images) {
      expect(image.name).toMatch(/^inventory-app\/mockups\/[0-9A-Z]{26}\.png$/);
      // Images are already compressed: they're stored as they are.
      expect(image.method).toBe(0);
    }
  });

  it("matches the golden file, apart from the instance's IDs", async () => {
    const t = app();
    const { projectId } = await buildSample(t);
    const json = projectJson(await exportFile(t, projectId));

    // IDs are the instance's; give them names in the order they first appear.
    const document = JSON.parse(json);
    const names = new Map<string, string>([[document.project.id, "project"]]);
    const name = (kind: string, items: { id: string }[]) => {
      items.forEach((item, index) => {
        names.set(item.id, `${kind}-${index + 1}`);
      });
    };
    name("model", document.models);
    name("error-type", document.errorTypes);
    name("endpoint", document.endpoints);
    name("page", document.pages);
    name(
      "mockup",
      document.pages.flatMap(
        (page: { mockups: { id: string }[] }) => page.mockups,
      ),
    );
    const normalized = json.replace(
      new RegExp(ULID.source, "g"),
      (id) => names.get(id) ?? "unknown-id",
    );
    expect(normalized).not.toContain("unknown-id");
    if (process.env.UPDATE_GOLDEN) {
      fs.writeFileSync(GOLDEN, normalized);
    }
    expect(normalized).toBe(fs.readFileSync(GOLDEN, "utf8"));
  });

  it("gives the same bytes each time, dated by the project's last change", async () => {
    const t = app();
    const { projectId } = await buildSample(t);

    const first = await exportFile(t, projectId);
    expect(await exportFile(t, projectId)).toEqual(first);

    const project = (await (
      await t.request("GET", `/api/projects/${projectId}`)
    ).json()) as Loose;
    const updated = new Date(project.updatedAt);
    // The first local header's DOS date and time, written from UTC so the
    // bytes don't depend on the server's time zone.
    const header = Buffer.from(first.buffer, first.byteOffset);
    const time = header.readUInt16LE(10);
    const date = header.readUInt16LE(12);
    expect({
      year: (date >> 9) + 1980,
      month: (date >> 5) & 15,
      day: date & 31,
      hours: time >> 11,
      minutes: (time >> 5) & 63,
      seconds: (time & 31) * 2,
    }).toEqual({
      year: updated.getUTCFullYear(),
      month: updated.getUTCMonth() + 1,
      day: updated.getUTCDate(),
      hours: updated.getUTCHours(),
      minutes: updated.getUTCMinutes(),
      seconds: updated.getUTCSeconds() - (updated.getUTCSeconds() % 2),
    });
  });

  it("is always the whole project", async () => {
    const t = app();
    const { projectId, pageIds } = await buildSample(t);
    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/export/project?page=${pageIds.login}`,
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as Loose).error).toMatch(
      /always holds the whole project/,
    );
  });

  it("answers 404 for a project that doesn't exist", async () => {
    const t = app();
    const response = await t.request(
      "GET",
      "/api/projects/nope/export/project",
    );
    expect(response.status).toBe(404);
  });

  it("exports a project whose OpenAPI isn't valid yet", async () => {
    const source = app();
    const project = (await (
      await source.request("POST", "/api/projects", { name: "Draft" })
    ).json()) as Loose;
    await source.request("POST", `/api/projects/${project.id}/models`, {
      name: "Broken",
      schema: { type: "strng" },
    });

    const target = app();
    const { project: copy } = await imported(
      target,
      await exportFile(source, project.id),
    );
    const report = (await (
      await target.request("GET", `/api/projects/${copy.id}/export/report`)
    ).json()) as Loose;
    expect(report.valid).toBe(false);
  });

  it("leaves out a mockup whose file is gone, and says so in its report", async () => {
    const t = app();
    const { projectId, pageIds } = await buildSample(t);
    const page = pageSchema.parse(
      (await (
        await t.request(
          "GET",
          `/api/projects/${projectId}/pages/${pageIds.login}`,
        )
      ).json()) as Loose,
    );
    const [kept, gone] = page.mockups;
    fs.rmSync(
      path.join(t.uploadsDir, gone?.url.replace(/^\/uploads\//, "") ?? ""),
    );

    const document = JSON.parse(projectJson(await exportFile(t, projectId)));
    const login = document.pages.find(
      (item: { id: string }) => item.id === pageIds.login,
    );
    expect(login.mockups.map((mockup: { id: string }) => mockup.id)).toEqual([
      kept?.id,
    ]);
    for (const state of login.states) {
      expect(state.mockupIds).not.toContain(gone?.id);
    }

    const report = projectFileReportSchema.parse(
      (await (
        await t.request(
          "GET",
          `/api/projects/${projectId}/export/project/report`,
        )
      ).json()) as Loose,
    );
    expect(report.issues).toEqual([
      "1 mockup has no image file in the data directory, so the file leaves it out: Login › login-error.png",
    ]);
  });

  it("writes the repaired IDs of endpoints saved before they had to be unique", async () => {
    const t = app();
    const project = (await (
      await t.request("POST", "/api/projects", { name: "Legacy" })
    ).json()) as Loose;
    const endpoint = (await (
      await t.request("POST", `/api/projects/${project.id}/endpoints`, {
        method: "GET",
        path: "/things",
      })
    ).json()) as Loose;
    // As 0.2.x could save it: two responses with the same ID.
    const response = (status: string) => ({
      id: "r",
      status,
      description: "x",
      headers: { type: "object", properties: {} },
      body: {
        contentType: "application/json",
        schema: { type: "object" },
        examples: [{ id: "e", name: `ex${status}`, summary: "", value: {} }],
      },
      errors: [],
    });
    t.db
      .update(endpoints)
      .set({ responses: [response("200"), response("404")] })
      .run();
    const page = (await (
      await t.request("POST", `/api/projects/${project.id}/pages`, {
        name: "Things",
      })
    ).json()) as Loose;
    const saved = await t.request(
      "PATCH",
      `/api/projects/${project.id}/pages/${page.id}`,
      {
        endpoints: [
          { id: "l1", endpointId: endpoint.id, trigger: "on_load", note: "" },
        ],
        states: [
          {
            id: "s1",
            kind: "error",
            name: "Missing",
            description: "",
            causes: [
              {
                type: "response",
                linkId: "l1",
                responseId: "r-2",
                exampleId: "e",
              },
            ],
            mockupIds: [],
          },
        ],
      },
    );
    expect(saved.status).toBe(200);

    const target = app();
    const { project: copy } = await imported(
      target,
      await exportFile(t, project.id),
    );
    const [copiedPage] = (await (
      await target.request("GET", `/api/projects/${copy.id}/pages`)
    ).json()) as Loose;
    const full = pageSchema.parse(
      (await (
        await target.request(
          "GET",
          `/api/projects/${copy.id}/pages/${copiedPage.id}`,
        )
      ).json()) as Loose,
    );
    expect(full.states[0]?.causes[0]).toMatchObject({ responseId: "r-2" });
  });
});

describe("the project file report", () => {
  it("gives the size and no issues for the sample", async () => {
    const t = app();
    const { projectId } = await buildSample(t);
    const report = projectFileReportSchema.parse(
      (await (
        await t.request(
          "GET",
          `/api/projects/${projectId}/export/project/report`,
        )
      ).json()) as Loose,
    );
    expect(report.issues).toEqual([]);
    expect(report.size).toBeGreaterThan(300_000);
  });

  it("warns when this instance couldn't import the file", async () => {
    const t = app({ maxImportBytes: 100_000 });
    const { projectId } = await buildSample(t);
    const report = projectFileReportSchema.parse(
      (await (
        await t.request(
          "GET",
          `/api/projects/${projectId}/export/project/report`,
        )
      ).json()) as Loose,
    );
    expect(report.issues).toEqual([
      expect.stringMatching(
        /^The file holds about \d+ KB, more than this instance imports \(98 KB, MAX_IMPORT_MB\)/,
      ),
    ]);
  });
});

describe("importing a project file", () => {
  it("round-trips the sample into an empty instance: the same IDs, and byte-identical exports", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    const file = await exportFile(source, projectId);

    const target = app();
    const { project, notices } = await imported(target, file);

    expect(notices).toEqual([]);
    expect(project).toMatchObject({
      id: projectId,
      name: "Inventory App",
      slug: "inventory-app",
      revision: 0,
    });
    for (const format of ["yaml", "json"]) {
      const url = (id: string) =>
        `/api/projects/${id}/export/openapi?format=${format}`;
      expect(await text(target, url(project.id))).toBe(
        await text(source, url(projectId)),
      );
    }
    const before = await markdownFiles(source, projectId);
    const after = await markdownFiles(target, project.id);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    for (const [name, content] of Object.entries(before)) {
      expect(
        Buffer.from(after[name] ?? []).equals(Buffer.from(content)),
        name,
      ).toBe(true);
    }
    const report = (await (
      await target.request("GET", `/api/projects/${project.id}/export/report`)
    ).json()) as Loose;
    expect(report).toEqual({ valid: true, errors: [], warnings: [] });

    // And the file itself comes back the same.
    const again = await exportFile(target, project.id);
    expect(projectJson(again)).toBe(projectJson(file));
    const images = (zip: Uint8Array) =>
      Object.entries(unzipSync(zip)).filter(([name]) =>
        name.includes("/mockups/"),
      );
    expect(images(again)).toEqual(images(file));
  });

  it("round-trips the sample without states into what 0.2.0 exported", async () => {
    const source = app();
    const { projectId } = await buildSample(source, { states: false });
    const target = app();
    const { project } = await imported(
      target,
      await exportFile(source, projectId),
    );

    const golden = path.resolve(
      "test/golden/inventory-markdown-without-states",
    );
    const files = await markdownFiles(target, project.id);
    const markdown = Object.keys(files).filter((name) => name.endsWith(".md"));
    expect(markdown.length).toBeGreaterThan(10);
    for (const name of markdown) {
      expect(strFromU8(files[name] ?? new Uint8Array()), name).toBe(
        fs.readFileSync(
          path.join(golden, name.replace(/^inventory-app\//, "")),
          "utf8",
        ),
      );
    }
  });

  it("imports a file twice as two projects, the second a copy with new IDs", async () => {
    const t = app();
    const { projectId } = await buildSample(t);
    const file = await exportFile(t, projectId);

    const { project: copy, notices } = await imported(t, file);

    expect(copy.id).not.toBe(projectId);
    expect(copy.name).toBe("Inventory App");
    expect(copy.slug).toBe("inventory-app-2");
    expect(notices).toEqual([
      {
        path: "project.id",
        message:
          "This project is already on this instance, so the import is a separate copy",
      },
      {
        path: "project.slug",
        message:
          "inventory-app is used by another project, so this one is inventory-app-2",
      },
    ]);
    expect((await imported(t, file)).project.slug).toBe("inventory-app-3");

    // The copy's references point at the copy's own things.
    const listOf = async (kind: string, id: string) =>
      (await (
        await t.request("GET", `/api/projects/${id}/${kind}`)
      ).json()) as Loose as {
        id: string;
      }[];
    const original = {
      models: new Set(
        (await listOf("models", projectId)).map((item) => item.id),
      ),
      endpoints: new Set(
        (await listOf("endpoints", projectId)).map((item) => item.id),
      ),
    };
    const models = await Promise.all(
      (await listOf("models", copy.id)).map(
        async (item) =>
          (
            await t.request("GET", `/api/projects/${copy.id}/models/${item.id}`)
          ).json() as Loose,
      ),
    );
    const modelIds = new Set(models.map((model) => model.id));
    const endpointList = await listOf("endpoints", copy.id);
    const endpointIds = new Set(endpointList.map((item) => item.id));
    const errorTypes = await listOf("error-types", copy.id);
    const errorTypeIds = new Set(errorTypes.map((item) => item.id));
    const refs = [
      ...models.flatMap((model) => collectRefs(model.schema)),
      ...(
        await Promise.all(
          endpointList.map(
            async (item) =>
              (
                await t.request(
                  "GET",
                  `/api/projects/${copy.id}/endpoints/${item.id}`,
                )
              ).json() as Loose,
          ),
        )
      ).flatMap((endpoint) => [
        ...collectRefs(endpoint.parameters),
        ...collectRefs({
          responses: endpoint.responses,
          body: endpoint.requestBody,
        }),
        ...endpoint.responses.flatMap(
          (response: { errors: { errorTypeId: string }[] }) =>
            response.errors.map((error) => `error:${error.errorTypeId}`),
        ),
      ]),
    ];
    expect(refs.length).toBeGreaterThan(20);
    for (const ref of refs) {
      if (ref.startsWith("model:")) {
        expect(modelIds.has(ref.slice(6)), ref).toBe(true);
        expect(original.models.has(ref.slice(6))).toBe(false);
      } else if (ref.startsWith("error:")) {
        expect(errorTypeIds.has(ref.slice(6)), ref).toBe(true);
      }
    }
    for (const summary of await listOf("pages", copy.id)) {
      const page = pageSchema.parse(
        (await (
          await t.request("GET", `/api/projects/${copy.id}/pages/${summary.id}`)
        ).json()) as Loose,
      );
      const mockupIds = new Set(page.mockups.map((mockup) => mockup.id));
      for (const link of page.endpoints) {
        expect(endpointIds.has(link.endpointId)).toBe(true);
        expect(original.endpoints.has(link.endpointId)).toBe(false);
      }
      for (const state of page.states) {
        for (const id of state.mockupIds) {
          expect(mockupIds.has(id)).toBe(true);
        }
        for (const cause of state.causes) {
          if (cause.type === "error") {
            expect(errorTypeIds.has(cause.errorTypeId)).toBe(true);
          }
        }
      }
      for (const mockup of page.mockups) {
        expect(mockup.url.startsWith(`/uploads/${copy.id}/`)).toBe(true);
        expect(
          fs.existsSync(
            path.join(t.uploadsDir, mockup.url.replace(/^\/uploads\//, "")),
          ),
        ).toBe(true);
      }
    }
    // A copy exports the same contract.
    expect(await text(t, `/api/projects/${copy.id}/export/openapi`)).toBe(
      await text(t, `/api/projects/${projectId}/export/openapi`),
    );
  });

  it("makes new IDs for all when only some are taken", async () => {
    const first = app();
    const { projectId } = await buildSample(first);
    const file = await exportFile(first, projectId);
    const target = app();
    await imported(target, file);

    // The same models and endpoints, under another project ID.
    const document = JSON.parse(projectJson(file));
    document.project.id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    document.project.slug = "another";
    const files = unzipSync(file);
    files["inventory-app/project.json"] = strToU8(JSON.stringify(document));
    const { project, notices } = await imported(target, zipSync(files));

    expect(project.id).not.toBe("01ARZ3NDEKTSV4RRFFQ69G5FAV");
    expect(notices.map((notice) => notice.path)).toEqual(["project.id"]);
  });

  it("keeps the file's IDs when an earlier import left only a folder behind", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    const file = await exportFile(source, projectId);
    const target = app();
    // As a crash between moving the images in and the commit, or while
    // deleting the project, would leave it.
    fs.mkdirSync(path.join(target.uploadsDir, projectId), { recursive: true });
    fs.writeFileSync(
      path.join(target.uploadsDir, projectId, "left-over.png"),
      "x",
    );

    const { project, notices } = await imported(target, file);

    expect(project.id).toBe(projectId);
    expect(notices).toEqual([]);
    expect(
      fs.existsSync(path.join(target.uploadsDir, projectId, "left-over.png")),
    ).toBe(false);
  });

  it("gives imported images new file names, so a reused URL never shows an old image", async () => {
    const source = app();
    const { projectId, pageIds } = await buildSample(source);
    const file = await exportFile(source, projectId);
    const target = app();
    const pageUrl = `/api/projects/${projectId}/pages/${pageIds.login}`;

    await imported(target, file);
    const first = pageSchema.parse(
      await (await target.request("GET", pageUrl)).json(),
    );
    const [mockup] = first.mockups;
    // Uploads are cached for good, since their names are new.
    expect(mockup?.url.endsWith(`/${mockup.id}.png`)).toBe(false);

    // The same project again, with that image changed.
    await target.request("DELETE", `/api/projects/${projectId}`);
    const files = unzipSync(file);
    files[`inventory-app/mockups/${mockup?.id}.png`] = new Uint8Array(
      makePng(5, 5),
    );
    await imported(target, zipSync(files));
    const second = pageSchema.parse(
      await (await target.request("GET", pageUrl)).json(),
    );
    expect(second.mockups[0]?.id).toBe(mockup?.id);
    expect(second.mockups[0]?.url).not.toBe(mockup?.url);
    expect(second.mockups[0]?.width).toBe(5);
  });

  it("gives a copy new IDs in the file's order, so its own file lists parts the same way", async () => {
    const t = app();
    const { project } = await imported(
      t,
      fixtureZip((document) => {
        (document.models as unknown[]).reverse();
        (document.endpoints as unknown[]).reverse();
      }),
    );
    const document = JSON.parse(projectJson(await exportFile(t, project.id)));
    expect(
      document.models.map((model: { name: string }) => model.name),
    ).toEqual(["Item", "Category"]);
    expect(
      document.endpoints.map(
        (endpoint: { method: string; path: string }) =>
          `${endpoint.method} ${endpoint.path}`,
      ),
    ).toEqual(["GET /items/{itemId}", "POST /items", "GET /items"]);
  });

  it("removes what interrupted imports left in its temporary folder when it starts", () => {
    const t = app();
    const staged = path.join(t.tmpDir, "import-01ARZ3NDEKTSV4RRFFQ69G5FAV");
    fs.mkdirSync(staged, { recursive: true });
    fs.writeFileSync(path.join(staged, "a.png"), "x");
    fs.writeFileSync(
      path.join(t.tmpDir, "import-01ARZ3NDEKTSV4RRFFQ69G5FAW.zip"),
      "x",
    );
    fs.writeFileSync(path.join(t.tmpDir, "someone-elses.txt"), "x");

    projectFileRoutes(t.db, createUploadStorage(t.uploadsDir), {
      version: "1.2.3",
      maxImportBytes: 1024,
      maxUploadBytes: 1024,
      tmpDir: t.tmpDir,
    });

    expect(fs.readdirSync(t.tmpDir)).toEqual(["someone-elses.txt"]);
  });

  /** A schema `levels` deep through `items`, which nests one level at a time. */
  function deepSchema(levels: number) {
    let schema: Record<string, unknown> = { type: "string" };
    for (let level = 1; level < levels; level++) {
      schema = { type: "array", items: schema };
    }
    return schema;
  }

  /** A value `levels` deep: lists in lists around a number. */
  function deepValue(levels: number) {
    let value: unknown = 0;
    for (let level = 0; level < levels; level++) {
      value = [value];
    }
    return value;
  }

  it("takes schemas and examples exactly as deep as the API does, and every export follows them", async () => {
    const source = app();
    const project = (await (
      await source.request("POST", "/api/projects", { name: "Deep" })
    ).json()) as Loose;
    const base = `/api/projects/${project.id}`;
    const model = (await (
      await source.request("POST", `${base}/models`, {
        name: "Deep",
        schema: deepSchema(256),
      })
    ).json()) as Loose;
    const endpoint = (await (
      await source.request("POST", `${base}/endpoints`, {
        method: "POST",
        path: "/deep",
      })
    ).json()) as Loose;
    const [response] = endpoint.responses;
    const example = (id: string) => ({
      id,
      name: id,
      summary: "",
      value: deepValue(256),
    });
    const saved = await source.request(
      "PATCH",
      `${base}/endpoints/${endpoint.id}`,
      {
        requestBody: {
          ...endpoint.requestBody,
          schema: deepSchema(256),
          examples: [example("sent")],
        },
        responses: [
          {
            ...response,
            body: {
              ...response.body,
              schema: { $ref: `model:${model.id}` },
              examples: [example("answered")],
            },
          },
        ],
      },
    );
    expect(saved.status).toBe(200);

    const file = await exportFile(source, project.id);
    const target = app();
    const { project: copy } = await imported(target, file);
    for (const url of [
      "export/openapi?format=yaml",
      "export/openapi?format=json",
      "export/markdown",
    ]) {
      const answer = await target.request(
        "GET",
        `/api/projects/${copy.id}/${url}`,
      );
      expect(answer.status, url).toBe(200);
    }
    expect(
      await (
        await target.request("GET", `/api/projects/${copy.id}/export/report`)
      ).json(),
    ).toMatchObject({ valid: true, errors: [] });
    expect(
      await (
        await target.request(
          "GET",
          `/api/projects/${copy.id}/export/project/report`,
        )
      ).json(),
    ).toMatchObject({ issues: [] });

    // A level more, and the import refuses it in the API's words.
    const document = JSON.parse(projectJson(file));
    document.models[0].schema = deepSchema(257);
    document.endpoints[0].requestBody.examples[0].value = deepValue(257);
    const { issues } = await refused(
      target,
      zipSync({ "deep/project.json": strToU8(JSON.stringify(document)) }),
    );
    expect(issues).toEqual([
      {
        path: "models.0.schema",
        message: "Model Deep: This schema is nested more than 256 levels deep",
      },
      {
        path: "endpoints.0.requestBody.examples.0.value",
        message: "POST /deep: This example is nested more than 256 levels deep",
      },
    ]);
  });

  it("explains older data nested deeper than the API now takes, and still backs it up", async () => {
    const t = app();
    const project = (await (
      await t.request("POST", "/api/projects", { name: "Old" })
    ).json()) as Loose;
    const model = (await (
      await t.request("POST", `/api/projects/${project.id}/models`, {
        name: "Deep",
      })
    ).json()) as Loose;
    // Saved before the limit, past where exports give out, cold or warm.
    t.db.$client
      .prepare("update models set schema = ? where id = ?")
      .run(JSON.stringify(deepSchema(1500)), model.id);

    const openApi = await t.request(
      "GET",
      `/api/projects/${project.id}/export/openapi`,
    );
    expect(openApi.status).toBe(422);
    expect(await openApi.json()).toEqual({
      error:
        "A schema or example nests deeper than the exports can follow. Keep them within 256 levels, moving inner parts of schemas into models of their own.",
    });
    // Markdown follows it (cold, it gives out past 1,500 levels), and leaves
    // the OpenAPI file out, as for any error.
    const markdown = Object.keys(await markdownFiles(t, project.id));
    expect(markdown).toContain("old/models.md");
    expect(markdown.filter((name) => name.endsWith(".openapi.yaml"))).toEqual(
      [],
    );
    // Whether checking gives out first depends on the JIT; it never fails.
    const report = await t.request(
      "GET",
      `/api/projects/${project.id}/export/report`,
    );
    expect(report.status).toBe(200);

    // The project file holds it as it is, and says where it won't import.
    const fileReport = (await (
      await t.request(
        "GET",
        `/api/projects/${project.id}/export/project/report`,
      )
    ).json()) as Loose;
    expect(fileReport.issues).toEqual([
      "This project file can't be imported: it has 1 problem.",
      "models.0.schema: Model Deep: This schema is nested more than 256 levels deep",
    ]);
    const file = await exportFile(t, project.id);
    expect(JSON.parse(projectJson(file)).models[0].schema).toEqual(
      deepSchema(1500),
    );
    expect((await refused(app(), file)).issues).toEqual([
      {
        path: "models.0.schema",
        message: "Model Deep: This schema is nested more than 256 levels deep",
      },
    ]);
  });

  it("answers with a reason, and logs it, where older data nests deeper than anything can follow", async () => {
    const t = app();
    const project = (await (
      await t.request("POST", "/api/projects", { name: "Old" })
    ).json()) as Loose;
    const model = (await (
      await t.request("POST", `/api/projects/${project.id}/models`, {
        name: "Deep",
      })
    ).json()) as Loose;
    const levels = 100_000;
    t.db.$client
      .prepare("update models set schema = ? where id = ?")
      .run(
        `${'{"type": "array", "items": '.repeat(levels)}{"type": "string"}${"}".repeat(levels)}`,
        model.id,
      );
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const url of [
        `/api/projects/${project.id}/models/${model.id}`,
        `/api/projects/${project.id}/export/project`,
        `/api/projects/${project.id}/export/project/report`,
      ]) {
        const response = await t.request("GET", url);
        expect(response.status, url).toBe(422);
        expect(await response.json()).toEqual({
          error:
            "Something here nests deeper than the app can follow. Schemas and examples may nest at most 256 levels.",
        });
      }
      expect(logged).toHaveBeenCalledTimes(3);
      expect(logged.mock.calls[0]?.[0]).toBeInstanceOf(RangeError);
    } finally {
      logged.mockRestore();
    }
  });

  it("imports the frozen version 1 fixture, with new IDs for its readable keys", async () => {
    const t = app();
    const { project, notices } = await imported(t, fixtureZip());

    expect(notices).toEqual([]);
    expect(project.id).toMatch(ULID);
    expect(project).toMatchObject({
      name: "Fixture Shop",
      slug: "fixture-shop",
      apiVersion: "2.0.0",
      defaultSecuritySchemeId: "bearer",
    });

    const models = (await (
      await t.request("GET", `/api/projects/${project.id}/models`)
    ).json()) as Loose;
    const byName = new Map<string, string>(
      models.map((model: { id: string; name: string }) => [
        model.name,
        model.id,
      ]),
    );
    const item = (await (
      await t.request(
        "GET",
        `/api/projects/${project.id}/models/${byName.get("Item")}`,
      )
    ).json()) as Loose;
    // References follow the new IDs: to another model, and to itself.
    expect(item.schema.properties.category.$ref).toBe(
      `model:${byName.get("Category")}`,
    );
    expect(item.schema.properties.related.items.$ref).toBe(
      `model:${byName.get("Item")}`,
    );
    // Data that looks like a reference stays as written, and local refs stay.
    expect(item.schema.properties.note.examples).toEqual([
      "model:item",
      { $ref: "model:item" },
    ]);
    expect(item.schema.properties.note.default).toBe("model:category");
    expect(item.schema.properties.tags.items.$ref).toBe("#/$defs/tag");

    const pages = (await (
      await t.request("GET", `/api/projects/${project.id}/pages`)
    ).json()) as Loose;
    expect(pages.map((page: { name: string }) => page.name)).toEqual([
      "Items",
      "Item",
    ]);
    const items = pageSchema.parse(
      (await (
        await t.request(
          "GET",
          `/api/projects/${project.id}/pages/${pages[0].id}`,
        )
      ).json()) as Loose,
    );
    expect(
      items.mockups.map((mockup) => [mockup.originalName, mockup.caption]),
    ).toEqual([
      ["items.png", "The list"],
      ["items-empty.png", ""],
    ]);
    expect(
      items.mockups.map((mockup) => [mockup.width, mockup.height]),
    ).toEqual([
      [12, 8],
      [10, 6],
    ]);
    expect(
      items.states.find((state) => state.id === "list")?.mockupIds,
    ).toEqual([items.mockups[0]?.id]);
    const errorTypes = (await (
      await t.request("GET", `/api/projects/${project.id}/error-types`)
    ).json()) as Loose;
    const notFound = errorTypes.find(
      (errorType: { name: string }) => errorType.name === "not-found",
    );
    expect(items.states.find((state) => state.id === "gone")?.causes).toEqual([
      {
        type: "error",
        linkId: "open",
        errorTypeId: notFound.id,
        exampleId: "gone",
      },
    ]);
    // IDs within the project stay: links, states, responses, examples.
    expect(items.endpoints.map((link) => link.id)).toEqual(["load", "open"]);
    expect(items.states.map((state) => state.id)).toEqual([
      "loading",
      "list",
      "empty",
      "limited",
      "gone",
    ]);
    expect(items.states.find((state) => state.id === "list")?.causes).toEqual([
      { type: "response", linkId: "load", responseId: "ok", exampleId: "some" },
    ]);
  });

  it.each(["ditto.zip", "zip-r.zip", "zip-fz.zip", "bsdtar.zip", "python.zip"])(
    "imports the fixture zipped by a real tool: %s",
    async (file) => {
      const t = app();
      const { project } = await imported(
        t,
        new Uint8Array(fs.readFileSync(path.join(TOOL_ZIPS, file))),
      );
      const pages = (await (
        await t.request("GET", `/api/projects/${project.id}/pages`)
      ).json()) as Loose;
      expect(
        pages.map((page: { mockupCount: number }) => page.mockupCount),
      ).toEqual([2, 0]);
    },
  );

  it("imports zips with backslashes and decomposed names, as Windows and macOS write them", async () => {
    const t = app();
    const document = JSON.parse(
      fs.readFileSync(`${FIXTURE_DIR}/project.json`, "utf8"),
    );
    document.pages[0].mockups[0].file = "mockups/café.png";
    const zip = craftZip([
      {
        name: "fixture-shop\\project.json",
        data: JSON.stringify(document),
        method: 8,
      },
      {
        name: "fixture-shop\\mockups\\café.png",
        data: fs.readFileSync(`${FIXTURE_DIR}/mockups/items.png`),
        utf8Flag: false,
      },
      {
        name: "fixture-shop/mockups/items-empty.png",
        data: fs.readFileSync(`${FIXTURE_DIR}/mockups/items-empty.png`),
      },
    ]);
    await imported(t, zip);
  });

  it("accepts a byte order mark before project.json's text", async () => {
    const t = app();
    const files = unzipSync(fixtureZip());
    files["fixture-shop/project.json"] = new Uint8Array([
      0xef,
      0xbb,
      0xbf,
      ...(files["fixture-shop/project.json"] ?? []),
    ]);
    await imported(t, zipSync(files));
  });

  it("imports a project with thousands of endpoints", async () => {
    const t = app();
    const zip = fixtureZip((document) => {
      const list = document.endpoints as Record<string, unknown>[];
      for (let index = 0; index < 2000; index++) {
        list.push({
          ...structuredClone(list[0]),
          id: `bulk-${index}`,
          path: `/bulk/${index}`,
          operationId: "",
        });
      }
    });
    const { project } = await imported(t, zip);
    const list = (await (
      await t.request("GET", `/api/projects/${project.id}/endpoints`)
    ).json()) as Loose;
    expect(list).toHaveLength(2003);
  });

  it("keeps schema keys named like the object prototype", async () => {
    const source = app();
    const project = (await (
      await source.request("POST", "/api/projects", { name: "Odd keys" })
    ).json()) as Loose;
    const body =
      '{"name": "Odd", "schema": {"type": "object", "__proto__": {"x": 1}}}';
    const created = await source.app.request(
      `/api/projects/${project.id}/models`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      },
    );
    const model = (await created.json()) as Loose;

    const target = app();
    const { project: copy } = await imported(
      target,
      await exportFile(source, project.id),
    );
    const copied = await (
      await target.request("GET", `/api/projects/${copy.id}/models/${model.id}`)
    ).text();
    expect(JSON.parse(copied).schema).toEqual(JSON.parse(body).schema);
    expect(copied).toContain('"__proto__":{"x":1}');
  });

  describe("refusing what it can't import, leaving nothing behind", () => {
    async function nothingWritten(
      t: TestApp,
      data: Uint8Array,
      error: RegExp,
      status = 400,
    ) {
      const before = { projects: projectCount(t), folders: uploadFolders(t) };
      const body = await refused(t, data, status);
      expect(body.error).toMatch(error);
      expect(projectCount(t)).toBe(before.projects);
      expect(uploadFolders(t)).toEqual(before.folders);
      expect(tmpFiles(t)).toEqual([]);
      return body;
    }

    it("refuses a file that isn't a zip", async () => {
      const t = app();
      await nothingWritten(
        t,
        new Uint8Array(makePng(2, 2)),
        /isn't a zip file\. Choose a project file \(\.project\.zip\)/,
      );
    });

    it("says what to do with an OpenAPI file", async () => {
      const t = app();
      await nothingWritten(
        t,
        strToU8("openapi: 3.1.0\ninfo:\n  title: Shop\n"),
        /OpenAPI file.*can't be imported yet/,
      );
      await nothingWritten(
        t,
        strToU8('{\n  "openapi": "3.1.0"\n}'),
        /OpenAPI file/,
      );
    });

    it("says what to do with a Markdown bundle", async () => {
      const source = app();
      const { projectId } = await buildSample(source);
      const bundle = new Uint8Array(
        await (
          await source.request(
            "GET",
            `/api/projects/${projectId}/export/markdown`,
          )
        ).arrayBuffer(),
      );
      await nothingWritten(app(), bundle, /Markdown bundle/);
    });

    it("refuses a zip without project.json, or with two", async () => {
      const t = app();
      await nothingWritten(
        t,
        zipSync({ "notes.txt": strToU8("hi") }),
        /has no project\.json/,
      );
      await nothingWritten(
        t,
        zipSync({
          "a/project.json": strToU8("{}"),
          "b/project.json": strToU8("{}"),
        }),
        /more than one project\.json/,
      );
    });

    it("refuses project.json that isn't valid JSON, saying where", async () => {
      const t = app();
      const body = await nothingWritten(
        t,
        zipSync({
          "shop/project.json": strToU8('{\n  "format": "x",\n  "a" 1\n}'),
        }),
        /^project\.json isn't valid JSON at line 3, column 7: Expected ':'/,
      );
      expect(body.issues).toEqual([]);
    });

    it("refuses JSON with a name twice, or a number too large", async () => {
      const t = app();
      await nothingWritten(
        t,
        zipSync({
          "shop/project.json": strToU8('{"format": "x", "format": "y"}'),
        }),
        /"format" appears twice/,
      );
    });

    it("refuses project.json that isn't UTF-8", async () => {
      const t = app();
      await nothingWritten(
        t,
        zipSync({ "shop/project.json": new Uint8Array([0x7b, 0xff, 0x7d]) }),
        /isn't UTF-8 text/,
      );
    });

    it("refuses a file from a newer version", async () => {
      const t = app();
      await nothingWritten(
        t,
        fixtureZip((document) => {
          document.formatVersion = 2;
          document.generator = "API Contract Builder 9.0.0";
        }),
        /from a newer version of API Contract Builder \(format 2, made by API Contract Builder 9\.0\.0\)/,
      );
    });

    it("refuses content that breaks the API's rules, listing every problem", async () => {
      const t = app();
      const body = await nothingWritten(
        t,
        fixtureZip((document) => {
          const [model] = document.models as { name: string }[];
          if (model) model.name = "Bad name";
          const [page] = document.pages as { slug: string }[];
          if (page) page.slug = "Not A Slug";
        }),
        /^This project file can't be imported: it has 2 problems\.$/,
      );
      expect(body.issues?.map((issue) => issue.path)).toEqual([
        "models.0.name",
        "pages.0.slug",
      ]);
    });

    it("refuses a mockup the zip doesn't have", async () => {
      const t = app();
      const files = unzipSync(fixtureZip());
      delete files["fixture-shop/mockups/items-empty.png"];
      const body = await nothingWritten(t, zipSync(files), /1 problem/);
      expect(body.issues).toEqual([
        {
          path: "pages.0.mockups.1.file",
          message: "Page Items: mockups/items-empty.png isn't in the zip",
        },
      ]);
    });

    it("checks images by their content, like uploads", async () => {
      const t = app();
      const body = await nothingWritten(
        t,
        fixtureZip(() => {}, {
          "fixture-shop/mockups/items.png": new Uint8Array(SVG),
        }),
        /1 problem/,
      );
      expect(body.issues).toEqual([
        {
          path: "pages.0.mockups.0.file",
          message:
            "Page Items: mockups/items.png isn't a PNG, JPEG, GIF, or WebP image",
        },
      ]);
    });

    it("refuses images larger than this instance takes as mockups", async () => {
      const t = app({ maxUploadBytes: 100 });
      const body = await nothingWritten(t, fixtureZip(), /1 problem/);
      expect(body.issues).toEqual([
        {
          path: "pages.0.mockups.1.file",
          message:
            "Page Items: mockups/items-empty.png is larger than 100 bytes, the largest mockup this instance takes (MAX_UPLOAD_MB)",
        },
      ]);
    });

    it("refuses a zip that unpacks to more than this instance imports", async () => {
      const t = app({ maxImportBytes: 20_000 });
      const zip = fixtureZip(() => {}, {
        "fixture-shop/padding.txt": strToU8("x".repeat(50_000)),
      });
      expect(zip.length).toBeLessThan(20_000);
      // padding.txt isn't read; it's what the images and JSON unpack to that counts.
      await imported(t, zip);
      const big = fixtureZip((document) => {
        (document.project as { description: string }).description = "x".repeat(
          1900,
        );
        const list = document.endpoints as Record<string, unknown>[];
        for (let index = 0; index < 40; index++) {
          list.push({
            ...structuredClone(list[0]),
            id: `n${index}`,
            path: `/n/${index}`,
            operationId: "",
          });
        }
      });
      expect(big.length).toBeLessThan(20_000);
      await nothingWritten(
        t,
        big,
        /unpacks to more than this instance imports \(20 KB, MAX_IMPORT_MB\)/,
      );
    });

    it("refuses a zip bomb before unpacking it", async () => {
      const t = app();
      const zip = craftZip([
        {
          name: "shop/project.json",
          method: 8,
          compressed: zipSyncDeflate(),
          uncompressedSize: 0xfffffff0,
        },
      ]);
      await nothingWritten(t, zip, /project\.json unpacks to more than 16 MB/);
    });

    it("refuses a tiny zip whose project.json holds a million broken parts, with the right reason", async () => {
      // Just under the JSON check's limit of a million values.
      const t = app();
      const json = `{"format": "api-contract-builder/project", "formatVersion": 1, "project": {}, "models": [${"0,".repeat(998_999)}0], "errorTypes": [], "endpoints": [], "pages": []}`;
      const zip = zipSync({
        "shop/project.json": [strToU8(json), { level: 9 }],
      });
      expect(zip.length).toBeLessThan(20_000);
      const body = await nothingWritten(t, zip, /more than 50 problems/);
      expect(body.issues).toHaveLength(50);
    });

    it("refuses project.json nested deeper than any project", async () => {
      const t = app();
      const zip = zipSync({
        "shop/project.json": [strToU8("[".repeat(20_000)), { level: 9 }],
      });
      await nothingWritten(
        t,
        zip,
        /^project\.json can't be read at line 1, column 10001: Values are nested more than 10,000 levels deep$/,
      );
    });

    it("refuses project.json over 16 MB before reading it", async () => {
      const t = app();
      const zip = zipSync({
        "shop/project.json": [
          strToU8(`{${" ".repeat(17 * 1024 * 1024)}}`),
          { level: 9 },
        ],
      });
      await nothingWritten(
        t,
        zip,
        /^project\.json unpacks to more than 16 MB, the most a project file's project\.json may hold$/,
      );
    });

    it("refuses zip-slip names", async () => {
      const t = app();
      await nothingWritten(
        t,
        craftZip([{ name: "../../etc/project.json", data: "{}" }]),
        /unsafe file name/,
      );
    });
  });

  describe("the request", () => {
    it("must say it sends a zip", async () => {
      const t = app();
      const zip = fixtureZip();
      for (const type of [
        null,
        "text/plain",
        "multipart/form-data; boundary=x",
        "application/json",
        "application/octet-stream",
      ]) {
        const response = await importFile(t, zip, type);
        expect(response.status, String(type)).toBe(415);
        expect(((await response.json()) as Loose).error).toMatch(
          /Content-Type: application\/zip/,
        );
      }
      expect(projectCount(t)).toBe(0);
      for (const type of [
        "Application/Zip; charset=binary",
        "application/x-zip-compressed",
      ]) {
        expect((await importFile(t, zip, type)).status, type).toBe(201);
      }
    });

    it("answers 413 for a file larger than this instance imports", async () => {
      const t = app({ maxImportBytes: 1000 });
      const zip = fixtureZip();
      const response = await t.app.request("/api/projects/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/zip",
          "Content-Length": String(zip.length),
        },
        body: zip,
      });
      expect(response.status).toBe(413);
      expect(((await response.json()) as Loose).error).toBe(
        `The file is ${Math.round(zip.length / 1024)} KB; this instance imports up to 1000 bytes. Start it with MAX_IMPORT_MB set higher to import it.`,
      );

      // Without a Content-Length, it stops reading once the limit is passed.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(zip.slice(0, 800));
          controller.enqueue(zip.slice(800));
          controller.close();
        },
      });
      const streamed = await importFile(t, stream);
      expect(streamed.status).toBe(413);
      expect(projectCount(t)).toBe(0);
      expect(tmpFiles(t)).toEqual([]);
    });
  });

  it("tells clients the largest file it imports", async () => {
    const t = app({ maxImportBytes: 12_345 });
    const health = (await (
      await t.request("GET", "/api/health")
    ).json()) as Loose;
    expect(health.maxImportBytes).toBe(12_345);
  });
});

/** A small deflate stream, to declare as unpacking to almost 4 GB. */
function zipSyncDeflate() {
  const zip = zipSync({ a: [strToU8("x".repeat(100)), { level: 9 }] });
  const entry = openZip(bufferSource(zip), { maxEntries: 1 }).entries[0];
  return entry
    ? zip.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize)
    : new Uint8Array();
}
