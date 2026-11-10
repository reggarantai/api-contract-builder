import type { Page } from "../../shared/pages";
import type { Project } from "../../shared/projects";
import { MarkdownTooLargeError } from "../export/markdown";
import { buildMarkdownFiles } from "../export/markdown-files";
import { buildOpenApi, type ExportInput } from "../export/openapi";
import type { ProjectFile } from "../project-file/format";
import { OPENAPI_LIMITS } from "./read";

// What a project's exports would write, measured before it's imported: the
// exports write more than the project holds (a page into every operation
// it links, a model's name into every reference to it, an error type into
// every response that uses it, an endpoint into every page that calls it),
// and a project the instance can't export would stop it on the Export tab.

const TIME = "1970-01-01T00:00:00.000Z";

/** A project file document as the exports read a project, without a database. */
export function exportInputOf(document: ProjectFile): ExportInput {
  const meta = {
    projectId: "p",
    revision: 0,
    createdAt: TIME,
    updatedAt: TIME,
  };
  return {
    project: {
      ...document.project,
      id: "p",
      revision: 0,
      createdAt: TIME,
      updatedAt: TIME,
    } as Project,
    models: document.models.map((model) => ({ ...model, ...meta })),
    endpoints: document.endpoints.map((endpoint) => ({ ...endpoint, ...meta })),
    errorTypes: document.errorTypes.map((errorType) => ({
      ...errorType,
      ...meta,
      endpointIds: [],
    })),
    pages: document.pages.map(
      (page) => ({ ...page, ...meta, mockups: [] }) as unknown as Page,
    ),
  };
}

/** Characters of strings and names, and one a value, counted up to just past `limit`. */
export function textOf(value: unknown, limit: number) {
  let text = 0;
  const pending: unknown[] = [value];
  while (pending.length > 0 && text <= limit) {
    const next = pending.pop();
    text += 1;
    if (typeof next === "string") {
      text += next.length;
    } else if (Array.isArray(next)) {
      for (const item of next) pending.push(item);
    } else if (typeof next === "object" && next !== null) {
      for (const [key, item] of Object.entries(next)) {
        text += key.length;
        pending.push(item);
      }
    }
  }
  return text;
}

/** Code units JSON or YAML writes differently: escapes, quotes, lines. */
const WRITTEN_SPECIAL =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: they're what's counted.
  /["\\\u0000-\u001f\u007f-\u009f\u2028\u2029\ufeff\ud800-\udfff]/;

/**
 * The characters a string takes, quoted, as JSON writes it or YAML does
 * (which escapes a few more), whichever is longer.
 */
function writtenLength(text: string) {
  if (!WRITTEN_SPECIAL.test(text)) return text.length + 2;
  let length = 2;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code === 0x22 || code === 0x5c) {
      length += 2;
    } else if (code < 0x20) {
      // \n, \t, … or \u0001
      length +=
        code === 0x08 ||
        code === 0x09 ||
        code === 0x0a ||
        code === 0x0c ||
        code === 0x0d
          ? 2
          : 6;
    } else if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        length += 2;
        index++;
      } else {
        length += 6;
      }
    } else if (
      (code >= 0x7f && code <= 0x9f) ||
      code === 0x2028 ||
      code === 0x2029 ||
      code === 0xfeff ||
      (code >= 0xdc00 && code <= 0xdfff)
    ) {
      length += 6;
    } else {
      length += 1;
    }
  }
  return length;
}

function lineBreaks(text: string) {
  let count = 0;
  for (
    let at = text.indexOf("\n");
    at !== -1;
    at = text.indexOf("\n", at + 1)
  ) {
    count++;
  }
  return count;
}

/**
 * At most how many characters an export writes for `value`: as
 * `JSON.stringify(value, null, 2)` does (each value on its own line,
 * indented two spaces a level), with escapes as JSON or YAML writes them,
 * whichever is longer, and each line of a text YAML writes as a block
 * indented as deep as it sits. Counted without writing it, up to just
 * past `limit`.
 */
export function writtenSize(value: unknown, limit: number) {
  let size = 0;
  const pending: [unknown, number][] = [[value, 0]];
  while (pending.length > 0 && size <= limit) {
    const [next, depth] = pending.pop() as [unknown, number];
    // Its line: the indentation, then a comma and a line break.
    const line = 2 * depth + 2;
    if (typeof next === "string") {
      size += writtenLength(next) + lineBreaks(next) * line;
    } else if (typeof next === "number") {
      size += String(next).length;
    } else if (typeof next === "boolean") {
      size += 5;
    } else if (Array.isArray(next)) {
      size += next.length === 0 ? 2 : 2 + line;
      for (const item of next) {
        size += 2 * (depth + 1) + 2;
        pending.push([item, depth + 1]);
      }
    } else if (typeof next === "object" && next !== null) {
      const entries = Object.entries(next).filter(
        ([, item]) => item !== undefined,
      );
      size += entries.length === 0 ? 2 : 2 + line;
      for (const [key, item] of entries) {
        size += 2 * (depth + 1) + 2 + writtenLength(key) + 2;
        pending.push([item, depth + 1]);
      }
    } else {
      size += 4;
    }
  }
  return size;
}

/** Writing recurses: too deep for it, and the exports refuse with a reason. */
function isTooDeep(error: unknown) {
  return error instanceof RangeError && /call stack/i.test(error.message);
}

/**
 * The export that would write more than it may, if one would: the OpenAPI
 * download more than `openApiLimit` characters as written (which also
 * bounds every JSON block the Markdown writes of its parts), or the
 * Markdown files more than `markdownLimit`.
 */
export function exportOverLimit(
  document: ProjectFile,
  {
    openApiLimit,
    markdownLimit,
  }: { openApiLimit: number; markdownLimit: number },
): "openapi" | "markdown" | undefined {
  const input = exportInputOf(document);
  const limit = markdownLimit;
  try {
    if (writtenSize(buildOpenApi(input, {}), openApiLimit) > openApiLimit) {
      return "openapi";
    }
  } catch (error) {
    if (!isTooDeep(error)) throw error;
  }
  try {
    // Its budget counts a piece up to three times as it writes, and stops
    // it early; what it wrote is then measured as written.
    const files = buildMarkdownFiles(
      input,
      {},
      { readImage: () => undefined, openApi: null },
      3 * limit,
    );
    let text = 0;
    for (const file of Object.values(files)) {
      if (typeof file === "string") text += file.length;
    }
    if (text > limit) return "markdown";
  } catch (error) {
    if (error instanceof MarkdownTooLargeError) return "markdown";
    if (!isTooDeep(error)) throw error;
  }
  return undefined;
}

const MB = (characters: number) => `${Math.round(characters / 1024 / 1024)} MB`;

/** Why a project whose export would write more than it may isn't imported. */
export function exportTooLarge(which: "openapi" | "markdown") {
  return which === "openapi"
    ? `This document makes a project whose OpenAPI export would hold more than ${MB(OPENAPI_LIMITS.maxExportText)} of text as written, more than the app writes for one document: the export writes each part a reference points at into every place that uses it, each page into every operation it links (tags and x-pages), each model's name into every reference to it, and each value on its own line, indented as deep as it sits.`
    : `This document makes a project whose Markdown export would hold more than ${MB(OPENAPI_LIMITS.maxText)} of text, more than a document may have: the bundle writes every endpoint into each page that calls it, and each nested field with the names of the fields it's in.`;
}
