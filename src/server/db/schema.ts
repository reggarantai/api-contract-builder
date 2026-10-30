import {
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type {
  EndpointFields,
  EndpointResponse,
  EndpointSecurity,
  EndpointStatus,
  HttpMethod,
} from "../../shared/endpoints";
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

export const endpoints = sqliteTable(
  "endpoints",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    method: text("method").$type<HttpMethod>().notNull(),
    path: text("path").notNull(),
    /** The path with parameter names removed; see `pathMatchKey`. */
    pathKey: text("path_key").notNull(),
    operationId: text("operation_id").notNull(),
    summary: text("summary").notNull(),
    description: text("description").notNull(),
    status: text("status").$type<EndpointStatus>().notNull(),
    deprecated: integer("deprecated", { mode: "boolean" }).notNull(),
    security: text("security", { mode: "json" })
      .$type<EndpointSecurity>()
      .notNull(),
    parameters: text("parameters", { mode: "json" })
      .$type<EndpointFields["parameters"]>()
      .notNull(),
    requestBody: text("request_body", { mode: "json" }).$type<
      EndpointFields["requestBody"]
    >(),
    responses: text("responses", { mode: "json" })
      .$type<EndpointResponse[]>()
      .notNull(),
    notesFe: text("notes_fe").notNull(),
    notesBe: text("notes_be").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    uniqueIndex("endpoints_project_id_method_path_key_unique").on(
      table.projectId,
      table.method,
      table.pathKey,
    ),
  ],
);

export type EndpointRow = typeof endpoints.$inferSelect;
