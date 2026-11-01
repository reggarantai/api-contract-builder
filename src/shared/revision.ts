import { z } from "zod";

/**
 * The revision a save's changes start from. Editors send it, so a save based
 * on an older revision is refused instead of overwriting a newer one made in
 * another tab or window; clients that leave it out save as before.
 */
export const revisionInputSchema = z.number().int().min(0).optional();

/** Counts saves; a save can name the one it started from. */
export const revisionSchema = z.number().int().min(0);
