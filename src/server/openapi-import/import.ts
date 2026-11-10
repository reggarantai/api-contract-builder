import type { ApiIssue } from "../../shared/api-error";
import {
  type ImportContext,
  type ImportResult,
  writeImport,
} from "../project-file/import";
import { validateProjectFile } from "../project-file/validate";
import { convertOpenApi } from "./convert";
import { exportOverLimit, exportTooLarge } from "./exports";
import { counted, listed } from "./notices";
import { OPENAPI_LIMITS, readOpenApiText, type TextFormat } from "./read";

// Importing an OpenAPI document: read the text, make a project file document
// of it, check that with the rules every project file passes, and write it
// with the project file import's writer, in one transaction.

/** Notices of numbers a double changes, as one. */
function numberNotice(notices: ApiIssue[]): ApiIssue[] {
  const [first] = notices;
  if (!first) return [];
  const places = notices.map((notice) => notice.path);
  return [
    {
      path: first.path,
      message: `${first.message}, as JSON tools read numbers (I-JSON)${notices.length > 1 ? `; ${counted(notices.length - 1, "more integer")} too, at ${listed(places.slice(1, 3), places.length - 1)}` : ""}`,
    },
  ];
}

/** An import that waits for others would wait too long: try later. */
export type BusyResult = { busy: true; error: string; issues: ApiIssue[] };

/** A place in line; give it back if the import doesn't happen. */
export type ImportTurn = {
  run<T>(task: () => Promise<T>): Promise<T>;
  release(): void;
};

/**
 * An instance's OpenAPI imports run one at a time, reading to writing: each
 * can take much of the server's memory (a YAML worker as much heap as the
 * server has). Three more wait, each holding its document (16 MB at most);
 * past that, an import answers busy. A turn is taken before the document
 * is received, so one turned away holds nothing.
 */
export class ImportLine {
  static readonly MAX_TURNS = 4;
  private last: Promise<unknown> = Promise.resolve();
  private turns = 0;

  /** A turn to import, or undefined while one import runs and three wait. */
  take(): ImportTurn | undefined {
    if (this.turns >= ImportLine.MAX_TURNS) return undefined;
    this.turns++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.turns--;
      }
    };
    return {
      release,
      run: (task) => {
        const run = this.last.then(task, task);
        // Waits for it, without keeping what it made.
        this.last = run.then(
          () => undefined,
          () => undefined,
        );
        return run.finally(release);
      },
    };
  }
}

export const BUSY_MESSAGE =
  "Other imports are running and waiting. Try again in a moment.";

/** Where imports wait when no instance's line is given (direct callers). */
const ownLine = new ImportLine();

export async function importOpenApi(
  context: ImportContext,
  bytes: Uint8Array,
  format: TextFormat,
  turn = ownLine.take(),
): Promise<ImportResult | BusyResult> {
  if (!turn) {
    return { busy: true, error: BUSY_MESSAGE, issues: [] };
  }
  return turn.run(() => importNow(context, bytes, format));
}

async function importNow(
  context: ImportContext,
  bytes: Uint8Array,
  format: TextFormat,
): Promise<ImportResult> {
  // "PK", then a local file header or an empty archive's end record.
  if (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05)
  ) {
    return {
      error:
        "This file is a zip file. Send a project file (.project.zip) as application/zip.",
      issues: [],
    };
  }
  const read = await readOpenApiText(bytes, format);
  if ("error" in read) {
    return { error: read.error, issues: read.issues };
  }
  const converted = convertOpenApi(read.value, { sourceText: read.sourceText });
  if ("error" in converted) {
    return converted;
  }
  const checked = validateProjectFile(converted.document, {
    appVersion: context.appVersion,
  });
  if ("error" in checked) {
    // Only a gap in the converter gets here: it repairs what the rules refuse.
    return {
      error: `This OpenAPI document can't be imported: the project it makes breaks ${counted(checked.issues.length, "rule")} of the app. Please report it, with the document if you can share it.`,
      issues: checked.issues.map((issue) => ({
        path: converted.sourceOf(issue.path),
        message: issue.message,
      })),
    };
  }
  // A project this instance couldn't export would stop it on the Export tab.
  let over: ReturnType<typeof exportOverLimit>;
  try {
    over = exportOverLimit(checked.document, {
      openApiLimit: OPENAPI_LIMITS.maxExportText,
      markdownLimit: OPENAPI_LIMITS.maxText,
    });
  } catch (error) {
    // A mistake in the app, not in the document: refused, with what to report.
    console.error("Measuring an OpenAPI import's exports failed:", error);
    return {
      error:
        "The app couldn't check what this document's project would export. This is a problem in the app: please report it, with the document if you can share it.",
      issues: [],
    };
  }
  if (over) {
    return { error: exportTooLarge(over), issues: [] };
  }
  const written = writeImport(context, checked.document, new Map(), {
    slugPath: "/info/title",
  });
  if ("error" in written) {
    return written;
  }
  return {
    project: written.project,
    notices: [
      ...numberNotice(read.notices),
      ...converted.notices,
      ...written.notices,
    ],
  };
}
