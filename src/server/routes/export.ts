import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { type Context, Hono } from "hono";
import { stringify } from "yaml";
import { z } from "zod";
import type { ApiErrorBody } from "../../shared/api-error";
import { EXPORT_FORMATS, type ExportReport } from "../../shared/export";
import type { Db } from "../db/client";
import { loadExportInput } from "../export/load";
import { buildMarkdownFiles } from "../export/markdown-files";
import {
  buildOpenApi,
  type ExportInput,
  lintContract,
  validateContract,
} from "../export/openapi";
import type { UploadStorage } from "../storage/uploads";
import { toApiIssues, validationFailed } from "../validation";

const formatSchema = z.enum(EXPORT_FORMATS).default("yaml");

function openApiYaml(doc: unknown) {
  // No anchors/aliases: many OpenAPI tools don't handle them.
  return stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

export function exportRoutes(db: Db, storage: UploadStorage) {
  /** The project and the page to export, or the error response. */
  function scopeOf(
    c: Context,
  ):
    | { input: ExportInput; pageId?: string; pageSlug?: string }
    | { response: Response } {
    const input = loadExportInput(db, storage, c.req.param("projectId") ?? "");
    if (!input) {
      return {
        response: c.json<ApiErrorBody>({ error: "Project not found" }, 404),
      };
    }
    const pageId = c.req.query("page");
    if (pageId === undefined) {
      return { input };
    }
    const page = input.pages.find((item) => item.id === pageId);
    if (!page) {
      return {
        response: c.json<ApiErrorBody>({ error: "Page not found" }, 404),
      };
    }
    return { input, pageId, pageSlug: page.slug };
  }

  return new Hono()
    .get("/:projectId/export/openapi", async (c) => {
      const scope = scopeOf(c);
      if ("response" in scope) {
        return scope.response;
      }
      const format = formatSchema.safeParse(c.req.query("format"));
      if (!format.success) {
        return validationFailed(
          c,
          toApiIssues(format.error).map((issue) => ({
            ...issue,
            path: "format",
          })),
        );
      }

      const { input, pageId, pageSlug } = scope;
      const doc = buildOpenApi(input, { pageId });
      const errors = await validateContract(input, doc, { pageId });
      if (errors.length > 0) {
        return c.json<ApiErrorBody>(
          {
            error:
              "The contract isn't valid OpenAPI yet. Fix the problems in the export report.",
            issues: errors.map((message) => ({ path: "", message })),
          },
          422,
        );
      }

      const fileName = [input.project.slug, pageSlug, "openapi", format.data]
        .filter(Boolean)
        .join(".");
      const body =
        format.data === "yaml"
          ? openApiYaml(doc)
          : `${JSON.stringify(doc, null, 2)}\n`;
      return c.body(body, 200, {
        "Content-Type": `application/${format.data}; charset=utf-8`,
        "Content-Disposition": `attachment; filename="${fileName}"`,
      });
    })
    .get("/:projectId/export/markdown", async (c) => {
      const scope = scopeOf(c);
      if ("response" in scope) {
        return scope.response;
      }
      const { input, pageId, pageSlug } = scope;
      const projectSlug = input.project.slug;
      const doc = buildOpenApi(input, { pageId });
      const valid =
        (await validateContract(input, doc, { pageId })).length === 0;

      const openApi = valid
        ? {
            fileName: [projectSlug, pageSlug, "openapi", "yaml"]
              .filter(Boolean)
              .join("."),
            content: openApiYaml(doc),
          }
        : null;
      const files = buildMarkdownFiles(
        input,
        { pageId },
        {
          readImage: (mockup) =>
            storage.read(input.project.id, path.posix.basename(mockup.url)),
          openApi,
        },
      );
      if (openApi) {
        files[openApi.fileName] = openApi.content;
      }

      // Everything sits in one folder, so unzipping doesn't scatter files.
      const zip = zipSync(
        Object.fromEntries(
          Object.entries(files).map(([name, content]) => [
            `${projectSlug}/${name}`,
            typeof content === "string" ? strToU8(content) : content,
          ]),
        ),
      );
      const fileName = [projectSlug, pageSlug, "contract", "zip"]
        .filter(Boolean)
        .join(".");
      return c.body(zip, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      });
    })
    .get("/:projectId/export/report", async (c) => {
      const scope = scopeOf(c);
      if ("response" in scope) {
        return scope.response;
      }
      const { input, pageId } = scope;
      const errors = await validateContract(
        input,
        buildOpenApi(input, { pageId }),
        {
          pageId,
        },
      );
      return c.json<ExportReport>({
        valid: errors.length === 0,
        errors,
        warnings: lintContract(input, { pageId }),
      });
    });
}
