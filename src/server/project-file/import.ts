import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { eq, inArray } from "drizzle-orm";
import {
  getTableConfig,
  type SQLiteColumn,
  type SQLiteTable,
} from "drizzle-orm/sqlite-core";
import type { ApiIssue } from "../../shared/api-error";
import { pathMatchKey, schemasOfEndpoint } from "../../shared/endpoints";
import { schemasOfErrorType } from "../../shared/error-types";
import { formatSize } from "../../shared/format-size";
import {
  type JsonSchema,
  modelIdOfRef,
  modelRef,
  modelRefIssues,
  replaceRefsInPlace,
} from "../../shared/json-schema";
import { MOCKUP_MIME_TYPES } from "../../shared/pages";
import type { Project } from "../../shared/projects";
import { uniqueSlug } from "../../shared/slug";
import type { Db } from "../db/client";
import {
  endpoints,
  errorTypes,
  models,
  pageEndpoints,
  pageMockups,
  pages,
  projects,
} from "../db/schema";
import { newId as makeId } from "../ids";
import { toProject } from "../routes/projects";
import {
  checkMockupImage,
  type MockupImageType,
} from "../storage/mockup-image";
import type { UploadStorage } from "../storage/uploads";
import {
  MAX_PROJECT_JSON_BYTES,
  MAX_ZIP_ENTRIES,
  type ProjectFile,
} from "./format";
import { checkJsonText } from "./json-text";
import { describeProblems, IssueList, validateProjectFile } from "./validate";
import {
  NotAZipError,
  openZip,
  type ZipArchive,
  ZipError,
  type ZipSource,
} from "./zip";

// Importing a project file: read the zip, check project.json with the API's
// rules and every image by its content, and only then write. The images go
// to a folder in the temporary directory, which the transaction that saves
// everything else moves into the uploads directory as its last step: an
// import happens completely or not at all, and one cut short leaves only a
// temporary folder, which the next start removes.

export type ImportLimits = {
  /** The most a file may unpack to (MAX_IMPORT_MB). */
  maxImportBytes: number;
  /** The largest mockup, as for uploads (MAX_UPLOAD_MB). */
  maxUploadBytes: number;
};

export type ImportContext = {
  db: Db;
  storage: UploadStorage;
  limits: ImportLimits;
  appVersion: string;
  /** Where the images wait until the project is saved. */
  tmpDir: string;
  /** Makes the IDs of a copy, in order; tests use it to make an insert fail. */
  newId?: () => string;
  now?: Date;
};

/** The folder an import's images wait in, named so a restart can tell. */
export function stagingFolder(tmpDir: string, id: string) {
  return path.join(tmpDir, `import-${id}`);
}

export type ImportResult =
  | { project: Project; notices: ApiIssue[] }
  | { error: string; issues: ApiIssue[] };

const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const MARKDOWN_BUNDLE_FILES = ["README.md", "models.md"];

function shown(text: string) {
  return text.length > 100 ? `${text.slice(0, 97)}…` : text;
}

function refusal(error: string): ImportResult {
  return { error, issues: [] };
}

