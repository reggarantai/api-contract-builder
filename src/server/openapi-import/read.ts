import fs from "node:fs";
import { fileURLToPath } from "node:url";
import v8 from "node:v8";
import { Worker } from "node:worker_threads";
import type { ApiIssue } from "../../shared/api-error";
import { MAX_NESTING } from "../../shared/json-schema";
import { MAX_OPENAPI_BYTES } from "../../shared/project-file";
import { checkJsonText } from "../project-file/json-text";
import { shownPointer } from "./pointer";
import {
  inexactNotice,
  readYamlText,
  YAML_TASK,
  type YamlRead,
  type YamlTask,
} from "./yaml-reader";

// Reads an OpenAPI document's text, from someone else, into plain values:
// JSON by RFC 8259 with I-JSON's rules (as project.json is read), YAML by
// YAML 1.2 with what OpenAPI asks of it ("Tags MUST be limited to those
// allowed by the JSON Schema ruleset", keys are strings). Every limit is
// checked before anything that recurses or builds a tree runs, so neither
// the stack nor a small file's expansion decides what's read.

export const OPENAPI_LIMITS = {
  /** As project.json: text read into memory whole. */
  maxBytes: MAX_OPENAPI_BYTES,
  /** The deepest a schema or example sits in a document, plus MAX_NESTING. */
  maxDepth: MAX_NESTING + 16,
  maxValues: 1_000_000,
  /**
   * Reading YAML builds a syntax tree of about 0.7 KB a token (1.2 KB of
   * memory at its peak), against about 0.1 KB a value for JSON: GitHub's
   * REST API description has about 680,000 tokens as YAML (11 MB).
   */
  maxYamlTokens: 1_000_000,
  /**
   * The tree also keeps a small token (about 0.1 KB) for each line break,
   * blank lines too; GitHub's has about 270,000.
   */
  maxYamlLines: 1_000_000,
  /**
   * Characters of text (strings and names) a document may hold once what
   * YAML aliases and references point at is copied in: as much as a
   * document may have, so copies can't make a project the exports can't
   * handle (each copy is written out on its own in the database and the
   * exports).
   */
  maxText: MAX_OPENAPI_BYTES,
  /**
   * Characters the OpenAPI download of an imported project may take, as
   * written (indented, escaped): about twice GitHub's REST API description
   * (16 MB as JSON). Under a 587 MB heap, exports of 30 MB took 450–560 MB
   * at most, the import included.
   */
  maxExportText: 2 * MAX_OPENAPI_BYTES,
} as const;

export type TextFormat = "json" | "yaml";

export type ReadResult =
  | {
      value: unknown;
      /** Numbers a double changes, at their JSON Pointer. */
      notices: ApiIssue[];
      /**
       * The text of a YAML plain scalar that isn't a string (`version: 1.0`
       * is the number 1), for fields that must be text, by the object or
       * list it's in and its key or index.
       */
      sourceText: (
        container: object,
        key: string | number,
      ) => string | undefined;
    }
  | { error: string; issues: ApiIssue[] };

/** Notices of one kind past which a document only counts them. */
const MAX_NUMBER_NOTICES = 100;

function refusal(error: string): ReadResult {
  return { error, issues: [] };
}

// --- Encodings -------------------------------------------------------------------

type Encoding = "utf-8" | "utf-16le" | "utf-16be" | "utf-32le" | "utf-32be";

/**
 * The encoding YAML 1.2.2 §5.2 deduces: a byte order mark, or the zero bytes
 * of an ASCII first character. JSON is always UTF-8 (RFC 8259 §8.1), but the
 * same signs tell what a JSON file was saved as.
 */
function encodingOf(bytes: Uint8Array): Encoding {
  const [a, b, c, d] = bytes;
  if (a === 0x00 && b === 0x00 && c === 0xfe && d === 0xff) return "utf-32be";
  if (a === 0xff && b === 0xfe && c === 0x00 && d === 0x00) return "utf-32le";
  if (a === 0xfe && b === 0xff) return "utf-16be";
  if (a === 0xff && b === 0xfe) return "utf-16le";
  if (a === 0xef && b === 0xbb && c === 0xbf) return "utf-8";
  if (bytes.length >= 4) {
    if (a === 0 && b === 0 && c === 0 && d !== 0) return "utf-32be";
    if (a !== 0 && b === 0 && c === 0 && d === 0) return "utf-32le";
  }
  if (bytes.length >= 2) {
    if (a === 0 && b !== 0) return "utf-16be";
    if (a !== 0 && b === 0) return "utf-16le";
  }
  return "utf-8";
}

