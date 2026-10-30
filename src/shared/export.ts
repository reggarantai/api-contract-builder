import { z } from "zod";

export const EXPORT_FORMATS = ["yaml", "json"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const lintIssueSchema = z.object({
  kind: z.enum(["missing-example", "unused-endpoint", "unused-model"]),
  /** What to open to fix it. */
  target: z.object({ type: z.enum(["endpoint", "model"]), id: z.string() }),
  message: z.string(),
});

/** What the export page shows before downloading. */
export const exportReportSchema = z.object({
  /** False when the export would be invalid; downloading is refused then. */
  valid: z.boolean(),
  errors: z.array(z.string()),
  /** Worth fixing, but they don't block exporting. */
  warnings: z.array(lintIssueSchema),
});

export type LintIssue = z.infer<typeof lintIssueSchema>;
export type ExportReport = z.infer<typeof exportReportSchema>;
