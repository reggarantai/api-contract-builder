import fs from "node:fs";
import path from "node:path";
import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildSample, createTestApp, readSampleMockup } from "../test-utils";

const GOLDEN_DIR = path.resolve("test/golden/inventory-markdown");
// What 0.2.0 exported, before page states. Projects that don't use them must
// keep exporting exactly this, so never regenerate it.
const WITHOUT_STATES_DIR = path.resolve(
  "test/golden/inventory-markdown-without-states",
);
const OPENAPI_GOLDEN = path.resolve("test/golden/inventory.openapi.yaml");

describe("Markdown export", () => {
  let t: ReturnType<typeof createTestApp>;
  let fixture: Awaited<ReturnType<typeof buildSample>>;

  beforeEach(async () => {
    t = createTestApp();
    fixture = await buildSample(t);
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
      "inventory-app/error-types.md",
      "inventory-app/images/add-or-edit-stock-item/01-stock-item-form.png",
      "inventory-app/images/app-shell/01-app-shell.png",
      "inventory-app/images/forgot-password/01-forgot-password.png",
      "inventory-app/images/login/01-login-form.png",
      "inventory-app/images/login/02-login-error.png",
      "inventory-app/images/registration/01-registration-form.png",
      "inventory-app/images/registration/02-registration-check-email.png",
      "inventory-app/images/reset-password/01-reset-password.png",
      "inventory-app/images/stock-item/01-stock-item.png",
      "inventory-app/images/stock-item/02-record-movement.png",
      "inventory-app/images/stock-list/01-stock-list.png",
      "inventory-app/images/stock-list/02-stock-list-loading.png",
      "inventory-app/images/stock-list/03-stock-list-empty.png",
      "inventory-app/images/stock-list/04-stock-list-delete-error.png",
      "inventory-app/images/verify-email/01-verify-email-expired.png",
      "inventory-app/inventory-app.openapi.yaml",
      "inventory-app/models.md",
      "inventory-app/pages/add-or-edit-stock-item.md",
      "inventory-app/pages/app-shell.md",
      "inventory-app/pages/forgot-password.md",
      "inventory-app/pages/login.md",
      "inventory-app/pages/registration.md",
      "inventory-app/pages/reset-password.md",
      "inventory-app/pages/stock-item.md",
      "inventory-app/pages/stock-list.md",
      "inventory-app/pages/verify-email.md",
    ]);
    expect(text(files, "inventory-app/inventory-app.openapi.yaml")).toBe(
      fs.readFileSync(OPENAPI_GOLDEN, "utf8"),
    );
    expect(files["inventory-app/images/login/02-login-error.png"]).toEqual(
      new Uint8Array(readSampleMockup("login-error")),
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
      `?page=${fixture.pageIds.stockList}`,
    );

    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="inventory-app.stock-list.contract.zip"',
    );
    expect(Object.keys(files).sort()).toEqual([
      "inventory-app/README.md",
      "inventory-app/error-types.md",
      "inventory-app/images/stock-list/01-stock-list.png",
      "inventory-app/images/stock-list/02-stock-list-loading.png",
      "inventory-app/images/stock-list/03-stock-list-empty.png",
      "inventory-app/images/stock-list/04-stock-list-delete-error.png",
      "inventory-app/inventory-app.stock-list.openapi.yaml",
      "inventory-app/models.md",
      "inventory-app/pages/stock-list.md",
    ]);
    const models = text(files, "inventory-app/models.md");
    expect(models).toContain("## StockItem");
    expect(models).toContain("## Category");
    expect(models).toContain("## Problem");
    expect(models).not.toContain("## StockMovement");
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

  it("exports a project without page states exactly as before them", async () => {
    const plain = createTestApp();
    try {
      const sample = await buildSample(plain, { states: false });
      const response = await plain.request(
        "GET",
        `/api/projects/${sample.projectId}/export/markdown`,
      );
      const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
      const names = Object.keys(files).sort();
      const markdown = names.filter((name) => name.endsWith(".md"));

      expect(
        markdown.map((name) => name.replace(/^inventory-app\//, "")),
      ).toEqual(
        fs
          .readdirSync(WITHOUT_STATES_DIR, {
            recursive: true,
            encoding: "utf8",
          })
          .filter((name) => name.endsWith(".md"))
          .sort(),
      );
      for (const name of markdown) {
        expect(text(files, name), name).toBe(
          fs.readFileSync(
            path.join(WITHOUT_STATES_DIR, name.replace(/^inventory-app\//, "")),
            "utf8",
          ),
        );
      }
      expect(names.filter((name) => name.endsWith(".png"))).toEqual([
        "inventory-app/images/add-or-edit-stock-item/01-stock-item-form.png",
        "inventory-app/images/app-shell/01-app-shell.png",
        "inventory-app/images/forgot-password/01-forgot-password.png",
        "inventory-app/images/login/01-login-form.png",
        "inventory-app/images/login/02-login-error.png",
        "inventory-app/images/registration/01-registration-form.png",
        "inventory-app/images/registration/02-registration-check-email.png",
        "inventory-app/images/reset-password/01-reset-password.png",
        "inventory-app/images/stock-item/01-stock-item.png",
        "inventory-app/images/stock-item/02-record-movement.png",
        "inventory-app/images/stock-list/01-stock-list.png",
        "inventory-app/images/verify-email/01-verify-email-expired.png",
      ]);
      // Page states never reach the OpenAPI document.
      expect(text(files, "inventory-app/inventory-app.openapi.yaml")).toBe(
        fs.readFileSync(OPENAPI_GOLDEN, "utf8"),
      );
    } finally {
      plain.close();
    }
  });
});