/** What a file that isn't a zip probably is. */
function notAZip(source: ZipSource) {
  const start = new TextDecoder().decode(source.read(0, 1024)).trimStart();
  if (
    /^(openapi|swagger)\s*:/m.test(start) ||
    /^\{[\s\S]*"(openapi|swagger)"\s*:/.test(start)
  ) {
    return "This is an OpenAPI document, sent as a zip. Send it as application/json or application/yaml instead; in the app, choose it with Import project (reload the page first if it was open from before the app imported OpenAPI).";
  }
  return "This file isn't a zip file. Choose a project file (.project.zip), from the Export tab of API Contract Builder.";
}

/** project.json, at the top of the zip or in one folder, and the folder it's in. */
function findProjectJson(archive: ZipArchive) {
  const candidates = archive.entries.filter(
    (entry) =>
      !entry.directory &&
      !entry.name.startsWith("__MACOSX/") &&
      /^(?:[^/]+\/)?project\.json$/.test(entry.name),
  );
  const [entry] = candidates;
  if (entry && candidates.length === 1) {
    return { entry, base: entry.name.slice(0, -"project.json".length) };
  }
  if (candidates.length > 1) {
    return {
      error:
        "This zip has more than one project.json, so it holds more than one project. Import them one at a time.",
    };
  }
  const names = new Set(
    archive.entries.map((item) => item.name.replace(/^[^/]+\//, "")),
  );
  if (MARKDOWN_BUNDLE_FILES.every((name) => names.has(name))) {
    return {
      error:
        "This is a Markdown bundle, which is for reading. To move a project, download its project file from the Export tab, and import that.",
    };
  }
  return {
    error:
      "This zip has no project.json, so it isn't a project file. Download one from the Export tab of API Contract Builder.",
  };
}

/** Whether any of `ids` is in the column, asked in batches under SQLite's variable limit. */
function anyExists(
  db: Db,
  table: SQLiteTable,
  column: SQLiteColumn,
  ids: string[],
) {
  for (let start = 0; start < ids.length; start += 500) {
    const batch = ids.slice(start, start + 500);
    if (
      db.select({ id: column }).from(table).where(inArray(column, batch)).get()
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Inserts rows with one prepared statement per table. better-sqlite3 frees a
 * statement's native memory only when it's collected, which can't happen
 * before the import ends, so a statement per row would hold memory for every
 * row of a large file. Values go through Drizzle's own column encoders.
 */
function insertRows(
  client: Database.Database,
  table: SQLiteTable,
  rows: Record<string, unknown>[],
) {
  const [first] = rows;
  if (!first) {
    return;
  }
  const keys = Object.keys(first);
  const columns = keys.map((key) => {
    const column = (table as unknown as Record<string, SQLiteColumn>)[key];
    if (!column) {
      throw new Error(`${getTableConfig(table).name} has no column for ${key}`);
    }
    return column;
  });
  const statement = client.prepare(
    `insert into "${getTableConfig(table).name}" (${columns.map((column) => `"${column.name}"`).join(", ")}) values (${columns.map(() => "?").join(", ")})`,
  );
  for (const row of rows) {
    statement.run(
      keys.map((key, index) => {
        const value = row[key];
        return value === null || value === undefined
          ? null
          : columns[index]?.mapToDriverValue(value);
      }),
    );
  }
}

export function importProjectFile(
  context: ImportContext,
  source: ZipSource,
): ImportResult {
  try {
    return importFrom(context, source);
  } catch (error) {
    if (error instanceof NotAZipError) {
      return refusal(notAZip(source));
    }
    if (error instanceof ZipError) {
      return refusal(error.message);
    }
    if (error instanceof RangeError && /call stack/i.test(error.message)) {
      return refusal("This project file nests too deeply to read");
    }
    throw error;
  }
}

function importFrom(
  {
    db,
    storage,
    limits,
    appVersion,
    tmpDir,
    newId = makeId,
    now = new Date(),
  }: ImportContext,
  source: ZipSource,
): ImportResult {
  const archive = openZip(source, { maxEntries: MAX_ZIP_ENTRIES });
  let unpacked = 0;
  const tooMuch = () =>
    refusal(
      `This project file unpacks to more than this instance imports (${formatSize(limits.maxImportBytes)}, MAX_IMPORT_MB). Start it with MAX_IMPORT_MB set higher to import it.`,
    );

  // --- project.json -------------------------------------------------------------

  const found = findProjectJson(archive);
  if ("error" in found) {
    return refusal(found.error ?? "");
  }
  if (found.entry.size > MAX_PROJECT_JSON_BYTES) {
    return refusal(
      `project.json unpacks to more than ${formatSize(MAX_PROJECT_JSON_BYTES)}, the most a project file's project.json may hold`,
    );
  }
  if (found.entry.size > limits.maxImportBytes) {
    return tooMuch();
  }
  const bytes = archive.read(found.entry, found.entry.size);
  unpacked += bytes.length;
  let text: string;
  try {
    // Decoding also drops a byte order mark, which RFC 8259 lets readers ignore.
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refusal("project.json isn't UTF-8 text");
  }
  const problem = checkJsonText(text);
  if (problem) {
    const what =
      problem.kind === "syntax" ? "isn't valid JSON" : "can't be read";
    return refusal(
      `project.json ${what} at line ${problem.line}, column ${problem.column}: ${problem.message}`,
    );
  }
  const checked = validateProjectFile(JSON.parse(text), { appVersion });
  if ("error" in checked) {
    return checked;
  }
  const { document } = checked;

  // --- Images, by their content, like uploads --------------------------------------

  const images = new Map<string, ImportImage>();
  const issues = new IssueList();
  for (const [pageIndex, page] of document.pages.entries()) {
    const owner = `Page ${shown(page.name)}`;
    for (const [mockupIndex, mockup] of page.mockups.entries()) {
      if (issues.full) {
        break;
      }
      const path = `pages.${pageIndex}.mockups.${mockupIndex}.file`;
      const file = shown(mockup.file);
      const entry = archive.get(found.base + mockup.file);
      if (!entry || entry.directory) {
        issues.add(path, `${owner}: ${file} isn't in the zip`);
        continue;
      }
      if (entry.size > limits.maxUploadBytes) {
        issues.add(
          path,
          `${owner}: ${file} is larger than ${formatSize(limits.maxUploadBytes)}, the largest mockup this instance takes (MAX_UPLOAD_MB)`,
        );
        continue;
      }
      if (unpacked + entry.size > limits.maxImportBytes) {
        return tooMuch();
      }
      let data: Uint8Array;
      try {
        data = archive.read(entry, entry.size);
      } catch (error) {
        if (!(error instanceof ZipError)) {
          throw error;
        }
        issues.add(path, `${owner}: ${error.message}`);
        continue;
      }
      unpacked += data.length;
      const image = checkMockupImage(data);
      if (!image) {
        issues.add(
          path,
          `${owner}: ${file} isn't a PNG, JPEG, GIF, or WebP image`,
        );
        continue;
      }
      images.set(mockup.id, {
        ...image,
        read: () => archive.read(entry, entry.size),
      });
    }
  }
  if (!issues.empty) {
    return describeProblems(issues, {
      generator: document.generator,
      appVersion,
    });
  }

  return writeImport(
    { db, storage, limits, appVersion, tmpDir, newId, now },
    document,
    images,
  );
}

/** A checked mockup image of an import, and how to read it again. */
export type ImportImage = {
  type: MockupImageType;
  width: number;
  height: number;
  read: () => Uint8Array;
};

/**
 * Writes a checked project file document as a new project, in one
 * transaction: IDs kept or all new, a free slug, the images moved in last.
 * `slugPath` is where the notice of a taken slug points.
 */
export function writeImport(
  { db, storage, tmpDir, newId = makeId, now = new Date() }: ImportContext,
  document: ProjectFile,
  images: ReadonlyMap<string, ImportImage>,
  { slugPath = "project.slug" }: { slugPath?: string } = {},
): ImportResult {
  // --- IDs ---------------------------------------------------------------------
  // The file's IDs are kept when they're the IDs of an instance (ULIDs) and
  // this one has none of them, so a restored project keeps its links and its
  // file diffs cleanly against the one it came from. Otherwise, as for a
  // second import of the same file, everything gets new IDs: never some.

  const fileIds = {
    models: document.models.map((model) => model.id),
    errorTypes: document.errorTypes.map((errorType) => errorType.id),
    endpoints: document.endpoints.map((endpoint) => endpoint.id),
    pages: document.pages.map((page) => page.id),
    mockups: document.pages.flatMap((page) =>
      page.mockups.map((mockup) => mockup.id),
    ),
  };
  const all = [document.project.id, ...Object.values(fileIds).flat()];
  const instanceIds =
    all.every((id) => ULID.test(id)) && new Set(all).size === all.length;
  // An uploads folder without its project is what a crash while deleting a
  // project leaves: nothing refers to it, so it's removed, not a clash.
  if (
    instanceIds &&
    storage.hasProject(document.project.id) &&
    !anyExists(db, projects, projects.id, [document.project.id])
  ) {
    storage.removeProject(document.project.id);
  }
  const taken =
    instanceIds &&
    (storage.hasProject(document.project.id) ||
      anyExists(db, projects, projects.id, [document.project.id]) ||
      anyExists(db, models, models.id, fileIds.models) ||
      anyExists(db, errorTypes, errorTypes.id, fileIds.errorTypes) ||
      anyExists(db, endpoints, endpoints.id, fileIds.endpoints) ||
      anyExists(db, pages, pages.id, fileIds.pages) ||
      anyExists(db, pageMockups, pageMockups.id, fileIds.mockups));
  const keep = instanceIds && !taken;
  const notices: ApiIssue[] = [];
  if (taken) {
    notices.push({
      path: "project.id",
      message:
        "This project is already on this instance, so the import is a separate copy",
    });
  }
  const idsFor = (ids: string[]) =>
    new Map(ids.map((id) => [id, keep ? id : newId()]));
  const projectId = keep ? document.project.id : newId();
  const modelIds = idsFor(fileIds.models);
  const errorTypeIds = idsFor(fileIds.errorTypes);
  const endpointIds = idsFor(fileIds.endpoints);
  const pageIds = idsFor(fileIds.pages);
  const mockupIds = idsFor(fileIds.mockups);
  /** The new ID; validation made sure every reference has one. */
  const to = (ids: Map<string, string>, id: string) => {
    const mapped = ids.get(id);
    if (mapped === undefined) {
      throw new Error(`Nothing has the ID ${id} in this file`);
    }
    return mapped;
  };
  // The document is this import's own copy, so its schemas are changed in
  // place: copying a large schema would take as much memory again.
  const remap = (schema: JsonSchema) => {
    replaceRefsInPlace(schema, (ref) => {
      const id = modelIdOfRef(ref);
      return id === null ? ref : modelRef(to(modelIds, id));
    });
    return schema;
  };

  // --- Rows ----------------------------------------------------------------------

  const stamps = { createdAt: now, updatedAt: now };
  const modelRows = document.models.map((model) => ({
    id: to(modelIds, model.id),
    projectId,
    name: model.name,
    description: model.description,
    schema: remap(model.schema),
    ...stamps,
  }));
  const errorTypeRows = document.errorTypes.map((errorType) => ({
    id: to(errorTypeIds, errorType.id),
    projectId,
    name: errorType.name,
    status: errorType.status,
    title: errorType.title,
    description: errorType.description,
    headers: remap(errorType.headers),
    body: { ...errorType.body, schema: remap(errorType.body.schema) },
    ...stamps,
  }));
  const endpointRows = document.endpoints.map(({ id, ...fields }) => ({
    ...fields,
    id: to(endpointIds, id),
    projectId,
    pathKey: pathMatchKey(fields.path),
    parameters: {
      path: remap(fields.parameters.path),
      query: remap(fields.parameters.query),
      header: remap(fields.parameters.header),
    },
    requestBody: fields.requestBody && {
      ...fields.requestBody,
      schema: remap(fields.requestBody.schema),
    },
    responses: fields.responses.map((response) => ({
      ...response,
      headers: remap(response.headers),
      body: response.body && {
        ...response.body,
        schema: remap(response.body.schema),
      },
      errors: response.errors.map((usage) => ({
        ...usage,
        errorTypeId: to(errorTypeIds, usage.errorTypeId),
      })),
    })),
    ...stamps,
  }));
  // Every reference must now point at a model of the new project; a place
  // with schemas that remapping missed would be a bug, so it's checked.
  const newModelIds = new Set(modelRows.map((row) => row.id));
  const schemas = [
    ...modelRows.map((row) => row.schema),
    ...errorTypeRows.flatMap((row) =>
      schemasOfErrorType(row).map(([, schema]) => schema),
    ),
    ...endpointRows.flatMap((row) =>
      schemasOfEndpoint(row).map(([, schema]) => schema),
    ),
  ];
  if (
    schemas.some((schema) => modelRefIssues(schema, newModelIds, "").length > 0)
  ) {
    throw new Error("An imported reference doesn't point at an imported model");
  }

  const pageRows = document.pages.map((page, index) => ({
    id: to(pageIds, page.id),
    projectId,
    name: page.name,
    slug: page.slug,
    description: page.description,
    acceptanceCriteria: page.acceptanceCriteria,
    states: page.states.map((state) => ({
      ...state,
      causes: state.causes.map((cause) =>
        cause.type === "error"
          ? { ...cause, errorTypeId: to(errorTypeIds, cause.errorTypeId) }
          : cause,
      ),
      mockupIds: state.mockupIds.map((id) => to(mockupIds, id)),
    })),
    sortOrder: index,
    ...stamps,
  }));
  const linkRows = document.pages.flatMap((page) =>
    page.endpoints.map((link, index) => ({
      ...link,
      pageId: to(pageIds, page.id),
      endpointId: to(endpointIds, link.endpointId),
      sortOrder: index,
    })),
  );
  const uploads = document.pages.flatMap((page) =>
    page.mockups.map((mockup, index) => {
      const image = images.get(mockup.id);
      if (!image) {
        throw new Error(`No image for mockup ${mockup.id}`);
      }
      const id = to(mockupIds, mockup.id);
      return {
        image,
        row: {
          id,
          pageId: to(pageIds, page.id),
          // A new name, as for an upload: files under /uploads are cached
          // for good, so a kept ID mustn't bring back an old image's URL.
          fileName: `${newId()}.${image.type}`,
          originalName: mockup.originalName,
          mimeType: MOCKUP_MIME_TYPES[image.type],
          width: image.width,
          height: image.height,
          caption: mockup.caption,
          sortOrder: index,
          createdAt: now,
        },
      };
    }),
  );

  // --- Writing -----------------------------------------------------------------
  // better-sqlite3 is synchronous, and so is everything since the request
  // body was read: no other request runs in between.

  const staging = stagingFolder(tmpDir, newId());
  let moved = false;
  let committed = false;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const { image, row } of uploads) {
      fs.writeFileSync(path.join(staging, row.fileName), image.read());
    }
    const project = db.transaction((tx) => {
      const slug = uniqueSlug(
        document.project.slug,
        (candidate) =>
          tx
            .select({ id: projects.id })
            .from(projects)
            .where(eq(projects.slug, candidate))
            .get() !== undefined,
      );
      const row = tx
        .insert(projects)
        .values({
          id: projectId,
          name: document.project.name,
          slug,
          description: document.project.description,
          apiVersion: document.project.apiVersion,
          servers: document.project.servers,
          securitySchemes: document.project.securitySchemes,
          defaultSecuritySchemeId: document.project.defaultSecuritySchemeId,
          ...stamps,
        })
        .returning()
        .get();
      // In the transaction: better-sqlite3 has one connection.
      insertRows(db.$client, models, modelRows);
      insertRows(db.$client, errorTypes, errorTypeRows);
      insertRows(db.$client, endpoints, endpointRows);
      insertRows(db.$client, pages, pageRows);
      insertRows(db.$client, pageEndpoints, linkRows);
      insertRows(
        db.$client,
        pageMockups,
        uploads.map(({ row: values }) => values),
      );
      // Last, so a failure here rolls the rows back too.
      storage.adoptProject(projectId, staging);
      moved = true;
      return row;
    });
    committed = true;
    if (project.slug !== document.project.slug) {
      notices.push({
        path: slugPath,
        message: `${document.project.slug} is used by another project, so this one is ${project.slug}`,
      });
    }
    return { project: toProject(project), notices };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    // Moved in, but the commit failed: the folder is this import's alone.
    if (moved && !committed) {
      storage.removeProject(projectId);
    }
  }
}
