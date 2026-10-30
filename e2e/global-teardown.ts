import fs from "node:fs";

export default function globalTeardown() {
  const dataDir = process.env.E2E_DATA_DIR;
  if (dataDir) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}
