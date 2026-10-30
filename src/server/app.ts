import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { Db } from "./db/client";
import { healthRoutes } from "./routes/health";

export type AppOptions = {
  db: Db;
  version: string;
  /** Built SPA directory to serve, or null to serve the API only (dev). */
  clientDir: string | null;
};

export function createApp({ db, version, clientDir }: AppOptions) {
  const app = new Hono();

  app.route("/api", healthRoutes(db, version));
  app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

  if (clientDir) {
    app.use("*", serveStatic({ root: clientDir }));
    // Client-side routing: unknown paths get the SPA shell.
    app.get("*", serveStatic({ path: path.join(clientDir, "index.html") }));
  }

  return app;
}
