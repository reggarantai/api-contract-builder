import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { openDatabase } from "./db/client";
import { buildInventorySample } from "./samples/inventory";

export const migrationsDir = path.resolve("drizzle");

/** Creates a temporary directory and returns it with a cleanup function. */
export function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `acb-${prefix}-`));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** An app backed by a fresh database and uploads folder in a temporary directory. */
export function createTestApp({ maxUploadBytes = 1024 * 1024 } = {}) {
  const temp = createTempDir("app");
  const database = openDatabase(path.join(temp.dir, "app.db"), migrationsDir);
  const uploadsDir = path.join(temp.dir, "uploads");
  const app = createApp({
    db: database.db,
    version: "1.2.3",
    clientDir: null,
    uploadsDir,
    maxUploadBytes,
    samplesDir: path.resolve("samples"),
  });

  return {
    app,
    db: database.db,
    uploadsDir,
    request(method: string, url: string, body?: unknown) {
      return app.request(url, {
        method,
        headers:
          body === undefined
            ? undefined
            : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    upload(
      url: string,
      files: { name: string; type: string; data: Uint8Array }[],
    ) {
      const form = new FormData();
      for (const file of files) {
        form.append(
          "files",
          new File([file.data], file.name, { type: file.type }),
        );
      }
      return app.request(url, { method: "POST", body: form });
    },
    close() {
      database.close();
      temp.cleanup();
    },
  };
}

/** A mockup image of the sample project, from samples/mockups. */
export function readSampleMockup(name: string) {
  return fs.readFileSync(path.resolve("samples/mockups", `${name}.png`));
}

/** Builds the sample project in a test app. */
export function buildSample(t: ReturnType<typeof createTestApp>) {
  return buildInventorySample(
    { request: t.request, upload: t.upload },
    readSampleMockup,
  );
}
