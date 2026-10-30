import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ApiErrorBody } from "../shared/api-error";
import type { Db } from "./db/client";
import { endpointRoutes } from "./routes/endpoints";
import { healthRoutes } from "./routes/health";
import { modelRoutes } from "./routes/models";
import { projectRoutes } from "./routes/projects";

export type AppOptions = {
  db: Db;
  version: string;
  /** Built SPA directory to serve, or null to serve the API only (dev). */
  clientDir: string | null;
};

export function createApp({ db, version, clientDir }: AppOptions) {
  const app = new Hono();

  app.route("/api", healthRoutes(db, version));
  app.route("/api/projects", projectRoutes(db));
  app.route("/api/projects", modelRoutes(db));
  app.route("/api/projects", endpointRoutes(db));
  app.all("/api/*", (c) => c.json<ApiErrorBody>({ error: "Not found" }, 404));

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
