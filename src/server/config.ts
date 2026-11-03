import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const envSchema = z.object({
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATA_DIR: z.string().min(1).default("./data"),
  MAX_UPLOAD_MB: z.coerce.number().positive().max(100).default(10),
  // A project file is read from disk, an entry at a time, so this bounds
  // disk use and time, not memory. Zips without ZIP64, which is what this
  // app writes, stay under 4 GB.
  MAX_IMPORT_MB: z.coerce.number().positive().max(4096).default(1024),
});

export type Config = {
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  /** Uploaded mockups, one folder per project. */
  uploadsDir: string;
  /** Largest mockup file accepted. */
  maxUploadBytes: number;
  /** Largest project file accepted, and the most one may unpack to. */
  maxImportBytes: number;
  /** Where imports are kept while they're read. */
  tmpDir: string;
  /** Assets of the sample project. */
  samplesDir: string;
  migrationsDir: string;
  /** Built SPA directory, or null when the client has not been built. */
  clientDir: string | null;
};

// Paths below are resolved from the working directory, so the server must be
// started from the project root (or /app inside the Docker image).
const MIGRATIONS_DIR = "drizzle";
const CLIENT_DIR = "dist/client";
const SAMPLES_DIR = "samples";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new Error(
      `Invalid environment variables:\n${z.prettifyError(result.error)}`,
    );
  }
  const { HOST, PORT, DATA_DIR, MAX_UPLOAD_MB, MAX_IMPORT_MB } = result.data;
  const dataDir = path.resolve(DATA_DIR);
  const clientDir = path.resolve(CLIENT_DIR);

  return {
    host: HOST,
    port: PORT,
    dataDir,
    databasePath: path.join(dataDir, "app.db"),
    uploadsDir: path.join(dataDir, "uploads"),
    maxUploadBytes: Math.round(MAX_UPLOAD_MB * 1024 * 1024),
    maxImportBytes: Math.round(MAX_IMPORT_MB * 1024 * 1024),
    tmpDir: path.join(dataDir, "tmp"),
    samplesDir: path.resolve(SAMPLES_DIR),
    migrationsDir: path.resolve(MIGRATIONS_DIR),
    clientDir: fs.existsSync(path.join(clientDir, "index.html"))
      ? clientDir
      : null,
  };
}
