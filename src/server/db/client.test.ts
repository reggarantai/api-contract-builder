import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTempDir, migrationsDir } from "../test-utils";
import { openDatabase } from "./client";
import {
  appMeta,
  endpoints,
  errorTypes,
  models,
  pageEndpoints,
  pages,
  projects,
} from "./schema";

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

/**
 * Inserts a row by column name with raw SQL: rows of an older database must
 * not depend on today's schema, whose tables have columns it lacks.
 */
function insertRow(
  database: ReturnType<typeof openDatabase>,
  table: string,
  row: Record<string, unknown>,
) {
  const columns = Object.keys(row);
  database.db.$client
    .prepare(
      `insert into ${table} (${columns.join(", ")}) values (${columns.map(() => "?").join(", ")})`,
    )
    .run(
      ...columns.map((column) => {
        const value = row[column];
        if (value instanceof Date) {
          return value.getTime();
        }
        if (typeof value === "boolean") {
          return Number(value);
        }
        return typeof value === "object" && value !== null
          ? JSON.stringify(value)
          : value;
      }),
    );
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
    insertRow(before, "projects", {
      id: "p1",
      name: "Shop",
      slug: "shop",
      description: "",
      api_version: "1.0.0",
      servers: [],
      security_schemes: [],
      created_at: now,
      updated_at: now,
    });
    const oldResponses = [
      { id: "r1", status: "200", description: "OK", body: null },
      { id: "r2", status: "404", description: "Not Found", body: null },
    ];
    insertRow(before, "endpoints", {
      id: "e1",
      project_id: "p1",
      method: "GET",
      path: "/stocks",
      path_key: "/stocks",
      operation_id: "",
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
      responses: oldResponses,
      notes_fe: "",
      notes_be: "",
      created_at: now,
      updated_at: now,
    });
    before.close();

    const after = openDatabase(databasePath, migrationsDir);
    const [row] = after.db.select().from(endpoints).all();
    after.close();

    const noHeaders = { type: "object", properties: {} };
    expect(row?.responses).toEqual([
      { ...oldResponses[0], headers: noHeaders, errors: [] },
      { ...oldResponses[1], headers: noHeaders, errors: [] },
    ]);
  });

  it("gives responses saved before the error catalog no catalog errors", () => {
    const databasePath = path.join(temp.dir, "app.db");
    const before = openDatabase(
      databasePath,
      migrationsUpTo(
        path.join(temp.dir, "old-migrations"),
        "0005_response_headers",
      ),
    );
    const now = new Date();
    insertRow(before, "projects", {
      id: "p1",
      name: "Shop",
      slug: "shop",
      description: "",
      api_version: "1.0.0",
      servers: [],
      security_schemes: [],
      created_at: now,
      updated_at: now,
    });
    const noHeaders = { type: "object", properties: {} };
    const oldResponses = [
      {
        id: "r1",
        status: "200",
        description: "OK",
        headers: noHeaders,
        body: null,
      },
      {
        id: "r2",
        status: "404",
        description: "Not Found",
        headers: noHeaders,
        body: { contentType: "application/json", schema: {}, examples: [] },
      },
    ];
    insertRow(before, "endpoints", {
      id: "e1",
      project_id: "p1",
      method: "GET",
      path: "/stocks",
      path_key: "/stocks",
      operation_id: "",
      summary: "",
      description: "",
      status: "draft",
      deprecated: false,
      security: { type: "default" },
      parameters: {
        path: noHeaders,
        query: noHeaders,
        header: noHeaders,
      },
      responses: oldResponses,
      notes_fe: "",
      notes_be: "",
      created_at: now,
      updated_at: now,
    });
    before.close();

    const after = openDatabase(databasePath, migrationsDir);
    const [row] = after.db.select().from(endpoints).all();
    after.close();

    expect(row?.responses).toEqual([
      { ...oldResponses[0], errors: [] },
      { ...oldResponses[1], errors: [] },
    ]);
  });

  it("gives pages saved before page states no states, and keeps the rest", () => {
    const databasePath = path.join(temp.dir, "app.db");
    const before = openDatabase(
      databasePath,
      migrationsUpTo(path.join(temp.dir, "old-migrations"), "0006_error_types"),
    );
    const now = new Date();
    const noFields = { type: "object", properties: {} };
    insertRow(before, "projects", {
      id: "p1",
      name: "Shop",
      slug: "shop",
      description: "",
      api_version: "1.0.0",
      servers: [],
      security_schemes: [],
      created_at: now,
      updated_at: now,
    });
    insertRow(before, "endpoints", {
      id: "e1",
      project_id: "p1",
      method: "GET",
      path: "/stocks",
      path_key: "/stocks",
      operation_id: "",
      summary: "",
      description: "",
      status: "draft",
      deprecated: false,
      security: { type: "default" },
      parameters: { path: noFields, query: noFields, header: noFields },
      responses: [],
      notes_fe: "",
      notes_be: "",
      created_at: now,
      updated_at: now,
    });
    const oldPage = {
      id: "pg1",
      projectId: "p1",
      name: "Stock list",
      slug: "stock-list",
      description: "All items",
      acceptanceCriteria: "- [ ] Paged",
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
    };
    before.db.$client
      .prepare(
        "insert into pages (id, project_id, name, slug, description, acceptance_criteria, sort_order, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        oldPage.id,
        oldPage.projectId,
        oldPage.name,
        oldPage.slug,
        oldPage.description,
        oldPage.acceptanceCriteria,
        oldPage.sortOrder,
        now.getTime(),
        now.getTime(),
      );
    insertRow(before, "page_endpoints", {
      id: "l1",
      page_id: "pg1",
      endpoint_id: "e1",
      trigger: "on_load",
      note: "",
      sort_order: 0,
    });
    before.close();

    const after = openDatabase(databasePath, migrationsDir);
    const [page] = after.db.select().from(pages).all();
    const links = after.db.select().from(pageEndpoints).all();
    after.close();

    expect(page).toEqual({ ...oldPage, states: [], revision: 0 });
    expect(links).toHaveLength(1);
  });

  it("gives what was saved before revisions revision 0", () => {
    const databasePath = path.join(temp.dir, "app.db");
    const before = openDatabase(
      databasePath,
      migrationsUpTo(path.join(temp.dir, "old-migrations"), "0007_page_states"),
    );
    const now = Date.now();
    const insert = (sql: string, ...values: unknown[]) =>
      before.db.$client.prepare(sql).run(...values);
    insert(
      "insert into projects (id, name, slug, description, api_version, servers, security_schemes, created_at, updated_at) values ('p1', 'Shop', 'shop', '', '1.0.0', '[]', '[]', ?, ?)",
      now,
      now,
    );
    insert(
      "insert into models (id, project_id, name, description, schema, created_at, updated_at) values ('m1', 'p1', 'Item', '', '{\"type\":\"object\"}', ?, ?)",
      now,
      now,
    );
    insert(
      "insert into error_types (id, project_id, name, status, title, description, headers, body, created_at, updated_at) values ('t1', 'p1', 'not-found', '404', 'Not found', '', '{\"type\":\"object\",\"properties\":{}}', '{\"contentType\":\"application/json\",\"schema\":{},\"example\":{}}', ?, ?)",
      now,
      now,
    );
    insert(
      "insert into endpoints (id, project_id, method, path, path_key, operation_id, summary, description, status, deprecated, security, parameters, responses, notes_fe, notes_be, created_at, updated_at) values ('e1', 'p1', 'GET', '/items', '/items', '', '', '', 'draft', 0, '{\"type\":\"default\"}', '{}', '[]', '', '', ?, ?)",
      now,
      now,
    );
    before.close();

    const after = openDatabase(databasePath, migrationsDir);
    const revisions = [
      after.db.select().from(projects).all()[0]?.revision,
      after.db.select().from(models).all()[0]?.revision,
      after.db.select().from(errorTypes).all()[0]?.revision,
      after.db.select().from(endpoints).all()[0]?.revision,
    ];
    after.close();

    expect(revisions).toEqual([0, 0, 0, 0]);
  });
});
