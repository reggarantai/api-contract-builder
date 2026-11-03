import path from "node:path";
import { strToU8, zipSync } from "fflate";
import { type Context, Hono } from "hono";
import { stringify } from "yaml";
import { z } from "zod";
import type { ApiErrorBody } from "../../shared/api-error";
import {
  EXPORT_FORMATS,
  type ExportFormat,
  type ExportReport,
} from "../../shared/export";
import { MAX_NESTING, nestsDeeperThan } from "../../shared/json-schema";
import type { Db } from "../db/client";
import { loadExportInput } from "../export/load";
import { MarkdownTooLargeError } from "../export/markdown";
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

/**
 * What exports answer for a schema or an example nested deeper than they can
 * follow: validating and writing them recurse, and give out a few hundred
 * levels down. The API saves no more than MAX_NESTING levels, but data saved
 * before can be deeper.
 */
const TOO_DEEP = `A schema or example nests deeper than the exports can follow. Keep them within ${MAX_NESTING} levels, moving inner parts of schemas into models of their own.`;

/**
 * How deep an OpenAPI document of data saved within MAX_NESTING can go: its
 * schemas and examples sit at most ten levels in (a response's example), and
 * a few more allow for change. Only data saved before the limit goes deeper.
 */
const SAVED_DOCUMENT_DEPTH = MAX_NESTING + 16;

function isTooDeep(error: unknown) {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

function openApiYaml(doc: unknown) {
  // No anchors/aliases: many OpenAPI tools don't handle them.
  return stringify(doc, { lineWidth: 0, aliasDuplicateObjects: false });
}

/** The OpenAPI document as a download holds it. */
function openApiText(doc: unknown, format: ExportFormat) {
  return format === "yaml"
    ? openApiYaml(doc)
    : `${JSON.stringify(doc, null, 2)}\n`;
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
      let doc: ReturnType<typeof buildOpenApi>;
      let errors: string[];
      let body: string;
      try {
        doc = buildOpenApi(input, { pageId });
        errors = await validateContract(input, doc, { pageId });
        body = errors.length > 0 ? "" : openApiText(doc, format.data);
      } catch (error) {
        if (isTooDeep(error)) {
          return c.json<ApiErrorBody>({ error: TOO_DEEP }, 422);
        }
        throw error;
      }
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
      try {
        return await markdownBundle(c, scope);
      } catch (error) {
        if (isTooDeep(error)) {
          return c.json<ApiErrorBody>({ error: TOO_DEEP }, 422);
        }
        if (error instanceof MarkdownTooLargeError) {
          return c.json<ApiErrorBody>({ error: error.message }, 422);
        }
        throw error;
      }
    })
    .get("/:projectId/export/report", async (c) => {
      const scope = scopeOf(c);
      if ("response" in scope) {
        return scope.response;
      }
      const { input, pageId } = scope;
      try {
        const doc = buildOpenApi(input, { pageId });
        const errors = await validateContract(input, doc, { pageId });
        if (errors.length === 0 && nestsDeeperThan(doc, SAVED_DOCUMENT_DEPTH)) {
          // Writing recurses too, and can give out where checking didn't:
          // the report says valid only for what the downloads can write.
          // Saved data can't go that deep, so its reports skip the cost.
          for (const format of EXPORT_FORMATS) {
            openApiText(doc, format);
          }
        }
        return c.json<ExportReport>({
          valid: errors.length === 0,
          errors,
          warnings: lintContract(input, { pageId }),
        });
      } catch (error) {
        if (isTooDeep(error)) {
          return c.json<ExportReport>({
            valid: false,
            errors: [TOO_DEEP],
            warnings: [],
          });
        }
        throw error;
      }
    });

  /**
   * The OpenAPI file for the Markdown bundle, or null while the contract has
   * errors, a schema too deep to check among them (the report lists it).
   */
  async function validOpenApiFile(
    input: ExportInput,
    pageId: string | undefined,
    slugs: (string | undefined)[],
  ) {
    try {
      const doc = buildOpenApi(input, { pageId });
      if ((await validateContract(input, doc, { pageId })).length > 0) {
        return null;
      }
      return {
        fileName: [...slugs, "openapi", "yaml"].filter(Boolean).join("."),
        content: openApiYaml(doc),
      };
    } catch (error) {
      if (isTooDeep(error)) {
        return null;
      }
      throw error;
    }
  }

  /** The Markdown bundle as a zip download. */
  async function markdownBundle(
    c: Context,
    {
      input,
      pageId,
      pageSlug,
    }: { input: ExportInput; pageId?: string; pageSlug?: string },
  ) {
    const projectSlug = input.project.slug;
    const openApi = await validOpenApiFile(input, pageId, [
      projectSlug,
      pageSlug,
    ]);
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
  }
}