/** UTF-32, which TextDecoder doesn't know, or null when it's broken. */
function decodeUtf32(bytes: Uint8Array, littleEndian: boolean) {
  if (bytes.length % 4 !== 0) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const parts: string[] = [];
  const chunk: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 4) {
    const point = view.getUint32(offset, littleEndian);
    if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      return null;
    }
    if (!(offset === 0 && point === 0xfeff)) {
      chunk.push(point);
    }
    if (chunk.length === 4096) {
      parts.push(String.fromCodePoint(...chunk));
      chunk.length = 0;
    }
  }
  parts.push(String.fromCodePoint(...chunk));
  return parts.join("");
}

function decode(bytes: Uint8Array, encoding: Encoding): string | null {
  if (encoding === "utf-32le" || encoding === "utf-32be") {
    return decodeUtf32(bytes, encoding === "utf-32le");
  }
  try {
    // Decoding drops a byte order mark, as both RFC 8259 and YAML allow.
    return new TextDecoder(encoding, { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

const ENCODING_NAMES: Record<Encoding, string> = {
  "utf-8": "UTF-8",
  "utf-16le": "UTF-16",
  "utf-16be": "UTF-16",
  "utf-32le": "UTF-32",
  "utf-32be": "UTF-32",
};

/** The text of a document, decoded, or why it can't be. */
function decodeText(
  bytes: Uint8Array,
  format: TextFormat,
): string | ReadResult {
  if (bytes.length > OPENAPI_LIMITS.maxBytes) {
    return refusal(
      "This file is larger than 16 MB, the most an OpenAPI document may be",
    );
  }
  const encoding = encodingOf(bytes);
  if (format === "json" && encoding !== "utf-8") {
    return refusal(
      `This file is ${ENCODING_NAMES[encoding]} text, but JSON must be UTF-8 (RFC 8259). Save it as UTF-8, or as YAML, and import that.`,
    );
  }
  const text = decode(bytes, encoding);
  if (text === null) {
    return refusal(
      encoding === "utf-8"
        ? "This file isn't UTF-8 text"
        : `This file isn't valid ${ENCODING_NAMES[encoding]} text`,
    );
  }
  return text;
}

const YAML_LIMITS = {
  maxTokens: OPENAPI_LIMITS.maxYamlTokens,
  maxLines: OPENAPI_LIMITS.maxYamlLines,
  maxDepth: OPENAPI_LIMITS.maxDepth,
  maxValues: OPENAPI_LIMITS.maxValues,
  maxText: OPENAPI_LIMITS.maxText,
};

/** A YAML reading as a ReadResult, its source texts looked up by container. */
function withSources(read: YamlRead): ReadResult {
  if ("error" in read) {
    return read;
  }
  const texts = new WeakMap<object, Map<string | number, string>>();
  const { sources } = read;
  for (let index = 0; index + 2 < sources.length; index += 3) {
    const container = sources[index] as object;
    let map = texts.get(container);
    if (!map) {
      map = new Map();
      texts.set(container, map);
    }
    map.set(
      sources[index + 1] as string | number,
      sources[index + 2] as string,
    );
  }
  return {
    value: read.value,
    notices: read.notices,
    sourceText: (container, key) => texts.get(container)?.get(key),
  };
}

/** Reads a document in this thread: for tests, and for JSON. */
export function readOpenApiTextSync(
  bytes: Uint8Array,
  format: TextFormat,
): ReadResult {
  const text = decodeText(bytes, format);
  if (typeof text !== "string") {
    return text;
  }
  return format === "json"
    ? readJson(text)
    : withSources(readYamlText(text, YAML_LIMITS));
}

export type ReadOptions = {
  /** The heap the YAML worker may use; the server's own, by default. */
  yamlHeapMb?: number;
  /** How long the YAML worker may take. */
  yamlTimeoutMs?: number;
  /** The YAML worker's module; found next to this one by default. */
  yamlReader?: URL;
};

/** Where the worker's module is: next to this one, or next to the bundle. */
function yamlReaderUrl(given: URL | undefined) {
  const candidates = given
    ? [given]
    : [
        new URL("./openapi-import/yaml-reader.js", import.meta.url),
        new URL("./yaml-reader.ts", import.meta.url),
      ];
  return candidates.find((url) => fs.existsSync(fileURLToPath(url)));
}

/**
 * YAML documents are read one at a time: each worker may use as much heap
 * as the server has, so two at once could need twice what's there.
 */
let yamlQueue: Promise<unknown> = Promise.resolve();

function oneAtATime<T>(task: () => Promise<T>): Promise<T> {
  const run = yamlQueue.then(task, task);
  // Waits for it, without keeping what it read.
  yamlQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Reads a document. YAML is read in a worker thread with a heap limit: its
 * syntax tree takes much more memory than the text (about 0.7 KB a token),
 * and a small file can need more than a small container has, which would
 * stop the whole server; this way only the worker stops, and the import is
 * refused with the reason. The limit is the server's own heap, so the
 * worker can read what the server could.
 */
export async function readOpenApiText(
  bytes: Uint8Array,
  format: TextFormat,
  {
    yamlHeapMb = Math.floor(
      v8.getHeapStatistics().heap_size_limit / 1024 / 1024,
    ),
    yamlTimeoutMs = 120_000,
    yamlReader,
  }: ReadOptions = {},
): Promise<ReadResult> {
  const text = decodeText(bytes, format);
  if (typeof text !== "string") {
    return text;
  }
  if (format === "json") {
    return readJson(text);
  }
  const url = yamlReaderUrl(yamlReader);
  if (!url) {
    console.error(
      `The YAML reader's module isn't next to the server (${fileURLToPath(new URL("./openapi-import/yaml-reader.js", import.meta.url))})`,
    );
    return refusal(
      "This instance can't read YAML: its YAML reader is missing, which is a problem with the installation. Save the document as JSON and import that, and please report it.",
    );
  }
  const task: YamlTask = { kind: YAML_TASK, text, limits: YAML_LIMITS };
  return oneAtATime(() => readInWorker(url, task, yamlHeapMb, yamlTimeoutMs));
}

/**
 * Reads YAML in a worker, answering once the worker has stopped, so the
 * next reading starts only when this one's memory is free.
 */
function readInWorker(
  url: URL,
  task: YamlTask,
  yamlHeapMb: number,
  yamlTimeoutMs: number,
) {
  return new Promise<ReadResult>((resolve, reject) => {
    const worker = new Worker(url, {
      workerData: task,
      resourceLimits: { maxOldGenerationSizeMb: yamlHeapMb },
    });
    let outcome: { result: ReadResult } | { failure: Error } | undefined;
    const end = (next: { result: ReadResult } | { failure: Error }) => {
      outcome ??= next;
      void worker.terminate();
    };
    const timer = setTimeout(() => {
      end({
        result: refusal(
          `Reading this YAML document took longer than ${Math.round(yamlTimeoutMs / 1000)} seconds, so it was stopped. Save it as JSON, which reads much faster, and import that.`,
        ),
      });
    }, yamlTimeoutMs);
    worker.once("message", (read: YamlRead) => {
      end({ result: withSources(read) });
    });
    worker.once("error", (error: Error & { code?: string }) => {
      end(
        error.code === "ERR_WORKER_OUT_OF_MEMORY"
          ? {
              result: refusal(
                `This YAML document needs more memory to read than this instance gives it (${yamlHeapMb.toLocaleString("en-US")} MB). Save it as JSON, which takes much less, or start the app with more memory, and import it again.`,
              ),
            }
          : { failure: error },
      );
    });
    worker.once("exit", () => {
      clearTimeout(timer);
      if (!outcome) {
        reject(new Error("The YAML reader stopped without an answer"));
      } else if ("failure" in outcome) {
        reject(outcome.failure);
      } else {
        resolve(outcome.result);
      }
    });
  });
}

// --- JSON --------------------------------------------------------------------

function readJson(text: string): ReadResult {
  const notices: ApiIssue[] = [];
  let inexact = 0;
  const problem = checkJsonText(text, {
    maxDepth: OPENAPI_LIMITS.maxDepth,
    maxValues: OPENAPI_LIMITS.maxValues,
    onInexactInteger: (literal, place) => {
      if (inexact++ < MAX_NUMBER_NOTICES) {
        notices.push(inexactNotice(literal, shownPointer(place())));
      }
    },
  });
  if (problem) {
    const what =
      problem.kind === "syntax" ? "isn't valid JSON" : "can't be read";
    return refusal(
      `This file ${what} at line ${problem.line}, column ${problem.column}: ${problem.message}`,
    );
  }
  return {
    value: JSON.parse(text),
    notices,
    sourceText: () => undefined,
  };
}
