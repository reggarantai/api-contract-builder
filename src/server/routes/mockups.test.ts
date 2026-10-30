import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GIF_1X1,
  JPEG_1X1,
  makePng,
  SVG,
  WEBP_1X1,
} from "../../../test/images";
import { apiErrorSchema } from "../../shared/api-error";
import { mockupSchema, pageSchema } from "../../shared/pages";
import { projectSchema } from "../../shared/projects";
import { createTestApp } from "../test-utils";

const MAX_UPLOAD_BYTES = 2048;

describe("mockups API", () => {
  let t: ReturnType<typeof createTestApp>;
  let projectId: string;
  let pageId: string;

  beforeEach(async () => {
    t = createTestApp({ maxUploadBytes: MAX_UPLOAD_BYTES });
    const project = await t.request("POST", "/api/projects", { name: "Shop" });
    projectId = projectSchema.parse(await project.json()).id;
    const page = await t.request("POST", `/api/projects/${projectId}/pages`, {
      name: "Login",
    });
    pageId = pageSchema.parse(await page.json()).id;
  });

  afterEach(() => {
    t.close();
  });

  const mockupsUrl = () => `/api/projects/${projectId}/pages/${pageId}/mockups`;
  const png = (name: string, width = 3, height = 2, noise = false) => ({
    name,
    type: "image/png",
    data: makePng(width, height, { noise }),
  });

  async function upload(files: Parameters<typeof t.upload>[1]) {
    const response = await t.upload(mockupsUrl(), files);
    expect(response.status).toBe(201);
    return mockupSchema.array().parse(await response.json());
  }

  async function getPage() {
    const response = await t.request(
      "GET",
      `/api/projects/${projectId}/pages/${pageId}`,
    );
    return pageSchema.parse(await response.json());
  }

  function fileOf(url: string) {
    return path.join(t.uploadsDir, url.replace(/^\/uploads\//, ""));
  }

  it("uploads images and reads their size", async () => {
    const mockups = await upload([
      png("form.png", 3, 2),
      { name: "error.jpg", type: "image/jpeg", data: JPEG_1X1 },
    ]);

    expect(mockups).toMatchObject([
      {
        pageId,
        originalName: "form.png",
        mimeType: "image/png",
        width: 3,
        height: 2,
        caption: "",
      },
      {
        originalName: "error.jpg",
        mimeType: "image/jpeg",
        width: 1,
        height: 1,
      },
    ]);
    expect(mockups[0]?.url).toMatch(
      new RegExp(`^/uploads/${projectId}/[0-9A-Z]{26}\\.png$`),
    );
    expect((await getPage()).mockups.map((m) => m.originalName)).toEqual([
      "form.png",
      "error.jpg",
    ]);
  });

  it("accepts GIF and WebP", async () => {
    const mockups = await upload([
      { name: "a.gif", type: "image/gif", data: GIF_1X1 },
      { name: "b.webp", type: "image/webp", data: WEBP_1X1 },
    ]);

    expect(mockups.map((m) => m.mimeType)).toEqual(["image/gif", "image/webp"]);
  });

  it("serves uploaded files with a long cache", async () => {
    const [mockup] = await upload([png("form.png")]);

    const response = await t.app.request(mockup?.url ?? "");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(makePng(3, 2));
  });

  it("checks file contents, not names, and saves nothing on failure", async () => {
    const response = await t.upload(mockupsUrl(), [
      png("good.png"),
      {
        name: "fake.png",
        type: "image/png",
        data: Buffer.from("not an image"),
      },
      { name: "icon.svg", type: "image/svg+xml", data: SVG },
    ]);

    expect(response.status).toBe(400);
    expect((await apiErrorSchema.parse(await response.json())).issues).toEqual([
      {
        path: "files.1",
        message: "fake.png isn't a PNG, JPEG, GIF, or WebP image",
      },
      {
        path: "files.2",
        message: "icon.svg isn't a PNG, JPEG, GIF, or WebP image",
      },
    ]);
    expect((await getPage()).mockups).toEqual([]);
    expect(fs.existsSync(path.join(t.uploadsDir, projectId))).toBe(false);
  });

  it("rejects files over the size limit", async () => {
    const big = png("big.png", 64, 64, true);
    expect(big.data.length).toBeGreaterThan(MAX_UPLOAD_BYTES);

    const response = await t.upload(mockupsUrl(), [big]);

    expect(response.status).toBe(400);
    expect((await apiErrorSchema.parse(await response.json())).issues).toEqual([
      { path: "files.0", message: "big.png is larger than 2 KB" },
    ]);
  });

  it("requires at least one file", async () => {
    const response = await t.upload(mockupsUrl(), []);

    expect(response.status).toBe(400);
  });

  it("updates captions and order", async () => {
    const [first, second] = await upload([png("a.png"), png("b.png")]);
    if (!first || !second) throw new Error("expected two mockups");

    const captioned = await t.request("PATCH", `${mockupsUrl()}/${second.id}`, {
      caption: "Wrong password",
    });
    const reordered = await t.request("PUT", `${mockupsUrl()}/order`, {
      mockupIds: [second.id, first.id],
    });

    expect(captioned.status).toBe(200);
    expect(reordered.status).toBe(200);
    expect((await getPage()).mockups).toMatchObject([
      { id: second.id, caption: "Wrong password" },
      { id: first.id, caption: "" },
    ]);
  });

  it("deletes a mockup and its file", async () => {
    const [mockup] = await upload([png("a.png")]);
    if (!mockup) throw new Error("expected a mockup");

    const deleted = await t.request("DELETE", `${mockupsUrl()}/${mockup.id}`);

    expect(deleted.status).toBe(204);
    expect(fs.existsSync(fileOf(mockup.url))).toBe(false);
    expect((await t.app.request(mockup.url)).status).toBe(404);
  });

  it("removes files with their page", async () => {
    const [mockup] = await upload([png("a.png")]);
    if (!mockup) throw new Error("expected a mockup");
    expect(fs.existsSync(fileOf(mockup.url))).toBe(true);

    await t.request("DELETE", `/api/projects/${projectId}/pages/${pageId}`);

    expect(fs.existsSync(fileOf(mockup.url))).toBe(false);
  });

  it("removes the project's files with the project", async () => {
    await upload([png("a.png")]);

    await t.request("DELETE", `/api/projects/${projectId}`);

    expect(fs.existsSync(path.join(t.uploadsDir, projectId))).toBe(false);
    expect(
      t.db.$client.prepare("select count(*) as count from page_mockups").get(),
    ).toEqual({ count: 0 });
  });
});
