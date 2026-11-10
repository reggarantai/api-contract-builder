import { z } from "zod";
import { apiIssueSchema } from "./api-error";
import { projectSchema } from "./projects";

/**
 * The largest OpenAPI document an import reads. It's read into memory whole,
 * as a project file's project.json is, and has the same limit.
 */
export const MAX_OPENAPI_BYTES = 16 * 1024 * 1024;

/** What importing a project file or an OpenAPI document answers with. */
export const projectImportResultSchema = z.object({
  project: projectSchema,
  /**
   * What the import changed to fit this instance, like a slug that was
   * taken, and what an OpenAPI document had that a project can't hold. Paths
   * are a project file's (project.slug), or JSON Pointers into the OpenAPI
   * document (/paths/~1pets/get).
   */
  notices: z.array(apiIssueSchema),
});

/** What the Export tab shows about the project file before downloading it. */
export const projectFileReportSchema = z.object({
  /** About how many bytes the file holds, unpacked. */
  size: z.number().int().min(0),
  /** What would stop this instance importing it, and what it leaves out. */
  issues: z.array(z.string()),
});

export type ProjectImportResult = z.infer<typeof projectImportResultSchema>;
export type ProjectFileReport = z.infer<typeof projectFileReportSchema>;
