import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildMarkdownFiles } from "../export/markdown-files";
import {
  buildOpenApi,
  lintContract,
  validateContract,
} from "../export/openapi";
import type { ProjectFile } from "../project-file/format";
import { validateProjectFile } from "../project-file/validate";
import { convertOpenApi } from "./convert";
import { readOpenApiTextSync } from "./read";
import { exportInputOf } from "./test-convert";

// Documents from someone else can be anything. Mutations of the frozen
// fixtures, from a fixed seed, must never make the import throw (nor blame
// the app), what the converter makes must always pass the project file
// rules, and the project must export: a refusal comes from reading the
// document, never from a part the converter let by.

const FIXTURES = path.resolve("test/fixtures/openapi");
const FILES = [
  "bookshop-3.0.yaml",
  "bookshop-3.0.json",
  "events-3.1.yaml",
  "events-3.1.json",
  "kiosk-3.2.yaml",
];

/** mulberry32: small, fast, and the same everywhere for a seed. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

type Value = unknown;

const ODD_VALUES: Value[] = [
  null,
  true,
  0,
  -1,
  1.5,
  2 ** 63,
  "",
  "x".repeat(3000),
  "#/",
  "#",
  "#/components/schemas/__proto__",
  "#/components/schemas/Missing",
  "#/paths",
  "#/x/~2",
  "#/%zz",
  "#anchor",
  "https://evil.example/x.json",
  "../x.yaml",
  "3.1.0",
  "2.0",
  "default",
  "4XX",
  "application/json",
  "{id}",
  [],
  [1, "a", null],
  {},
  { $ref: "#/components/schemas/Book" },
  { $ref: "#/components/examples/not-found" },
  { $ref: "#/paths/~1books/get" },
  { $ref: 5 },
  { type: "object", properties: { a: { $ref: "#" } } },
  { nullable: true, allOf: [{ $ref: "#/components/schemas/Book" }] },
  { exclusiveMinimum: true },
  { description: "Only with `busy`: x" },
  // Valid JSON, but String() on these throws.
  { toString: 1 },
  { toString: 1, valueOf: 1 },
  ["a", { toString: 1 }],
  "%",
  "#/components/schemas/%",
  "#/components/schemas/My%20Pet",
  {
    discriminator: { propertyName: "k" },
    oneOf: [{ $ref: "#/components/schemas/%" }],
  },
  {
    discriminator: {
      propertyName: "k",
      mapping: { a: "#/components/schemas/%zz" },
    },
    oneOf: [{ $ref: "#/components/schemas/Book" }],
  },
  { $schema: 5, type: "object" },
  { $schema: { toString: 1 } },
  { type: [{ toString: 1 }], description: { toString: 1 } },
  { $ref: "#/components/schemas/Book", allOf: [{ maximum: 10 }] },
  [{ undefinedScheme: [] }],
  [{ bearerAuth: [{ toString: 1 }] }],
  { $ref: "#/components/mediaTypes/Missing" },
  { dataValue: null },
];

const ODD_KEYS = [
  "__proto__",
  "constructor",
  "$ref",
  "x-odd",
  "",
  "200",
  "4xx",
  "default",
  "{id}",
  "/a b",
  "trace",
  "query",
  "nullable",
  "toString",
  "valueOf",
  "hasOwnProperty",
  "$schema",
];

function containers(root: Value) {
  const found: {
    holder: Record<string, Value> | Value[];
    key: string | number;
  }[] = [];
  const pending: Value[] = [root];
  for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
    if (Array.isArray(next)) {
      next.forEach((item, index) => {
        found.push({ holder: next as Value[], key: index });
        pending.push(item);
      });
    } else if (typeof next === "object" && next !== null) {
      for (const key of Object.keys(next)) {
        found.push({ holder: next as Record<string, Value>, key });
        pending.push((next as Record<string, Value>)[key]);
      }
    }
  }
  return found;
}

function mutate(document: Value, next: () => number) {
  const pick = <T>(items: T[]) => items[Math.floor(next() * items.length)] as T;
  const places = containers(document);
  // A whole model replaced, at times: what's at a schema's root matters most.
  const schemas = (document as { components?: { schemas?: unknown } })
    .components?.schemas;
  if (
    next() < 0.15 &&
    typeof schemas === "object" &&
    schemas !== null &&
    !Array.isArray(schemas)
  ) {
    const names = Object.keys(schemas);
    if (names.length > 0) {
      (schemas as Record<string, Value>)[pick(names)] = structuredClone(
        pick(ODD_VALUES),
      );
    }
  }
  for (let count = 1 + Math.floor(next() * 4); count > 0; count--) {
    const place = pick(places);
    if (!place) return;
    const { holder, key } = place;
    const choice = next();
    if (choice < 0.3) {
      if (Array.isArray(holder)) holder.splice(Number(key), 1);
      else delete holder[key as string];
    } else if (choice < 0.65) {
      const value = structuredClone(pick(ODD_VALUES));
      if (Array.isArray(holder)) holder[Number(key)] = value;
      else holder[key as string] = value;
    } else if (choice < 0.85 && !Array.isArray(holder)) {
      const value = holder[key as string];
      delete holder[key as string];
      Object.defineProperty(holder, pick(ODD_KEYS), {
        value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    } else {
      // A copy of another part, somewhere it doesn't belong.
      const other = pick(places);
      if (!other) return;
      const value = structuredClone(
        (other.holder as Record<string | number, Value>)[other.key],
      );
      if (Array.isArray(holder)) holder[Number(key)] = value;
      else holder[key as string] = value;
    }
  }
}

/** Exports what was made, as the Export tab and the downloads do; throws if any part fails. */
async function exportAll(document: ProjectFile) {
  const input = exportInputOf(document);
  const doc = buildOpenApi(input, {});
  lintContract(input, {});
  buildMarkdownFiles(input, {}, { readImage: () => undefined, openApi: null });
  await validateContract(input, doc, {});
  // Every operation ID the project has comes back, and none twice.
  const ids = Object.values(doc.paths).flatMap((item) =>
    Object.values(item ?? {}).map((operation) => operation?.operationId),
  );
  expect(new Set(ids).size).toBe(ids.length);
  for (const endpoint of document.endpoints) {
    if (endpoint.operationId === "") continue;
    expect(
      doc.paths[endpoint.path]?.[
        endpoint.method.toLowerCase() as keyof (typeof doc.paths)[string]
      ]?.operationId,
    ).toBe(endpoint.operationId);
  }
}

