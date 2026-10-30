import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  version: z.string(),
  // When this data directory was first initialized. Stays the same across
  // restarts and upgrades as long as the data volume is kept.
  dataCreatedAt: z.iso.datetime(),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
