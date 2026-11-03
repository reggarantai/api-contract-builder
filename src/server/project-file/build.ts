import path from "node:path";
import { endpointFieldsSchema } from "../../shared/endpoints";
import { errorTypeFieldsSchema } from "../../shared/error-types";
import { modelFieldsSchema } from "../../shared/models";
import { type Mockup, pageFieldsSchema } from "../../shared/pages";
import { projectSettingsFieldsSchema } from "../../shared/projects";
import type { ExportInput } from "../export/openapi";
import {
  PROJECT_FILE_FORMAT,
  PROJECT_FILE_VERSION,
  type ProjectFile,
  type ProjectFileMockup,
} from "./format";

// The fields of each part come from the shared rules, so a field added there
// is exported too (and the golden file shows it).
const PROJECT_FIELDS = Object.keys(projectSettingsFieldsSchema.shape);
const MODEL_FIELDS = Object.keys(modelFieldsSchema.shape);
const ERROR_TYPE_FIELDS = Object.keys(errorTypeFieldsSchema.shape);
const ENDPOINT_FIELDS = Object.keys(endpointFieldsSchema.shape);
// Mockups go just before states, where someone reading the file looks.
const PAGE_FIELDS = Object.keys(pageFieldsSchema.shape).filter(
  (field) => field !== "states",
);

/**
 * In ID order: an instance's IDs are ULIDs, made in order, so a part keeps
 * its place when it's renamed or moved, and a new one comes last.
 */
function byId<T extends { id: string }>(items: T[]) {
  return [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function pick<T extends object>(item: T, fields: string[]) {
  const values = item as Record<string, unknown>;
  return Object.fromEntries(fields.map((field) => [field, values[field]]));
}

export type ProjectFileImage = {
  /** Where the image goes in the zip, from project.json's folder. */
  path: string;
  mockup: Mockup;
  size: number;
};

/**
 * The project file of a project, read through the API's view of it (so with
 * the read-time repairs, like unique response IDs), and the images to put
 * next to it. A mockup whose file is gone is left out, with its place in
 * states, and listed in `missing`.
 */
export function buildProjectFile(
  input: ExportInput,
  {
    generator,
    sizeOf,
  }: {
    generator: string;
    /** The size of a mockup's file, or undefined when it's missing. */
    sizeOf: (mockup: Mockup) => number | undefined;
  },
) {
  const files: ProjectFileImage[] = [];
  const missing: { page: string; mockup: string }[] = [];

  const pages = input.pages.map((page) => {
    const kept = new Set<string>();
    const mockups: ProjectFileMockup[] = [];
    for (const mockup of page.mockups) {
      const size = sizeOf(mockup);
      if (size === undefined) {
        missing.push({ page: page.name, mockup: mockup.originalName });
        continue;
      }
      const file = `mockups/${mockup.id}${path.posix.extname(mockup.url)}`;
      files.push({ path: file, mockup, size });
      kept.add(mockup.id);
      mockups.push({
        id: mockup.id,
        file,
        originalName: mockup.originalName,
        caption: mockup.caption,
      });
    }
    return {
      id: page.id,
      ...pick(page, PAGE_FIELDS),
      mockups,
      states: page.states.map((state) => ({
        ...state,
        mockupIds: state.mockupIds.filter((id) => kept.has(id)),
      })),
    };
  });

  const document = {
    format: PROJECT_FILE_FORMAT,
    formatVersion: PROJECT_FILE_VERSION,
    generator,
    project: { id: input.project.id, ...pick(input.project, PROJECT_FIELDS) },
    models: byId(input.models).map((model) => ({
      id: model.id,
      ...pick(model, MODEL_FIELDS),
    })),
    errorTypes: byId(input.errorTypes).map((errorType) => ({
      id: errorType.id,
      ...pick(errorType, ERROR_TYPE_FIELDS),
    })),
    endpoints: byId(input.endpoints).map((endpoint) => ({
      id: endpoint.id,
      ...pick(endpoint, ENDPOINT_FIELDS),
    })),
    pages,
  } as ProjectFile;
  return { document, files, missing };
}

/** Levels indented in project.json; deeper parts are written on one line. */
const INDENTED_LEVELS = 64;

/**
 * Like JSON.stringify(value, null, 2), down to `INDENTED_LEVELS`: one value a
 * line reads and diffs well, but indentation grows with depth, so a model
 * nested thousands of levels deep would take quadratic space.
 */
function indented(value: unknown, depth: number, indent: string): string {
  if (depth >= INDENTED_LEVELS || value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    const items = value.map(
      (item) =>
        `${inner}${item === undefined ? "null" : indented(item, depth + 1, inner)}`,
    );
    return `[\n${items.join(",\n")}\n${indent}]`;
  }
  const members = Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .map(
      ([key, item]) =>
        `${inner}${JSON.stringify(key)}: ${indented(item, depth + 1, inner)}`,
    );
  return members.length === 0 ? "{}" : `{\n${members.join(",\n")}\n${indent}}`;
}

/** project.json: indented, one value per line, so files read and diff well. */
export function projectFileText(document: ProjectFile) {
  return `${indented(document, 0, "")}\n`;
}

export function projectFileName(slug: string) {
  return `${slug}.project.zip`;
}