describe("documents mutated at random", () => {
  it.each(FILES)(
    "%s: never throw, and what's made always passes the project file rules and exports",
    { timeout: 300_000 },
    async (file) => {
      const text = fs.readFileSync(path.join(FIXTURES, file));
      const read = readOpenApiTextSync(
        new Uint8Array(text),
        file.endsWith(".json") ? "json" : "yaml",
      );
      if ("error" in read) throw new Error(read.error);
      let made = 0;
      for (let seed = 1; seed <= 1000; seed++) {
        const document = structuredClone(read.value);
        mutate(document, random(seed * 7919 + file.length));
        let result: ReturnType<typeof convertOpenApi>;
        try {
          result = convertOpenApi(document, {});
        } catch (error) {
          throw new Error(
            `${file}, seed ${seed}: the converter threw ${(error as Error).stack}`,
          );
        }
        if ("error" in result) {
          expect(result.error, `${file}, seed ${seed}`).not.toBe("");
          expect(result.error, `${file}, seed ${seed}`).not.toMatch(
            /problem in the app/,
          );
          continue;
        }
        made++;
        const checked = validateProjectFile(structuredClone(result.document), {
          appVersion: "1.2.3",
        });
        if ("error" in checked) {
          throw new Error(
            `${file}, seed ${seed}: the converted document breaks the rules: ${checked.issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
          );
        }
        try {
          await exportAll(result.document as ProjectFile);
        } catch (error) {
          throw new Error(
            `${file}, seed ${seed}: exporting what was made failed: ${(error as Error).stack}`,
          );
        }
      }
      // Most mutations still make a project, so the rules are really exercised.
      expect(made).toBeGreaterThan(500);
    },
  );

  it.each(FILES)("%s: broken text never makes reading throw", (file) => {
    const original = new Uint8Array(fs.readFileSync(path.join(FIXTURES, file)));
    const format = file.endsWith(".json") ? "json" : "yaml";
    for (let seed = 1; seed <= 200; seed++) {
      const next = random(seed * 104729);
      const bytes = original.slice(0, Math.floor(next() * original.length) + 1);
      for (let flips = Math.floor(next() * 8); flips > 0; flips--) {
        bytes[Math.floor(next() * bytes.length)] = Math.floor(next() * 256);
      }
      let read: ReturnType<typeof readOpenApiTextSync>;
      try {
        read = readOpenApiTextSync(bytes, format);
      } catch (error) {
        throw new Error(
          `${file}, seed ${seed}: reading threw ${(error as Error).stack}`,
        );
      }
      if (!("error" in read)) {
        let result: ReturnType<typeof convertOpenApi>;
        try {
          result = convertOpenApi(read.value, { sourceText: read.sourceText });
        } catch (error) {
          throw new Error(
            `${file}, seed ${seed}: the converter threw ${(error as Error).stack}`,
          );
        }
        if ("error" in result) {
          expect(result.error, `${file}, seed ${seed}`).not.toMatch(
            /problem in the app/,
          );
        }
      }
    }
  });
});
