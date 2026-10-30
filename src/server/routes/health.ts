import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { HealthResponse } from "../../shared/health";
import type { Db } from "../db/client";
import { appMeta } from "../db/schema";

export function healthRoutes(db: Db, version: string) {
  return new Hono().get("/health", (c) => {
    const createdAt = db
      .select({ value: appMeta.value })
      .from(appMeta)
      .where(eq(appMeta.key, "created_at"))
      .get();

    return c.json({
      status: "ok",
      version,
      dataCreatedAt: createdAt?.value ?? "",
    } satisfies HealthResponse);
  });
}
