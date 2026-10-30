import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

function createDb(sqlite: Database.Database) {
  return drizzle({ client: sqlite, schema });
}

export type OpenedDatabase = {
  db: Db;
  close: () => void;
};

/**
 * Opens (or creates) the SQLite database, applies pending migrations and
 * records instance metadata on first start.
 */
export function openDatabase(
  databasePath: string,
  migrationsDir: string,
): OpenedDatabase {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });

  const sqlite = new Database(databasePath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");

  const db = createDb(sqlite);
  migrate(db, { migrationsFolder: migrationsDir });

  db.insert(schema.appMeta)
    .values({ key: "created_at", value: new Date().toISOString() })
    .onConflictDoNothing()
    .run();

  return { db, close: () => sqlite.close() };
}
