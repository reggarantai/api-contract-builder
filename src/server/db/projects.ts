import { eq } from "drizzle-orm";
import type { Db } from "./client";
import { projects } from "./schema";

export function findProject(db: Db, id: string) {
  return db.select().from(projects).where(eq(projects.id, id)).get();
}

/** Marks the project as changed, e.g. when one of its models changes. */
export function touchProject(db: Db, id: string, now = new Date()) {
  db.update(projects).set({ updatedAt: now }).where(eq(projects.id, id)).run();
}
