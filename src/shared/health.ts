import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  // When this data directory was first initialized. Stays the same across
  // restarts and upgrades as long as the data volume is kept.
  dataCreatedAt: z.iso.datetime(),
  /** The largest project file this instance imports (MAX_IMPORT_MB). */
  maxImportBytes: z.number().int(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
