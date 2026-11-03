import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTempDir } from "../test-utils";
import { createUploadStorage } from "./uploads";

function crossDevice(): never {
  throw Object.assign(new Error("EXDEV: cross-device link not permitted"), {
    code: "EXDEV",
  });
}

describe("moving a project's files in", () => {
  const temp = createTempDir("uploads");
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(temp.dir, { recursive: true, force: true });
  });

  function staged() {
    const folder = path.join(temp.dir, "tmp", "import-1");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "a.png"), "a");
    fs.writeFileSync(path.join(folder, "b.png"), "b");
    return folder;
  }

  it("copies across file systems, as when uploads is mounted apart", () => {
    const storage = createUploadStorage(path.join(temp.dir, "uploads"));
    const folder = staged();
    vi.spyOn(fs, "renameSync").mockImplementationOnce(crossDevice);

    storage.adoptProject("p1", folder);

    expect(fs.readdirSync(path.join(temp.dir, "uploads", "p1")).sort()).toEqual(
      ["a.png", "b.png"],
    );
    expect(fs.existsSync(folder)).toBe(false);
  });

  it("never copies over a folder that's already there", () => {
    const storage = createUploadStorage(path.join(temp.dir, "uploads"));
    const folder = staged();
    fs.mkdirSync(path.join(temp.dir, "uploads", "p1", "kept"), {
      recursive: true,
    });
    vi.spyOn(fs, "renameSync").mockImplementationOnce(crossDevice);

    expect(() => storage.adoptProject("p1", folder)).toThrow(/EXDEV/);
    expect(fs.readdirSync(path.join(temp.dir, "uploads", "p1"))).toEqual([
      "kept",
    ]);
  });

  it("leaves nothing in uploads when the copy fails", () => {
    const storage = createUploadStorage(path.join(temp.dir, "uploads"));
    const folder = staged();
    vi.spyOn(fs, "renameSync").mockImplementationOnce(crossDevice);
    vi.spyOn(fs, "cpSync").mockImplementationOnce((_from, to) => {
      fs.mkdirSync(String(to), { recursive: true });
      fs.writeFileSync(path.join(String(to), "a.png"), "a");
      throw new Error("ENOSPC: no space left on device");
    });

    expect(() => storage.adoptProject("p1", folder)).toThrow(/ENOSPC/);
    expect(fs.existsSync(path.join(temp.dir, "uploads", "p1"))).toBe(false);
  });
});
