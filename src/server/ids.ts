import { monotonicFactory } from "ulid";

/**
 * A new ID: a ULID, larger than every ID made before it, even within the
 * same millisecond. So sorting IDs gives the order things were made in,
 * which is how project files list their parts.
 */
export const newId = monotonicFactory();
