import { serve } from "@hono/node-server";
import pkg from "../../package.json" with { type: "json" };
import { createApp } from "./app";
import { loadConfig } from "./config";
import { openDatabase } from "./db/client";

const config = loadConfig();
const database = openDatabase(config.databasePath, config.migrationsDir);
const app = createApp({
  db: database.db,
  version: pkg.version,
  clientDir: config.clientDir,
});

const server = serve(
  { fetch: app.fetch, hostname: config.host, port: config.port },
  (info) => {
    console.log(
      `API Contract Builder ${pkg.version} listening on http://${info.address}:${info.port}`,
    );
    console.log(`Data directory: ${config.dataDir}`);
    if (!config.clientDir) {
      console.log("Client build not found; serving the API only.");
    }
  },
);

function shutdown() {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
