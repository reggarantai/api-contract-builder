import { z } from "zod";
import { apiIssueSchema } from "./api-error";
import { projectSchema } from "./projects";

/** What importing a project file answers with. */
export const projectImportResultSchema = z.object({
  project: projectSchema,
  /** What the import changed to fit this instance, like a slug that was taken. */
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
