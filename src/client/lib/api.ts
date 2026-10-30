import type { z } from "zod";

export async function apiGet<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T>> {
  const response = await fetch(`/api${path}`);
  if (!response.ok) {
    throw new Error(`GET /api${path} failed with status ${response.status}`);
  }
  return schema.parse(await response.json());
}
