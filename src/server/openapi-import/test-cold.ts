import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Runs a script in a new Node process with a small heap, as a small
// container runs the server: what a limit protects is checked there, cold,
// rather than in a test process with gigabytes of heap and warm code.

/** The URL of one of the app's modules, for a script to import. */
export function moduleUrl(file: string) {
  return JSON.stringify(pathToFileURL(path.resolve(file)).href);
}

export function runCold(
  script: string,
  { heapMb, flags = [] }: { heapMb: number; flags?: string[] },
) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acb-cold-"));
  const file = path.join(dir, "script.mts");
  fs.writeFileSync(file, script);
  try {
    const run = spawnSync(
      process.execPath,
      [`--max-old-space-size=${heapMb}`, ...flags, "--import", "tsx", file],
      { encoding: "utf8", timeout: 120_000 },
    );
    return {
      status: run.status,
      output: `${run.stdout ?? ""}${run.stderr ?? ""}`.trim(),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
