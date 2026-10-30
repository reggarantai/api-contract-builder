import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDir, migrationsDir } from "../test-utils";
import { openDatabase } from "./client";
import { appMeta } from "./schema";

describe("openDatabase", () => {
  let temp: ReturnType<typeof createTempDir>;

  beforeEach(() => {
    temp = createTempDir("db");
  });

  afterEach(() => {
    temp.cleanup();
  });

  it("creates missing directories and applies migrations", () => {
    const databasePath = path.join(temp.dir, "nested", "app.db");
    const database = openDatabase(databasePath, migrationsDir);

    const rows = database.db.select().from(appMeta).all();
    database.close();

    expect(rows.map((row) => row.key)).toContain("created_at");
  });

  it("keeps data across restarts", () => {
    const databasePath = path.join(temp.dir, "app.db");

    const first = openDatabase(databasePath, migrationsDir);
    const before = first.db.select().from(appMeta).all();
    first.close();

    const second = openDatabase(databasePath, migrationsDir);
    const after = second.db.select().from(appMeta).all();
    second.close();

    expect(after).toEqual(before);
  });
});
