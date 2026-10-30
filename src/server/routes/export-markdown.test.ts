import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildInventoryProject,
  INVENTORY_MOCKUPS,
} from "../../../test/fixtures/inventory";
import { createTestApp } from "../test-utils";

const GOLDEN_DIR = path.resolve("test/golden/inventory-markdown");
const OPENAPI_GOLDEN = path.resolve("test/golden/inventory.openapi.yaml");

describe("Markdown export", () => {
  let t: ReturnType<typeof createTestApp>;
  let fixture: Awaited<ReturnType<typeof buildInventoryProject>>;

  beforeEach(async () => {
    t = createTestApp();
    fixture = await buildInventoryProject(t.request, t.upload);
  });

  afterEach(() => {
    t.close();
  });

  async function download(query = "") {
    const response = await t.request(
      "GET",
      `/api/projects/${fixture.projectId}/export/markdown${query}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
    return { response, files };
  }

  function text(files: Record<string, Uint8Array>, name: string) {
    const file = files[name];
    if (!file) {
      throw new Error(`${name} is not in the zip`);
    }
    return strFromU8(file);
  }

  it("bundles README, models, pages, images, and the OpenAPI file", async () => {
    const { response, files } = await download();

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.contract.zip"',
    );
    expect(Object.keys(files).sort()).toEqual([
      "inventory-app/README.md",
      "inventory-app/images/login/01-form.png",
      "inventory-app/images/login/02-error.png",
      "inventory-app/images/stock-list/01-table.png",
      "inventory-app/inventory-app.openapi.yaml",
      "inventory-app/models.md",
      "inventory-app/pages/add-stock.md",
      "inventory-app/pages/login.md",
      "inventory-app/pages/stock-detail.md",
      "inventory-app/pages/stock-list.md",
    ]);
    expect(text(files, "inventory-app/inventory-app.openapi.yaml")).toBe(
      fs.readFileSync(OPENAPI_GOLDEN, "utf8"),
    );
    expect(files["inventory-app/images/login/02-error.png"]).toEqual(
      new Uint8Array(INVENTORY_MOCKUPS.login[1]?.data ?? []),
    );
  });

  it("writes Markdown matching the golden files", async () => {
    const { files } = await download();

    const markdown = Object.keys(files).filter((name) => name.endsWith(".md"));
    for (const name of markdown) {
      const golden = path.join(
        GOLDEN_DIR,
        name.replace(/^inventory-app\//, ""),
      );
      if (process.env.UPDATE_GOLDEN) {
        fs.mkdirSync(path.dirname(golden), { recursive: true });
        fs.writeFileSync(golden, text(files, name));
      }
      expect(text(files, name), name).toBe(fs.readFileSync(golden, "utf8"));
    }
  });

  it("links every image and every page to a file in the zip", async () => {
    const { files } = await download();
    const names = new Set(Object.keys(files));
    const linkedImages = new Set<string>();

    for (const name of [...names].filter((file) => file.endsWith(".md"))) {
      const dir = path.posix.dirname(name);
      for (const [, image, target] of text(files, name).matchAll(
        /(!?)\[[^\]]*\]\(([^)#\s]+)(?:#[^)]*)?\)/g,
      )) {
        if (!target || /^https?:/.test(target)) {
          continue;
        }
        const resolved = path.posix.normalize(path.posix.join(dir, target));
        expect(names, `${name} links to ${target}`).toContain(resolved);
        if (image) {
          linkedImages.add(resolved);
        }
      }
    }
    expect([...linkedImages].sort()).toEqual(
      [...names].filter((name) => name.endsWith(".png")).sort(),
    );
  });

  it("exports a single page", async () => {
    const { response, files } = await download(
      `?page=${fixture.stockListPageId}`,
    );

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.stock-list.contract.zip"',
    );
    expect(Object.keys(files).sort()).toEqual([
      "inventory-app/README.md",
      "inventory-app/images/stock-list/01-table.png",
      "inventory-app/inventory-app.stock-list.openapi.yaml",
      "inventory-app/models.md",
      "inventory-app/pages/stock-list.md",
    ]);
    const models = text(files, "inventory-app/models.md");
    expect(models).toContain("## Stock");
    expect(models).toContain("## Category");
    expect(models).not.toContain("## Error");
  });

  it("leaves out the OpenAPI file while the contract isn't valid", async () => {
    await t.request("POST", `/api/projects/${fixture.projectId}/models`, {
      name: "Broken",
      schema: { type: "strng" },
    });

    const { files } = await download();

    expect(Object.keys(files)).not.toContain(
      "inventory-app/inventory-app.openapi.yaml",
    );
    expect(text(files, "inventory-app/README.md")).toContain(
      "isn't valid OpenAPI yet",
    );
  });

  it("rejects unknown pages and projects", async () => {
    const base = `/api/projects/${fixture.projectId}/export/markdown`;

    expect((await t.request("GET", `${base}?page=nope`)).status).toBe(404);
    expect(
      (await t.request("GET", "/api/projects/nope/export/markdown")).status,
    ).toBe(404);
  });
});
