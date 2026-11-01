import { z } from "zod";

export const apiIssueSchema = z.object({
  /** Dot-separated path of the invalid field, e.g. "servers.0.url". */
  path: z.string(),
  message: z.string(),
});

export const apiErrorSchema = z.object({
  error: z.string(),
  issues: z.array(apiIssueSchema).optional(),
  /** Page states that come from what a refused change would remove. */
  pageStates: z
    .array(
      z.object({
        pageId: z.string(),
        pageName: z.string(),
        stateId: z.string(),
        stateName: z.string(),
      }),
    )
    .optional(),
  /** The current revision, when a save was based on an older one. */
  revision: z.number().int().optional(),
});

export type ApiIssue = z.infer<typeof apiIssueSchema>;
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;
