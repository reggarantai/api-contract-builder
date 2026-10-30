import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Instance-level key/value metadata, e.g. when the data directory was created. */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
