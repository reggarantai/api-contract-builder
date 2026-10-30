import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const migrationsDir = path.resolve("drizzle");

/** Creates a temporary directory and returns it with a cleanup function. */
export function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `acb-${prefix}-`));
  return {
    dir,
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
