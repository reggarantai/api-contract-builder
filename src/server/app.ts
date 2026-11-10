import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../shared/api-error";
import { MAX_NESTING } from "../shared/json-schema";
import type { Db } from "./db/client";
import { endpointRoutes } from "./routes/endpoints";
import { errorTypeRoutes } from "./routes/error-types";
import { exportRoutes } from "./routes/export";
import { healthRoutes } from "./routes/health";
import { modelRoutes } from "./routes/models";
import { pageRoutes } from "./routes/pages";
import { projectFileRoutes } from "./routes/project-files";
import { projectRoutes } from "./routes/projects";
import { sampleRoutes } from "./routes/samples";
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
  /** Largest project file accepted, and the most one may unpack to. */
  maxImportBytes: number;
  /** Where imports are kept while they're read. */
  tmpDir: string;
  /** Assets of the sample project (mockup images). */
  samplesDir: string;
  /** How long an OpenAPI document may take to arrive. */
  openApiBodyTimeoutMs?: number;
};

export function createApp({
  db,
  version,
  clientDir,
  uploadsDir,
  maxUploadBytes,
  maxImportBytes,
  tmpDir,
  samplesDir,
  openApiBodyTimeoutMs,
}: AppOptions) {
  const app = new Hono();
  const storage = createUploadStorage(uploadsDir);

  app.route("/api", healthRoutes(db, version, maxImportBytes));
  app.route("/api/projects", projectRoutes(db, storage));
  app.route("/api/projects", modelRoutes(db));
  app.route("/api/projects", endpointRoutes(db));
  app.route("/api/projects", errorTypeRoutes(db));
  app.route("/api/projects", pageRoutes(db, storage, maxUploadBytes));
  app.route("/api/projects", exportRoutes(db, storage));
  app.route(
    "/api/projects",
    projectFileRoutes(db, storage, {
      version,
      maxImportBytes,
      maxUploadBytes,
      tmpDir,
      openApiBodyTimeoutMs,
    }),
  );
  app.route(
    "/api/samples",
    sampleRoutes((url, init) => app.request(url, init), samplesDir),
  );
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
    // Values nested deeper than recursion can follow: the API saves no more
    // than MAX_NESTING levels, but data saved before can be deeper. A reason,
    // not a server error.
    if (error instanceof RangeError && /call stack/i.test(error.message)) {
      return c.json<ApiErrorBody>(
        {
          error: `Something here nests deeper than the app can follow. Schemas and examples may nest at most ${MAX_NESTING} levels.`,
        },
        422,
      );
    }
    return c.json<ApiErrorBody>({ error: "Internal server error" }, 500);
  });

  if (clientDir) {
    app.use("*", serveStatic({ root: clientDir }));
    // Client-side routing: unknown paths get the SPA shell.
    app.get("*", serveStatic({ path: path.join(clientDir, "index.html") }));
  }

  return app;
}
