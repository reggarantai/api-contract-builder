import fs from "node:fs";
import path from "node:path";
import { type Context, Hono } from "hono";
import type { ApiErrorBody } from "../../shared/api-error";
import { formatSize } from "../../shared/format-size";
import type { Mockup } from "../../shared/pages";
import type { ProjectFileReport } from "../../shared/project-file";
import type { Db } from "../db/client";
import { loadExportInput } from "../export/load";
import { newId } from "../ids";
import {
  BUSY_MESSAGE,
  ImportLine,
  type ImportTurn,
  importOpenApi,
} from "../openapi-import/import";
import { OPENAPI_LIMITS } from "../openapi-import/read";
import {
  buildProjectFile,
  projectFileName,
  projectFileText,
} from "../project-file/build";
import {
  MAX_PROJECT_FILE_BYTES,
  projectFileReport,
  projectFileZip,
} from "../project-file/export";
import { importProjectFile } from "../project-file/import";
import { fileSource } from "../project-file/zip";
import type { UploadStorage } from "../storage/uploads";

/** Media types a zip comes as. */
const ZIP_TYPES = new Set(["application/zip", "application/x-zip-compressed"]);
/** An OpenAPI document as JSON: RFC 8259's type, and OpenAPI's own. */
const OPENAPI_JSON_TYPES = new Set([
  "application/json",
  "application/openapi+json",
  "application/vnd.oai.openapi+json",
]);
/** As YAML: RFC 9512's type and the aliases it lists, and OpenAPI's own. */
const OPENAPI_YAML_TYPES = new Set([
  "application/yaml",
  "application/openapi+yaml",
  "application/vnd.oai.openapi",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
]);
/**
 * Every type an import takes. None is one a browser sends from another site
 * without asking first (CORS-safelisted), and the server never answers that
 * request, so a page elsewhere can't import into the local app; HTML forms
 * can't send them at all.
 */
const ACCEPTED_TYPES = [
  ...ZIP_TYPES,
  "application/json",
  "application/yaml",
  "application/openapi+json",
  "application/openapi+yaml",
  "application/vnd.oai.openapi+json",
  "application/vnd.oai.openapi",
  "application/x-yaml",
  "text/yaml",
  "text/x-yaml",
].join(", ");
/** An upload being read, or an import's images waiting to be moved in. */
const TEMPORARY = /^import-[0-9A-HJKMNP-TV-Z]{26}(?:\.zip)?$/;

export type ProjectFileOptions = {
  version: string;
  maxImportBytes: number;
  maxUploadBytes: number;
  /** Where an import is kept while it's read; only its own files are touched. */
  tmpDir: string;
  /**
   * How long an OpenAPI document may take to arrive: it holds a turn to
   * import (one runs, one waits) while it does.
   */
  openApiBodyTimeoutMs?: number;
};

/**
 * Project files: a whole project, mockups included, to move it to another
 * machine or instance. Export streams the zip; import reads one into a new
 * project.
 */
