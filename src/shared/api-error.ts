import { z } from "zod";

export const apiIssueSchema = z.object({
  /** Dot-separated path of the invalid field, e.g. "servers.0.url". */
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(apiIssueSchema).optional(),
});

export type ApiIssue = z.infer<typeof apiIssueSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
