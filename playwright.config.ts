import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const PORT = 4100;

// This config is evaluated by the runner and again by every worker. Workers
// inherit the runner's environment, so they all share one throwaway data dir.
process.env.E2E_DATA_DIR ??= fs.mkdtempSync(path.join(os.tmpdir(), "acb-e2e-"));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Runs the production build; `pnpm test:e2e` builds it first.
  webServer: {
    command: "node dist/server/index.js",
    url: `http://127.0.0.1:${PORT}/api/health`,
    env: {
      HOST: "127.0.0.1",
      PORT: String(PORT),
      DATA_DIR: process.env.E2E_DATA_DIR,
    },
    reuseExistingServer: false,
  },
});
