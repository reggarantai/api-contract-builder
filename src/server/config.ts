import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default("./data"),
});

export type Config = {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  migrationsDir: string;
  /** Built SPA directory, or null when the client has not been built. */
  clientDir: string | null;
};

// Paths below are resolved from the working directory, so the server must be
// started from the project root (or /app inside the Docker image).
const MIGRATIONS_DIR = "drizzle";
const CLIENT_DIR = "dist/client";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  const { HOST, PORT, DATA_DIR } = result.data;
  const dataDir = path.resolve(DATA_DIR);
  const clientDir = path.resolve(CLIENT_DIR);

  return {
    host: HOST,
    port: PORT,
    dataDir,
    databasePath: path.join(dataDir, "app.db"),
    migrationsDir: path.resolve(MIGRATIONS_DIR),
    clientDir: fs.existsSync(path.join(clientDir, "index.html"))
      ? clientDir
      : null,
  };
}
