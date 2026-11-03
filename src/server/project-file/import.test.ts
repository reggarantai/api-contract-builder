import fs from "node:fs";
import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageMockups, projects } from "../db/schema";
import { createUploadStorage } from "../storage/uploads";
import { createTestApp } from "../test-utils";
import { importProjectFile } from "./import";
import { bufferSource } from "./zip";

const FIXTURE_DIR = path.resolve("test/fixtures/project-file-v1");

function fixtureZip(endpoints = 0) {
  const read = (name: string) => fs.readFileSync(path.join(FIXTURE_DIR, name));
  const document = JSON.parse(read("project.json").toString("utf8"));
  for (let index = 0; index < endpoints; index++) {
    document.endpoints.push({
      ...structuredClone(document.endpoints[0]),
      id: `bulk-${index}`,
      path: `/bulk/${index}`,
      operationId: "",
    });
  }
  return zipSync({
    "shop/project.json": strToU8(JSON.stringify(document)),
    "shop/mockups/items.png": read("mockups/items.png"),
    "shop/mockups/items-empty.png": read("mockups/items-empty.png"),
  });
}

describe("importing all or nothing", () => {
  let t: ReturnType<typeof createTestApp>;
  afterEach(() => t.close());

  function context(
    overrides: Partial<Parameters<typeof importProjectFile>[0]> = {},
  ) {
    return {
      db: t.db,
      storage: createUploadStorage(t.uploadsDir),
      limits: { maxImportBytes: 10 * 1024 * 1024, maxUploadBytes: 1024 * 1024 },
      appVersion: "1.2.3",
      tmpDir: t.tmpDir,
      ...overrides,
    };
  }

  function leftovers() {
    const list = (dir: string) =>
      fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    return {
      projects: t.db.select().from(projects).all().length,
      mockups: t.db.select().from(pageMockups).all().length,
      folders: list(t.uploadsDir),
      waiting: list(t.tmpDir),
    };
  }
  const nothing = { projects: 0, mockups: 0, folders: [], waiting: [] };

  it("takes everything back when the database refuses the project", () => {
    t = createTestApp();
    // The same ID for everything: the second model can't be inserted.
    expect(() =>
      importProjectFile(
        context({ newId: () => "01ARZ3NDEKTSV4RRFFQ69G5FAV" }),
        bufferSource(fixtureZip()),
      ),
    ).toThrow(/UNIQUE constraint failed/);

    expect(leftovers()).toEqual(nothing);
  });

  it("takes everything back when moving the images in fails", () => {
    t = createTestApp();
    const storage = createUploadStorage(t.uploadsDir);
    const failing = {
      ...storage,
      adoptProject() {
        throw new Error("The disk is full");
      },
    };

    expect(() =>
      importProjectFile(
        context({ storage: failing }),
        bufferSource(fixtureZip()),
      ),
    ).toThrow("The disk is full");

    expect(leftovers()).toEqual(nothing);
  });

  it("writes nothing when the images can't wait anywhere", () => {
    t = createTestApp();
    const notAFolder = path.join(t.tmpDir, "file");
    fs.mkdirSync(t.tmpDir, { recursive: true });
    fs.writeFileSync(notAFolder, "x");

    expect(() =>
      importProjectFile(
        context({ tmpDir: notAFolder }),
        bufferSource(fixtureZip()),
      ),
    ).toThrow(/ENOTDIR/);

    expect(leftovers()).toEqual({ ...nothing, waiting: ["file"] });
  });

  it("moves the images of a project it saved in place", () => {
    t = createTestApp();
    const result = importProjectFile(context(), bufferSource(fixtureZip()));

    expect("project" in result).toBe(true);
    const { folders, waiting } = leftovers();
    expect(waiting).toEqual([]);
    expect(folders).toHaveLength(1);
    expect(
      fs.readdirSync(path.join(t.uploadsDir, folders[0] ?? "")),
    ).toHaveLength(2);
  });

  it("prepares each insert once, however many rows the file has", () => {
    t = createTestApp();
    // Statements are native memory, freed only after the import, so a file
    // of many small parts must not make one per row.
    const client = (t.db as unknown as { $client: { prepare: () => unknown } })
      .$client;
    const prepare = vi.spyOn(client, "prepare");

    const result = importProjectFile(context(), bufferSource(fixtureZip(2000)));

    expect("project" in result).toBe(true);
    expect(prepare.mock.calls.length).toBeLessThan(40);
  });
});
