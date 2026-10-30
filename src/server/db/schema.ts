import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { JsonSchema } from "../../shared/json-schema";
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

export const models = sqliteTable(
  "models",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull(),
    /** JSON Schema; references to other models are stored as `model:<id>`. */
    schema: text("schema", { mode: "json" }).$type<JsonSchema>().notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("models_project_id_name_unique").on(
      table.projectId,
      table.name,
    ),
  ],
);

export type ModelRow = typeof models.$inferSelect;
