import type { EndpointFields } from "../../shared/endpoints";
import type { ErrorTypeFields } from "../../shared/error-types";
import type { JsonSchema } from "../../shared/json-schema";
import type { PageFields } from "../../shared/pages";
import type { ProjectSettings } from "../../shared/projects";

// A project file holds one whole project: project.json, and the mockup
// images it names. See "Project files" in docs/ARCHITECTURE.md.

/** What project.json's `format` says. */
export const PROJECT_FILE_FORMAT = "api-contract-builder/project";

/**
 * The format's version. Anything that changes what a file can hold raises
 * it, with an upgrade from the version before in UPGRADES, and files of
 * every older version keep importing (test/fixtures/project-file-v1).
 */
export const PROJECT_FILE_VERSION = 1;

/**
 * project.json unpacks to at most this: a hundred times the sample's, while
 * reading it stays within reasonable memory and time.
 */
export const MAX_PROJECT_JSON_BYTES = 16 * 1024 * 1024;

/** Entries in a project file's zip, folders and __MACOSX files included. */
export const MAX_ZIP_ENTRIES = 10_000;

/** IDs in the file tie its parts together; they're the instance's IDs on export. */
type Keyed<T> = { id: string } & T;

export type ProjectFileMockup = {
  id: string;
  /** Where the image is in the zip, from project.json's folder. */
  file: string;
  originalName: string;
  caption: string;
};

export type ProjectFilePage = Keyed<
  Omit<PageFields, "states"> & {
    mockups: ProjectFileMockup[];
    states: PageFields["states"];
  }
>;

export type ProjectFile = {
  $schema?: string;
  format: typeof PROJECT_FILE_FORMAT;
  formatVersion: number;
  /** The app that wrote the file, like "API Contract Builder 0.4.0". */
  generator?: string;
  project: Keyed<ProjectSettings>;
  models: Keyed<{ name: string; description: string; schema: JsonSchema }>[];
  errorTypes: Keyed<ErrorTypeFields>[];
  endpoints: Keyed<EndpointFields>[];
  pages: ProjectFilePage[];
};

/**
 * Turns a document of one format version into the next one. It reads a file
 * from outside, not yet checked: an odd one may make it throw, which refuses
 * the file.
 */
export type Upgrade = (
  document: Record<string, unknown>,
) => Record<string, unknown>;

/** One per older version: UPGRADES[1] turns format 1 into format 2. */
export const UPGRADES: Readonly<Record<number, Upgrade>> = {};

/** The document upgraded from version `from` to the current one, one step at a time. */
export function upgradeDocument(
  document: Record<string, unknown>,
  from: number,
  {
    current = PROJECT_FILE_VERSION,
    upgrades = UPGRADES,
  }: { current?: number; upgrades?: Readonly<Record<number, Upgrade>> } = {},
) {
  let upgraded = document;
  for (let version = from; version < current; version++) {
    const upgrade = upgrades[version];
    if (!upgrade) {
      throw new Error(
        `No upgrade from project file format ${version} to ${version + 1}`,
      );
    }
    upgraded = { ...upgrade(upgraded), formatVersion: version + 1 };
  }
  return upgraded;
}
