import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDir, migrationsDir } from "../test-utils";
import { openDatabase } from "./client";
import { appMeta, endpoints, projects } from "./schema";

/** A copy of the migrations folder that stops after `lastTag`. */
function migrationsUpTo(dir: string, lastTag: string) {
  const journalPath = path.join(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const last = journal.entries.findIndex((entry) => entry.tag === lastTag);
  const entries = journal.entries.slice(0, last + 1);
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries }),
  );
  for (const entry of entries) {
    fs.copyFileSync(
      path.join(migrationsDir, `${entry.tag}.sql`),
      path.join(dir, `${entry.tag}.sql`),
    );
  }
  return dir;
}

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

  it("gives responses saved before response headers existed no headers", () => {
    const databasePath = path.join(temp.dir, "app.db");
    const before = openDatabase(
      databasePath,
      migrationsUpTo(path.join(temp.dir, "old-migrations"), "0004_pages"),
    );
    const now = new Date();
    before.db
      .insert(projects)
      .values({
        id: "p1",
        name: "Shop",
        slug: "shop",
        description: "",
        apiVersion: "1.0.0",
        servers: [],
        securitySchemes: [],
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const oldResponses = [
      { id: "r1", status: "200", description: "OK", body: null },
      { id: "r2", status: "404", description: "Not Found", body: null },
    ];
    before.db
      .insert(endpoints)
      .values({
        id: "e1",
        projectId: "p1",
        method: "GET",
        path: "/stocks",
        pathKey: "/stocks",
        operationId: "",
        summary: "",
        description: "",
        status: "draft",
        deprecated: false,
        security: { type: "default" },
        parameters: {
          path: { type: "object", properties: {} },
          query: { type: "object", properties: {} },
          header: { type: "object", properties: {} },
        },
        responses: oldResponses as never,
        notesFe: "",
        notesBe: "",
        createdAt: now,
        updatedAt: now,
      })
      .run();
    before.close();

    const after = openDatabase(databasePath, migrationsDir);
    const [row] = after.db.select().from(endpoints).all();
    after.close();

    const noHeaders = { type: "object", properties: {} };
    expect(row?.responses).toEqual([
      { ...oldResponses[0], headers: noHeaders },
      { ...oldResponses[1], headers: noHeaders },
    ]);
  });
});