export function projectFileRoutes(
  db: Db,
  storage: UploadStorage,
  {
    version,
    maxImportBytes,
    maxUploadBytes,
    tmpDir,
    openApiBodyTimeoutMs = 60_000,
  }: ProjectFileOptions,
) {
  const generator = `API Contract Builder ${version}`;
  /** This instance's OpenAPI imports, one at a time. */
  const importLine = new ImportLine();
  const limits = { maxImportBytes, maxUploadBytes };
  const fileOf = (mockup: Mockup) => path.posix.basename(mockup.url);

  // What imports cut short by a restart left behind; nothing else.
  fs.mkdirSync(tmpDir, { recursive: true });
  for (const name of fs.readdirSync(tmpDir)) {
    if (TEMPORARY.test(name)) {
      fs.rmSync(path.join(tmpDir, name), { recursive: true, force: true });
    }
  }

  function exportInputOf(c: Context) {
    return loadExportInput(db, storage, c.req.param("projectId") ?? "");
  }
  const notFound = (c: Context) =>
    c.json<ApiErrorBody>({ error: "Project not found" }, 404);
  const wholeProjectOnly = (c: Context) =>
    c.json<ApiErrorBody>(
      {
        error: "A project file always holds the whole project: leave out page",
      },
      400,
    );

  /**
   * An OpenAPI document, read into memory whole: at most 16 MB (as a project
   * file's project.json), or MAX_IMPORT_MB when that's lower.
   */
  async function importOpenApiDocument(c: Context, format: "json" | "yaml") {
    // A turn before the document comes in: one turned away holds nothing.
    const turn = importLine.take();
    if (!turn) {
      return c.json<ApiErrorBody>({ error: BUSY_MESSAGE }, 503, {
        "Retry-After": "1",
      });
    }
    try {
      return await receiveAndImport(c, format, turn);
    } finally {
      turn.release();
    }
  }

  async function receiveAndImport(
    c: Context,
    format: "json" | "yaml",
    turn: ImportTurn,
  ) {
    const limit = Math.min(OPENAPI_LIMITS.maxBytes, maxImportBytes);
    const tooLarge = () =>
      c.json<ApiErrorBody>(
        {
          error:
            limit < OPENAPI_LIMITS.maxBytes
              ? `The file is larger than ${formatSize(maxImportBytes)}, the most this instance imports. Start it with MAX_IMPORT_MB set higher to import it.`
              : `An OpenAPI document may be at most ${formatSize(OPENAPI_LIMITS.maxBytes)}, and this one is larger. Split it, or leave out parts like long examples.`,
        },
        413,
      );
    const length = Number(c.req.header("content-length"));
    if (Number.isFinite(length) && length > limit) {
      return tooLarge();
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    const reader = c.req.raw.body?.getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<"late">((resolve) => {
      timer = setTimeout(() => resolve("late"), openApiBodyTimeoutMs);
    });
    try {
      for (;;) {
        const chunk = reader
          ? await Promise.race([reader.read(), late])
          : ({ done: true } as const);
        if (chunk === "late") {
          void reader?.cancel().catch(() => undefined);
          return c.json<ApiErrorBody>(
            {
              error: `The document took longer than ${Math.round(openApiBodyTimeoutMs / 1000)} seconds to arrive, so the import was stopped. Send it again.`,
            },
            408,
          );
        }
        if (chunk.done) {
          break;
        }
        received += chunk.value.byteLength;
        if (received > limit) {
          await reader?.cancel();
          return tooLarge();
        }
        chunks.push(chunk.value);
      }
    } finally {
      clearTimeout(timer);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    // Copied: not kept twice while the import waits its turn.
    chunks.length = 0;
    const result = await importOpenApi(
      { db, storage, limits, appVersion: version, tmpDir },
      bytes,
      format,
      turn,
    );
    if ("busy" in result) {
      return c.json<ApiErrorBody>(
        { error: result.error, issues: result.issues },
        503,
        { "Retry-After": "1" },
      );
    }
    if ("error" in result) {
      return c.json<ApiErrorBody>(
        { error: result.error, issues: result.issues },
        400,
      );
    }
    return c.json(result, 201, {
      Location: `/api/projects/${result.project.id}`,
    });
  }

  return new Hono()
    .get("/:projectId/export/project", (c) => {
      if (c.req.query("page") !== undefined) {
        return wholeProjectOnly(c);
      }
      const input = exportInputOf(c);
      if (!input) {
        return notFound(c);
      }
      const projectId = input.project.id;
      const { document, files } = buildProjectFile(input, {
        generator,
        sizeOf: (mockup) => storage.size(projectId, fileOf(mockup)),
      });
      const json = projectFileText(document);
      const size = files.reduce(
        (total, file) => total + file.size,
        Buffer.byteLength(json),
      );
      if (size > MAX_PROJECT_FILE_BYTES) {
        return c.json<ApiErrorBody>(
          {
            error: `This project holds ${formatSize(size)}, more than a project file can (4 GB)`,
          },
          422,
        );
      }
      const zip = projectFileZip({
        folder: input.project.slug,
        json,
        files,
        readFile: (file) => storage.read(projectId, fileOf(file.mockup)),
        changed: new Date(input.project.updatedAt),
      });
      return c.body(zip, 200, {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${projectFileName(input.project.slug)}"`,
      });
    })
    .get("/:projectId/export/project/report", (c) => {
      const input = exportInputOf(c);
      if (!input) {
        return notFound(c);
      }
      const projectId = input.project.id;
      return c.json<ProjectFileReport>(
        projectFileReport(input, {
          generator,
          appVersion: version,
          sizeOf: (mockup) => storage.size(projectId, fileOf(mockup)),
          limits,
        }),
      );
    })
    .post("/import", async (c) => {
      const type = c.req
        .header("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (
        type &&
        (OPENAPI_JSON_TYPES.has(type) || OPENAPI_YAML_TYPES.has(type))
      ) {
        return importOpenApiDocument(
          c,
          OPENAPI_JSON_TYPES.has(type) ? "json" : "yaml",
        );
      }
      if (!type || !ZIP_TYPES.has(type)) {
        return c.json<ApiErrorBody>(
          {
            error:
              "Send a project file as application/zip, or an OpenAPI document as application/json or application/yaml, as the request body",
          },
          415,
          { Accept: ACCEPTED_TYPES },
        );
      }
      const tooLarge = (size?: number) =>
        c.json<ApiErrorBody>(
          {
            error:
              size === undefined
                ? `The file is larger than ${formatSize(maxImportBytes)}, the most this instance imports. Start it with MAX_IMPORT_MB set higher to import it.`
                : `The file is ${formatSize(size)}; this instance imports up to ${formatSize(maxImportBytes)}. Start it with MAX_IMPORT_MB set higher to import it.`,
          },
          413,
        );
      const length = Number(c.req.header("content-length"));
      if (Number.isFinite(length) && length > maxImportBytes) {
        return tooLarge(length);
      }

      // The upload goes to a file first: reading it from there, an entry at
      // a time, keeps a large project out of memory.
      fs.mkdirSync(tmpDir, { recursive: true });
      const file = path.join(tmpDir, `import-${newId()}.zip`);
      const fd = fs.openSync(file, "wx+", 0o600);
      try {
        let received = 0;
        const reader = c.req.raw.body?.getReader();
        for (;;) {
          const chunk = reader ? await reader.read() : { done: true as const };
          if (chunk.done) {
            break;
          }
          received += chunk.value.byteLength;
          if (received > maxImportBytes) {
            await reader?.cancel();
            return tooLarge();
          }
          let written = 0;
          while (written < chunk.value.byteLength) {
            written += fs.writeSync(fd, chunk.value, written);
          }
        }
        const result = importProjectFile(
          { db, storage, limits, appVersion: version, tmpDir },
          fileSource(fd),
        );
        if ("error" in result) {
          return c.json<ApiErrorBody>(
            { error: result.error, issues: result.issues },
            400,
          );
        }
        return c.json(result, 201, {
          Location: `/api/projects/${result.project.id}`,
        });
      } finally {
        fs.closeSync(fd);
        fs.rmSync(file, { force: true });
      }
    });
}
