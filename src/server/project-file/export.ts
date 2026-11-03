import { strToU8, Zip, ZipDeflate, ZipPassThrough } from "fflate";
import { formatSize } from "../../shared/format-size";
import type { Mockup } from "../../shared/pages";
import type { ProjectFileReport } from "../../shared/project-file";
import type { ExportInput } from "../export/openapi";
import {
  buildProjectFile,
  type ProjectFileImage,
  projectFileText,
} from "./build";
import { MAX_PROJECT_JSON_BYTES, MAX_ZIP_ENTRIES } from "./format";
import type { ImportLimits } from "./import";
import { checkJsonText } from "./json-text";
import { validateProjectFile } from "./validate";

/** Zips without ZIP64, as fflate writes them, keep offsets under 4 GB. */
export const MAX_PROJECT_FILE_BYTES = 0xffffffff - 64 * 1024 * 1024;

/**
 * The time zip entries say they were changed: the project's last change, so
 * the same server exports an unchanged project as the same bytes. Zip times
 * have no time zone, and fflate writes local time, so the UTC fields are
 * passed as local ones: servers in other zones write the same time, except
 * for an instant that a daylight-saving change skips there.
 */
function zipTime(changed: Date) {
  return new Date(
    changed.getUTCFullYear(),
    changed.getUTCMonth(),
    changed.getUTCDate(),
    changed.getUTCHours(),
    changed.getUTCMinutes(),
    changed.getUTCSeconds(),
  );
}

/**
 * The project file as a stream: project.json, deflated, then the images,
 * stored (they're compressed already), read one at a time so a large
 * project never sits in memory.
 */
export function projectFileZip({
  folder,
  json,
  files,
  readFile,
  changed,
}: {
  /** The folder everything is in, so unzipping doesn't scatter files. */
  folder: string;
  json: string;
  files: ProjectFileImage[];
  readFile: (file: ProjectFileImage) => Uint8Array | undefined;
  changed: Date;
}) {
  const mtime = zipTime(changed);
  const pending = [...files];
  let zip: Zip;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      zip = new Zip((error, chunk, final) => {
        if (error) {
          controller.error(error);
          return;
        }
        controller.enqueue(chunk);
        if (final) {
          controller.close();
        }
      });
      const entry = new ZipDeflate(`${folder}/project.json`, { level: 6 });
      entry.mtime = mtime;
      zip.add(entry);
      entry.push(strToU8(json), true);
    },
    pull(controller) {
      const file = pending.shift();
      if (!file) {
        zip.end();
        return;
      }
      const data = readFile(file);
      if (!data) {
        controller.error(
          new Error(`${file.path} went missing during the export`),
        );
        return;
      }
      const entry = new ZipPassThrough(`${folder}/${file.path}`);
      entry.mtime = mtime;
      zip.add(entry);
      entry.push(data, true);
    },
  });
}

/**
 * What the Export tab shows about the project file: about how big it is,
 * what it leaves out, and what would stop this instance importing it.
 */
export function projectFileReport(
  input: ExportInput,
  {
    generator,
    appVersion,
    sizeOf,
    limits,
  }: {
    generator: string;
    appVersion: string;
    sizeOf: (mockup: Mockup) => number | undefined;
    limits: ImportLimits;
  },
): ProjectFileReport {
  const { document, files, missing } = buildProjectFile(input, {
    generator,
    sizeOf,
  });
  const json = projectFileText(document);
  const jsonBytes = Buffer.byteLength(json);
  const size = files.reduce((total, file) => total + file.size, jsonBytes);
  const pageNames = new Map(input.pages.map((page) => [page.id, page.name]));
  const issues: string[] = [];

  const entries = files.length + 1;
  if (entries > MAX_ZIP_ENTRIES) {
    issues.push(
      `The file would hold ${entries.toLocaleString("en-US")} files, more than an import reads (${MAX_ZIP_ENTRIES.toLocaleString("en-US")})`,
    );
  }
  if (size > MAX_PROJECT_FILE_BYTES) {
    issues.push(
      `The file would hold ${formatSize(size)}, more than a project file can (4 GB), so it can't be downloaded`,
    );
  }
  if (missing.length > 0) {
    const one = missing.length === 1;
    issues.push(
      `${missing.length} mockup${one ? " has" : "s have"} no image file in the data directory, so the file leaves ${one ? "it" : "them"} out: ${missing.map((item) => `${item.page} › ${item.mockup}`).join(", ")}`,
    );
  }
  if (size > limits.maxImportBytes) {
    issues.push(
      `The file holds about ${formatSize(size)}, more than this instance imports (${formatSize(limits.maxImportBytes)}, MAX_IMPORT_MB). Where you import it, start the app with MAX_IMPORT_MB set higher.`,
    );
  }
  if (jsonBytes > MAX_PROJECT_JSON_BYTES) {
    issues.push(
      `Its project.json would be ${formatSize(jsonBytes)}, more than a project file can hold (${formatSize(MAX_PROJECT_JSON_BYTES)})`,
    );
  }
  for (const file of files) {
    if (file.size > limits.maxUploadBytes) {
      issues.push(
        `${pageNames.get(file.mockup.pageId) ?? "A page"} › ${file.mockup.originalName} is ${formatSize(file.size)}, more than this instance takes as a mockup (${formatSize(limits.maxUploadBytes)}, MAX_UPLOAD_MB)`,
      );
    }
  }
  // As an import reads it: the text first, then the rules.
  const text = checkJsonText(json);
  if (text) {
    issues.push(
      `Its project.json can't be imported: ${text.message} (line ${text.line}, column ${text.column})`,
    );
  } else {
    const checked = validateProjectFile(JSON.parse(json), { appVersion });
    if ("error" in checked) {
      issues.push(
        checked.error,
        ...checked.issues.map((issue) => `${issue.path}: ${issue.message}`),
      );
    }
  }
  return { size, issues };
}
