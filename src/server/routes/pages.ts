import { and, asc, count, eq, inArray, max } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { imageSize } from "image-size";
import { ulid } from "ulid";
import type { ApiErrorBody, ApiIssue } from "../../shared/api-error";
import {
  createPageInputSchema,
  MOCKUP_MIME_TYPES,
  type Mockup,
  mockupOrderInputSchema,
  type Page,
  type PageSummary,
  pageFieldsSchema,
  pageOrderInputSchema,
  updateMockupInputSchema,
  updatePageInputSchema,
} from "../../shared/pages";
import { slugify, uniqueSlug } from "../../shared/slug";
import type { Db } from "../db/client";
import { findProject, touchProject } from "../db/projects";
import {
  endpoints,
  type PageMockupRow,
  type PageRow,
  pageEndpoints,
  pageMockups,
  pages,
} from "../db/schema";
import type { UploadStorage } from "../storage/uploads";
import { jsonBody, toApiIssues, validationFailed } from "../validation";

const MAX_FILES_PER_UPLOAD = 20;

function formatBytes(bytes: number) {
  return bytes < 1024 * 1024
    ? `${Math.round(bytes / 1024)} KB`
    : `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function notFound(c: Context, what: string) {
  return c.json<ApiErrorBody>({ error: `${what} not found` }, 404);
}

/** Checks that `ids` lists each of `expected` exactly once. */
function isPermutation(ids: string[], expected: string[]) {
  return (
    ids.length === expected.length &&
    new Set(ids).size === ids.length &&
    expected.every((id) => ids.includes(id))
  );
}

function mockupFromRow(
  storage: UploadStorage,
  row: PageMockupRow,
  projectId: string,
): Mockup {
  return {
    id: row.id,
    pageId: row.pageId,
    url: storage.url(projectId, row.fileName),
    originalName: row.originalName,
    mimeType: row.mimeType,
    width: row.width,
    height: row.height,
    caption: row.caption,
    createdAt: row.createdAt.toISOString(),
  };
}

function mockupRowsOfPage(db: Db, pageId: string) {
  return db
    .select()
    .from(pageMockups)
    .where(eq(pageMockups.pageId, pageId))
    .orderBy(asc(pageMockups.sortOrder))
    .all();
}

/** A page as the API returns it, with its endpoint links and mockups. */
export function pageFromRow(
  db: Db,
  storage: UploadStorage,
  row: PageRow,
): Page {
  const links = db
    .select()
    .from(pageEndpoints)
    .where(eq(pageEndpoints.pageId, row.id))
    .orderBy(asc(pageEndpoints.sortOrder))
    .all();
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
    description: row.description,
    acceptanceCriteria: row.acceptanceCriteria,
    endpoints: links.map((link) => ({
      id: link.id,
      endpointId: link.endpointId,
      trigger: link.trigger,
      note: link.note,
    })),
    mockups: mockupRowsOfPage(db, row.id).map((mockup) =>
      mockupFromRow(storage, mockup, row.projectId),
    ),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function pageRoutes(
  db: Db,
  storage: UploadStorage,
  maxUploadBytes: number,
) {
  const toPage = (row: PageRow) => pageFromRow(db, storage, row);
  const mockupRowsOf = (pageId: string) => mockupRowsOfPage(db, pageId);
  const toMockup = (row: PageMockupRow, projectId: string) =>
    mockupFromRow(storage, row, projectId);

  function findPage(projectId: string, pageId: string) {
    return db
      .select()
      .from(pages)
      .where(and(eq(pages.id, pageId), eq(pages.projectId, projectId)))
      .get();
  }

  function isSlugTaken(projectId: string, slug: string, exceptPageId?: string) {
    const row = db
      .select({ id: pages.id })
      .from(pages)
      .where(and(eq(pages.projectId, projectId), eq(pages.slug, slug)))
      .get();
    return row !== undefined && row.id !== exceptPageId;
  }

  function slugTaken(c: Context) {
    return c.json<ApiErrorBody>(
      {
        error: "Slug is already used by another page",
        issues: [{ path: "slug", message: "Already used by another page" }],
      },
      409,
    );
  }

  function touch(page: PageRow, now = new Date()) {
    db.update(pages).set({ updatedAt: now }).where(eq(pages.id, page.id)).run();
    touchProject(db, page.projectId, now);
  }

  return (
    new Hono()
      // --- Pages --------------------------------------------------------------
      .get("/:projectId/pages", (c) => {
        const project = findProject(db, c.req.param("projectId"));
        if (!project) {
          return notFound(c, "Project");
        }
        const rows = db
          .select()
          .from(pages)
          .where(eq(pages.projectId, project.id))
          .orderBy(asc(pages.sortOrder))
          .all();
        const pageIds = rows.map((page) => page.id);
        const countBy = (table: typeof pageEndpoints | typeof pageMockups) =>
          new Map(
            db
              .select({ pageId: table.pageId, count: count() })
              .from(table)
              .where(inArray(table.pageId, pageIds))
              .groupBy(table.pageId)
              .all()
              .map((row) => [row.pageId, row.count]),
          );
        const endpointCounts = countBy(pageEndpoints);
        const mockupCounts = countBy(pageMockups);
        return c.json(
          rows.map(
            (page): PageSummary => ({
              id: page.id,
              projectId: page.projectId,
              name: page.name,
              slug: page.slug,
              endpointCount: endpointCounts.get(page.id) ?? 0,
              mockupCount: mockupCounts.get(page.id) ?? 0,
              createdAt: page.createdAt.toISOString(),
              updatedAt: page.updatedAt.toISOString(),
            }),
          ),
        );
      })
      .post("/:projectId/pages", jsonBody(createPageInputSchema), (c) => {
        const project = findProject(db, c.req.param("projectId"));
        if (!project) {
          return notFound(c, "Project");
        }
        const input = c.req.valid("json");
        if (input.slug && isSlugTaken(project.id, input.slug)) {
          return slugTaken(c);
        }
        const slug =
          input.slug ??
          uniqueSlug(slugify(input.name) || "page", (candidate) =>
            isSlugTaken(project.id, candidate),
          );
        const last = db
          .select({ value: max(pages.sortOrder) })
          .from(pages)
          .where(eq(pages.projectId, project.id))
          .get();

        const now = new Date();
        const row = db
          .insert(pages)
          .values({
            id: ulid(),
            projectId: project.id,
            name: input.name,
            slug,
            description: "",
            acceptanceCriteria: "",
            sortOrder: (last?.value ?? -1) + 1,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
        touchProject(db, project.id, now);

        return c.json(toPage(row), 201);
      })
      .put("/:projectId/pages/order", jsonBody(pageOrderInputSchema), (c) => {
        const project = findProject(db, c.req.param("projectId"));
        if (!project) {
          return notFound(c, "Project");
        }
        const { pageIds } = c.req.valid("json");
        const existing = db
          .select({ id: pages.id })
          .from(pages)
          .where(eq(pages.projectId, project.id))
          .all()
          .map((row) => row.id);
        if (!isPermutation(pageIds, existing)) {
          return validationFailed(c, [
            { path: "pageIds", message: "List every page of the project once" },
          ]);
        }
        db.transaction((tx) => {
          pageIds.forEach((id, index) => {
            tx.update(pages)
              .set({ sortOrder: index })
              .where(eq(pages.id, id))
              .run();
          });
        });
        touchProject(db, project.id);
        return c.json({ pageIds });
      })
      .get("/:projectId/pages/:pageId", (c) => {
        const row = findPage(c.req.param("projectId"), c.req.param("pageId"));
        return row ? c.json(toPage(row)) : notFound(c, "Page");
      })
      .patch(
        "/:projectId/pages/:pageId",
        jsonBody(updatePageInputSchema),
        (c) => {
          const existing = findPage(
            c.req.param("projectId"),
            c.req.param("pageId"),
          );
          if (!existing) {
            return notFound(c, "Page");
          }
          const current = toPage(existing);
          const result = pageFieldsSchema.safeParse({
            name: current.name,
            slug: current.slug,
            description: current.description,
            acceptanceCriteria: current.acceptanceCriteria,
            endpoints: current.endpoints,
            ...c.req.valid("json"),
          });
          if (!result.success) {
            return validationFailed(c, toApiIssues(result.error));
          }
          const fields = result.data;

          const projectEndpointIds = new Set(
            db
              .select({ id: endpoints.id })
              .from(endpoints)
              .where(eq(endpoints.projectId, existing.projectId))
              .all()
              .map((row) => row.id),
          );
          const linkIssues = fields.endpoints.flatMap(
            (link, index): ApiIssue[] =>
              projectEndpointIds.has(link.endpointId)
                ? []
                : [
                    {
                      path: `endpoints.${index}.endpointId`,
                      message: "Pick an endpoint of this project",
                    },
                  ],
          );
          if (linkIssues.length > 0) {
            return validationFailed(c, linkIssues);
          }
          if (
            fields.slug !== existing.slug &&
            isSlugTaken(existing.projectId, fields.slug, existing.id)
          ) {
            return slugTaken(c);
          }

          const now = new Date();
          db.transaction((tx) => {
            tx.update(pages)
              .set({
                name: fields.name,
                slug: fields.slug,
                description: fields.description,
                acceptanceCriteria: fields.acceptanceCriteria,
                updatedAt: now,
              })
              .where(eq(pages.id, existing.id))
              .run();
            tx.delete(pageEndpoints)
              .where(eq(pageEndpoints.pageId, existing.id))
              .run();
            if (fields.endpoints.length > 0) {
              tx.insert(pageEndpoints)
                .values(
                  fields.endpoints.map((link, index) => ({
                    ...link,
                    pageId: existing.id,
                    sortOrder: index,
                  })),
                )
                .run();
            }
          });
          touchProject(db, existing.projectId, now);

          const updated = findPage(existing.projectId, existing.id);
          return c.json(toPage(updated ?? existing));
        },
      )
      .delete("/:projectId/pages/:pageId", (c) => {
        const page = findPage(c.req.param("projectId"), c.req.param("pageId"));
        if (!page) {
          return notFound(c, "Page");
        }
        const files = mockupRowsOf(page.id).map((mockup) => mockup.fileName);
        db.delete(pages).where(eq(pages.id, page.id)).run();
        for (const fileName of files) {
          storage.remove(page.projectId, fileName);
        }
        touchProject(db, page.projectId);
        return c.body(null, 204);
      })
      // --- Mockups ------------------------------------------------------------
      .post(
        "/:projectId/pages/:pageId/mockups",
        bodyLimit({
          // Per-file sizes are checked below; this only stops runaway requests.
          maxSize: maxUploadBytes * MAX_FILES_PER_UPLOAD + 1024 * 1024,
          onError: (c) =>
            c.json<ApiErrorBody>({ error: "The upload is too large" }, 413),
        }),
        async (c) => {
          const page = findPage(
            c.req.param("projectId"),
            c.req.param("pageId"),
          );
          if (!page) {
            return notFound(c, "Page");
          }
          const body = await c.req.parseBody({ all: true });
          const files = [body.files ?? []]
            .flat()
            .filter((file): file is File => file instanceof File);
          if (files.length === 0) {
            return validationFailed(c, [
              { path: "files", message: "Choose at least one image" },
            ]);
          }
          if (files.length > MAX_FILES_PER_UPLOAD) {
            return validationFailed(c, [
              {
                path: "files",
                message: `Upload at most ${MAX_FILES_PER_UPLOAD} images at a time`,
              },
            ]);
          }

          // Check every file before saving any, so an upload is all or nothing.
          const issues: ApiIssue[] = [];
          const accepted: {
            file: File;
            data: Uint8Array;
            type: keyof typeof MOCKUP_MIME_TYPES;
            width: number;
            height: number;
          }[] = [];
          for (const [index, file] of files.entries()) {
            const path = `files.${index}`;
            if (file.size > maxUploadBytes) {
              issues.push({
                path,
                message: `${file.name} is larger than ${formatBytes(maxUploadBytes)}`,
              });
              continue;
            }
            const data = new Uint8Array(await file.arrayBuffer());
            let size: ReturnType<typeof imageSize> | undefined;
            try {
              size = imageSize(data);
            } catch {
              size = undefined;
            }
            if (!size?.type || !(size.type in MOCKUP_MIME_TYPES)) {
              issues.push({
                path,
                message: `${file.name} isn't a PNG, JPEG, GIF, or WebP image`,
              });
              continue;
            }
            accepted.push({
              file,
              data,
              type: size.type as keyof typeof MOCKUP_MIME_TYPES,
              width: size.width,
              height: size.height,
            });
          }
          if (issues.length > 0) {
            return validationFailed(c, issues);
          }

          const last = db
            .select({ value: max(pageMockups.sortOrder) })
            .from(pageMockups)
            .where(eq(pageMockups.pageId, page.id))
            .get();
          const now = new Date();
          const rows = accepted.map((upload, index) => {
            const id = ulid();
            return {
              id,
              pageId: page.id,
              fileName: `${id}.${upload.type}`,
              originalName: upload.file.name.slice(0, 255),
              mimeType: MOCKUP_MIME_TYPES[upload.type],
              width: upload.width,
              height: upload.height,
              caption: "",
              sortOrder: (last?.value ?? -1) + 1 + index,
              createdAt: now,
            };
          });
          rows.forEach((row, index) => {
            storage.write(
              page.projectId,
              row.fileName,
              accepted[index]?.data ?? new Uint8Array(),
            );
          });
          try {
            db.insert(pageMockups).values(rows).run();
          } catch (error) {
            for (const row of rows) {
              storage.remove(page.projectId, row.fileName);
            }
            throw error;
          }
          touch(page, now);

          return c.json(
            rows.map((row) => toMockup(row, page.projectId)),
            201,
          );
        },
      )
      .patch(
        "/:projectId/pages/:pageId/mockups/:mockupId",
        jsonBody(updateMockupInputSchema),
        (c) => {
          const page = findPage(
            c.req.param("projectId"),
            c.req.param("pageId"),
          );
          const mockup =
            page &&
            db
              .update(pageMockups)
              .set({ caption: c.req.valid("json").caption })
              .where(
                and(
                  eq(pageMockups.id, c.req.param("mockupId")),
                  eq(pageMockups.pageId, page.id),
                ),
              )
              .returning()
              .get();
          if (!page || !mockup) {
            return notFound(c, "Mockup");
          }
          touch(page);
          return c.json(toMockup(mockup, page.projectId));
        },
      )
      .put(
        "/:projectId/pages/:pageId/mockups/order",
        jsonBody(mockupOrderInputSchema),
        (c) => {
          const page = findPage(
            c.req.param("projectId"),
            c.req.param("pageId"),
          );
          if (!page) {
            return notFound(c, "Page");
          }
          const { mockupIds } = c.req.valid("json");
          const existing = mockupRowsOf(page.id).map((mockup) => mockup.id);
          if (!isPermutation(mockupIds, existing)) {
            return validationFailed(c, [
              {
                path: "mockupIds",
                message: "List every mockup of the page once",
              },
            ]);
          }
          db.transaction((tx) => {
            mockupIds.forEach((id, index) => {
              tx.update(pageMockups)
                .set({ sortOrder: index })
                .where(eq(pageMockups.id, id))
                .run();
            });
          });
          touch(page);
          return c.json({ mockupIds });
        },
      )
      .delete("/:projectId/pages/:pageId/mockups/:mockupId", (c) => {
        const page = findPage(c.req.param("projectId"), c.req.param("pageId"));
        const mockup =
          page &&
          db
            .delete(pageMockups)
            .where(
              and(
                eq(pageMockups.id, c.req.param("mockupId")),
                eq(pageMockups.pageId, page.id),
              ),
            )
            .returning()
            .get();
        if (!page || !mockup) {
          return notFound(c, "Mockup");
        }
        storage.remove(page.projectId, mockup.fileName);
        touch(page);
        return c.body(null, 204);
      })
  );
}
