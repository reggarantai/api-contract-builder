import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, describe, expect, it } from "vitest";
import { exportReportSchema } from "../../shared/export";
import { projectImportResultSchema } from "../../shared/project-file";
import { createTestApp } from "../test-utils";

// The frozen OpenAPI documents in test/fixtures/openapi, imported: the
// project file each becomes, its notices, and the OpenAPI the app writes
// back, against test/golden/openapi-import. The JSON and YAML forms of one
// document share their golden files. UPDATE_GOLDEN=1 writes them.

const FIXTURES = path.resolve("test/fixtures/openapi");
const GOLDEN = path.resolve("test/golden/openapi-import");
const ULID = /[0-9A-HJKMNP-TV-Z]{26}/;

type TestApp = ReturnType<typeof createTestApp>;
const apps: TestApp[] = [];
afterEach(() => {
  for (const created of apps.splice(0)) {
    created.close();
  }
});

/** IDs given names in the order they first appear, as the project file golden does. */
function normalized(json: string) {
  const document = JSON.parse(json);
  const names = new Map<string, string>([[document.project.id, "project"]]);
  for (const [kind, items] of [
    ["model", document.models],
    ["error-type", document.errorTypes],
    ["endpoint", document.endpoints],
    ["page", document.pages],
  ] as const) {
    (items as { id: string }[]).forEach((item, index) => {
      names.set(item.id, `${kind}-${index + 1}`);
    });
  }
  const result = json.replace(
    new RegExp(ULID.source, "g"),
    (id) => names.get(id) ?? "unknown-id",
  );
  expect(result).not.toContain("unknown-id");
  return result.replace(
    /"generator": "API Contract Builder [^"]+"/,
    '"generator": "API Contract Builder"',
  );
}

function golden(name: string, content: string) {
  const file = path.join(GOLDEN, name);
  if (process.env.UPDATE_GOLDEN) {
    fs.mkdirSync(GOLDEN, { recursive: true });
    fs.writeFileSync(file, content);
  }
  expect(content, name).toBe(fs.readFileSync(file, "utf8"));
}

describe.each([
  ["bookshop-3.0.yaml", "application/yaml", "bookshop-3.0"],
  ["bookshop-3.0.json", "application/json", "bookshop-3.0"],
  ["events-3.1.yaml", "application/yaml", "events-3.1"],
  ["events-3.1.json", "application/json", "events-3.1"],
  ["kiosk-3.2.yaml", "application/yaml", "kiosk-3.2"],
])("%s", (fixture, type, base) => {
  it("becomes the golden project, with the golden notices, and exports valid OpenAPI", async () => {
    const t = createTestApp();
    apps.push(t);
    const response = await t.app.request("/api/projects/import", {
      method: "POST",
      headers: { "Content-Type": type },
      body: fs.readFileSync(path.join(FIXTURES, fixture)),
    });
    const body = await response.json();
    expect(response.status, JSON.stringify(body).slice(0, 2000)).toBe(201);
    const { project, notices } = projectImportResultSchema.parse(body);

    const file = await t.request(
      "GET",
      `/api/projects/${project.id}/export/project`,
    );
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const json = strFromU8(
      files[`${project.slug}/project.json`] ?? new Uint8Array(),
    );
    golden(`${base}.project.json`, normalized(json));
    golden(`${base}.notices.json`, `${JSON.stringify(notices, null, 2)}\n`);

    const report = exportReportSchema.parse(
      await (
        await t.request("GET", `/api/projects/${project.id}/export/report`)
      ).json(),
    );
    expect(report.errors).toEqual([]);
    const openapi = await t.request(
      "GET",
      `/api/projects/${project.id}/export/openapi`,
    );
    expect(openapi.status).toBe(200);
    golden(`${base}.openapi.yaml`, await openapi.text());
  });
});
