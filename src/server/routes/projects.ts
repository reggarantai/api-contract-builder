import { eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { ulid } from "ulid";
import type { ApiErrorBody } from "../../shared/api-error";
import {
  createProjectInputSchema,
  type Project,
  type ProjectSettings,
  type ProjectSummary,
  projectSettingsSchema,
  updateProjectInputSchema,
} from "../../shared/projects";
import { SLUG_MAX_LENGTH, slugify } from "../../shared/slug";
import type { Db } from "../db/client";
import { findProject } from "../db/projects";
import { endpointsUsingScheme } from "../db/references";
import { type ProjectRow, projects } from "../db/schema";
import { jsonBody, toApiIssues, validationFailed } from "../validation";

function toSummary(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    apiVersion: row.apiVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toProject(row: ProjectRow): Project {
  return {
    ...toSummary(row),
    servers: row.servers,
    securitySchemes: row.securitySchemes,
    defaultSecuritySchemeId: row.defaultSecuritySchemeId,
  };
}

function settingsOf(row: ProjectRow): ProjectSettings {
  return {
    name: row.name,
    slug: row.slug,
    description: row.description,
    apiVersion: row.apiVersion,
    servers: row.servers,
    securitySchemes: row.securitySchemes,
    defaultSecuritySchemeId: row.defaultSecuritySchemeId,
  };
}

function projectNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Project not found" }, 404);
}

function slugTaken(c: Context) {
  return c.json<ApiErrorBody>(
    {
      error: "Slug is already used by another project",
      issues: [{ path: "slug", message: "Already used by another project" }],
    },
    409,
  );
}

// better-sqlite3 is synchronous, so a slug check followed by a write in the
// same handler cannot interleave with another request.
function isSlugTaken(db: Db, slug: string, exceptProjectId?: string) {
  const row = db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.slug, slug))
    .get();
  return row !== undefined && row.id !== exceptProjectId;
}

/** Returns `base`, or the first free `base-2`, `base-3`, … */
function uniqueSlug(db: Db, base: string) {
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, "")}${suffix}`;
    if (!isSlugTaken(db, candidate)) {
      return candidate;
    }
  }
}

export function projectRoutes(db: Db) {
  return new Hono()
    .get("/", (c) => {
      const rows = db
        .select()
        .from(projects)
        .orderBy(sql`${projects.name} collate nocase`, projects.createdAt)
        .all();
      return c.json(rows.map(toSummary));
    })
    .post("/", jsonBody(createProjectInputSchema), (c) => {
      const input = c.req.valid("json");

      let slug: string;
      if (input.slug) {
        if (isSlugTaken(db, input.slug)) {
          return slugTaken(c);
        }
        slug = input.slug;
      } else {
        slug = uniqueSlug(db, slugify(input.name) || "project");
      }

      const now = new Date();
      const row = db
        .insert(projects)
        .values({
          id: ulid(),
          name: input.name,
          slug,
          description: input.description,
          apiVersion: input.apiVersion,
          servers: [],
          securitySchemes: [],
          defaultSecuritySchemeId: null,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();

      return c.json(toProject(row), 201);
    })
    .get("/:id", (c) => {
      const row = findProject(db, c.req.param("id"));
      return row ? c.json(toProject(row)) : projectNotFound(c);
    })
    .patch("/:id", jsonBody(updateProjectInputSchema), (c) => {
      const existing = findProject(db, c.req.param("id"));
      if (!existing) {
        return projectNotFound(c);
      }

      // Cross-field rules (unique keys, default scheme) need the full settings.
      const result = projectSettingsSchema.safeParse({
        ...settingsOf(existing),
        ...c.req.valid("json"),
      });
      if (!result.success) {
        return validationFailed(c, toApiIssues(result.error));
      }
      const settings = result.data;

      const schemeIssues = existing.securitySchemes
        .filter(
          (scheme) =>
            !settings.securitySchemes.some((kept) => kept.id === scheme.id),
        )
        .flatMap((scheme) => {
          const users = endpointsUsingScheme(db, existing.id, scheme.id);
          return users.length > 0
            ? [
                {
                  path: "securitySchemes",
                  message: `${scheme.key} is used by ${users.join(", ")}`,
                },
              ]
            : [];
        });
      if (schemeIssues.length > 0) {
        return c.json<ApiErrorBody>(
          {
            error: "Some authentication schemes are still used by endpoints",
            issues: schemeIssues,
          },
          409,
        );
      }

      if (
        settings.slug !== existing.slug &&
        isSlugTaken(db, settings.slug, existing.id)
      ) {
        return slugTaken(c);
      }

      const row = db
        .update(projects)
        .set({ ...settings, updatedAt: new Date() })
        .where(eq(projects.id, existing.id))
        .returning()
        .get();

      return c.json(toProject(row ?? existing));
    })
    .delete("/:id", (c) => {
      const deleted = db
        .delete(projects)
        .where(eq(projects.id, c.req.param("id")))
        .returning({ id: projects.id })
        .get();
      return deleted ? c.body(null, 204) : projectNotFound(c);
    });
}
