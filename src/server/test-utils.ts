import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "./app";
import { openDatabase } from "./db/client";

export const migrationsDir = path.resolve("drizzle");

/** Creates a temporary directory and returns it with a cleanup function. */
export function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `acb-${prefix}-`));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** An app backed by a fresh database in a temporary directory. */
export function createTestApp() {
  const temp = createTempDir("app");
  const database = openDatabase(path.join(temp.dir, "app.db"), migrationsDir);
  const app = createApp({ db: database.db, version: "1.2.3", clientDir: null });

  return {
    app,
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
    close() {
      database.close();
      temp.cleanup();
    },
  };
}
