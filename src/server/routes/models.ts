import { and, eq, ne, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { ulid } from "ulid";
import type { ApiErrorBody, ApiIssue } from "../../shared/api-error";
import {
  COMPONENT_REF_PREFIX,
  collectRefs,
  type JsonSchema,
  modelIdOfRef,
  modelRef,
} from "../../shared/json-schema";
import {
  createModelInputSchema,
  DEFAULT_MODEL_SCHEMA,
  type Model,
  type ModelSummary,
  updateModelInputSchema,
} from "../../shared/models";
import type { Db } from "../db/client";
import { findProject, touchProject } from "../db/projects";
import { type ModelRow, models } from "../db/schema";
import { jsonBody, validationFailed } from "../validation";

function toSummary(row: ModelRow): ModelSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toModel(row: ModelRow): Model {
  return { ...toSummary(row), schema: row.schema };
}

function projectNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Project not found" }, 404);
}

function modelNotFound(c: Context) {
  return c.json<ApiErrorBody>({ error: "Model not found" }, 404);
}

function nameTaken(c: Context) {
  return c.json<ApiErrorBody>(
    {
      error: "A model with this name already exists",
      issues: [{ path: "name", message: "Already used by another model" }],
    },
    409,
  );
}

// Names are compared case-insensitively: "User" and "user" would collide in
// exported file names and anchors.
function isNameTaken(
  db: Db,
  projectId: string,
  name: string,
  exceptModelId?: string,
) {
  const row = db
    .select({ id: models.id })
    .from(models)
    .where(
      and(
        eq(models.projectId, projectId),
        sql`lower(${models.name}) = lower(${name})`,
      ),
    )
    .get();
  return row !== undefined && row.id !== exceptModelId;
}

/** Issues for `$ref`s that don't point at a model of this project. */
function checkRefs(
  db: Db,
  projectId: string,
  schema: JsonSchema,
  selfId?: string,
): ApiIssue[] {
  const modelIds = new Set(
    db
      .select({ id: models.id })
      .from(models)
      .where(eq(models.projectId, projectId))
      .all()
      .map((row) => row.id),
  );
  if (selfId) {
    modelIds.add(selfId);
  }

  const messages = new Set<string>();
  for (const ref of collectRefs(schema)) {
    const id = modelIdOfRef(ref);
    if (id !== null) {
      if (!modelIds.has(id)) {
        messages.add(`References a model that doesn't exist: ${ref}`);
      }
    } else if (!ref.startsWith("#") || ref.startsWith(COMPONENT_REF_PREFIX)) {
      messages.add(
        `Unsupported reference "${ref}"; reference a model of this project instead`,
      );
    }
  }
  return [...messages].map((message) => ({ path: "schema", message }));
}

function findModel(db: Db, projectId: string, modelId: string) {
  return db
    .select()
    .from(models)
    .where(and(eq(models.id, modelId), eq(models.projectId, projectId)))
    .get();
}

export function modelRoutes(db: Db) {
  return new Hono()
    .get("/:projectId/models", (c) => {
      const project = findProject(db, c.req.param("projectId"));
      if (!project) {
        return projectNotFound(c);
      }
      const rows = db
        .select()
        .from(models)
        .where(eq(models.projectId, project.id))
        .orderBy(sql`${models.name} collate nocase`)
        .all();
      return c.json(rows.map(toSummary));
    })
    .post("/:projectId/models", jsonBody(createModelInputSchema), (c) => {
      const project = findProject(db, c.req.param("projectId"));
      if (!project) {
        return projectNotFound(c);
      }
      const input = c.req.valid("json");
      if (isNameTaken(db, project.id, input.name)) {
        return nameTaken(c);
      }
      const schema = input.schema ?? DEFAULT_MODEL_SCHEMA;
      const issues = checkRefs(db, project.id, schema);
      if (issues.length > 0) {
        return validationFailed(c, issues);
      }

      const now = new Date();
      const row = db
        .insert(models)
        .values({
          id: ulid(),
          projectId: project.id,
          name: input.name,
          description: input.description,
          schema,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get();
      touchProject(db, project.id, now);

      return c.json(toModel(row), 201);
    })
    .get("/:projectId/models/:modelId", (c) => {
      const row = findModel(
        db,
        c.req.param("projectId"),
        c.req.param("modelId"),
      );
      return row ? c.json(toModel(row)) : modelNotFound(c);
    })
    .patch(
      "/:projectId/models/:modelId",
      jsonBody(updateModelInputSchema),
      (c) => {
        const existing = findModel(
          db,
          c.req.param("projectId"),
          c.req.param("modelId"),
        );
        if (!existing) {
          return modelNotFound(c);
        }
        const input = c.req.valid("json");
        if (
          input.name !== undefined &&
          isNameTaken(db, existing.projectId, input.name, existing.id)
        ) {
          return nameTaken(c);
        }
        if (input.schema !== undefined) {
          const issues = checkRefs(
            db,
            existing.projectId,
            input.schema,
            existing.id,
          );
          if (issues.length > 0) {
            return validationFailed(c, issues);
          }
        }

        const now = new Date();
        const row = db
          .update(models)
          .set({ ...input, updatedAt: now })
          .where(eq(models.id, existing.id))
          .returning()
          .get();
        touchProject(db, existing.projectId, now);

        return c.json(toModel(row ?? existing));
      },
    )
    .delete("/:projectId/models/:modelId", (c) => {
      const model = findModel(
        db,
        c.req.param("projectId"),
        c.req.param("modelId"),
      );
      if (!model) {
        return modelNotFound(c);
      }

      const ref = modelRef(model.id);
      const usedBy = db
        .select({ name: models.name, schema: models.schema })
        .from(models)
        .where(
          and(eq(models.projectId, model.projectId), ne(models.id, model.id)),
        )
        .orderBy(sql`${models.name} collate nocase`)
        .all()
        .filter((other) => collectRefs(other.schema).includes(ref));
      if (usedBy.length > 0) {
        return c.json<ApiErrorBody>(
          {
            error: `${model.name} is used by ${usedBy.map((other) => other.name).join(", ")}. Remove those references first.`,
          },
          409,
        );
      }

      db.delete(models).where(eq(models.id, model.id)).run();
      touchProject(db, model.projectId);
      return c.body(null, 204);
    });
}
