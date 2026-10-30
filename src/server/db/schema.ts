import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { SecurityScheme, Server } from "../../shared/projects";

/** Instance-level key/value metadata, e.g. when the data directory was created. */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description").notNull(),
  apiVersion: text("api_version").notNull(),
  servers: text("servers", { mode: "json" }).$type<Server[]>().notNull(),
  securitySchemes: text("security_schemes", { mode: "json" })
    .$type<SecurityScheme[]>()
    .notNull(),
  defaultSecuritySchemeId: text("default_security_scheme_id"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});

export type ProjectRow = typeof projects.$inferSelect;
