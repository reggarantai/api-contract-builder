import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { healthResponseSchema } from "../shared/health";
import { createApp } from "./app";
import { type OpenedDatabase, openDatabase } from "./db/client";
import { createTempDir, migrationsDir } from "./test-utils";

describe("app", () => {
  let temp: ReturnType<typeof createTempDir>;
  let database: OpenedDatabase;

  beforeEach(() => {
    temp = createTempDir("app");
    database = openDatabase(path.join(temp.dir, "app.db"), migrationsDir);
  });

  afterEach(() => {
    database.close();
    temp.cleanup();
  });

  it("reports health with the app version", async () => {
    const app = createApp({
      db: database.db,
      version: "1.2.3",
      clientDir: null,
      uploadsDir: path.join(temp.dir, "uploads"),
      maxUploadBytes: 1024,
      samplesDir: path.resolve("samples"),
    });

    const response = await app.request("/api/health");

    expect(response.status).toBe(200);
    const body = healthResponseSchema.parse(await response.json());
    expect(body.version).toBe("1.2.3");
  });

  it("returns a JSON 404 for unknown API routes", async () => {
    const app = createApp({
      db: database.db,
      version: "1.2.3",
      clientDir: null,
      uploadsDir: path.join(temp.dir, "uploads"),
      maxUploadBytes: 1024,
      samplesDir: path.resolve("samples"),
    });

    const response = await app.request("/api/does-not-exist");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });

  describe("with a client build", () => {
    let clientDir: string;

    beforeEach(() => {
      clientDir = path.join(temp.dir, "client");
      fs.mkdirSync(path.join(clientDir, "assets"), { recursive: true });
      fs.writeFileSync(path.join(clientDir, "index.html"), "<!doctype html>");
      fs.writeFileSync(path.join(clientDir, "assets", "app.js"), "// app");
    });

    it("serves static assets", async () => {
      const app = createApp({
        db: database.db,
        version: "1.2.3",
        clientDir,
        uploadsDir: path.join(temp.dir, "uploads"),
        maxUploadBytes: 1024,
        samplesDir: path.resolve("samples"),
      });

      const response = await app.request("/assets/app.js");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("// app");
    });

    it("serves the SPA shell for client-side routes", async () => {
      const app = createApp({
        db: database.db,
        version: "1.2.3",
        clientDir,
        uploadsDir: path.join(temp.dir, "uploads"),
        maxUploadBytes: 1024,
        samplesDir: path.resolve("samples"),
      });

      const response = await app.request("/projects/some-project");

      expect(response.status).toBe(200);
      expect(await response.text()).toBe("<!doctype html>");
    });

    it("keeps unknown API routes as JSON 404", async () => {
      const app = createApp({
        db: database.db,
        version: "1.2.3",
        clientDir,
        uploadsDir: path.join(temp.dir, "uploads"),
        maxUploadBytes: 1024,
        samplesDir: path.resolve("samples"),
      });

      const response = await app.request("/api/does-not-exist");

      expect(response.status).toBe(404);
    });
  });
});
