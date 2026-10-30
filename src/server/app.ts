import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../shared/api-error";
import type { Db } from "./db/client";
import { endpointRoutes } from "./routes/endpoints";
import { healthRoutes } from "./routes/health";
import { modelRoutes } from "./routes/models";
import { pageRoutes } from "./routes/pages";
import { projectRoutes } from "./routes/projects";
import { createUploadStorage } from "./storage/uploads";

export type AppOptions = {
  db: Db;
  version: string;
  /** Built SPA directory to serve, or null to serve the API only (dev). */
  clientDir: string | null;
  /** Where uploaded mockups are stored. */
  uploadsDir: string;
  /** Largest mockup file accepted. */
  maxUploadBytes: number;
};

export function createApp({
  db,
  version,
  clientDir,
  uploadsDir,
  maxUploadBytes,
}: AppOptions) {
  const app = new Hono();
  const storage = createUploadStorage(uploadsDir);

  app.route("/api", healthRoutes(db, version));
  app.route("/api/projects", projectRoutes(db, storage));
  app.route("/api/projects", modelRoutes(db));
  app.route("/api/projects", endpointRoutes(db));
  app.route("/api/projects", pageRoutes(db, storage, maxUploadBytes));
  app.all("/api/*", (c) => c.json<ApiErrorBody>({ error: "Not found" }, 404));

  // Uploaded files never change (their names are new IDs), so cache them for
  // good. (serveStatic's onFound runs after the response exists, too late to
  // add headers, so they're set here.)
  app.use(
    "/uploads/*",
    async (c, next) => {
      await next();
      if (c.res.ok) {
        c.res.headers.set(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
        c.res.headers.set("X-Content-Type-Options", "nosniff");
      }
    },
    serveStatic({
      root: uploadsDir,
      rewriteRequestPath: (requestPath) =>
        requestPath.replace(/^\/uploads/, ""),
    }),
  );
  app.all("/uploads/*", (c) =>
    c.json<ApiErrorBody>({ error: "Not found" }, 404),
  );

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json<ApiErrorBody>({ error: error.message }, error.status);
    }
    console.error(error);
    return c.json<ApiErrorBody>({ error: "Internal server error" }, 500);
  });

  if (clientDir) {
    app.use("*", serveStatic({ root: clientDir }));
    // Client-side routing: unknown paths get the SPA shell.
    app.get("*", serveStatic({ path: path.join(clientDir, "index.html") }));
  }

  return app;
}
