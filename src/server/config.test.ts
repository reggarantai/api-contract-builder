import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./config";

describe("loadConfig", () => {
  it("uses local-only defaults", () => {
    const config = loadConfig({});

    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(3000);
    expect(config.dataDir).toBe(path.resolve("data"));
    expect(config.databasePath).toBe(path.resolve("data", "app.db"));
    expect(config.uploadsDir).toBe(path.resolve("data", "uploads"));
    expect(config.maxUploadBytes).toBe(10 * 1024 * 1024);
  });

  it("reads overrides from the environment", () => {
    const config = loadConfig({
      HOST: "0.0.0.0",
      PORT: "8080",
      DATA_DIR: "/data",
      MAX_UPLOAD_MB: "2",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(8080);
    expect(config.databasePath).toBe(path.join("/data", "app.db"));
    expect(config.maxUploadBytes).toBe(2 * 1024 * 1024);
  });

  it("imports project files up to 1 GB, through a folder in the data directory", () => {
    const config = loadConfig({});

    expect(config.maxImportBytes).toBe(1024 * 1024 * 1024);
    expect(config.tmpDir).toBe(path.resolve("data", "tmp"));
    expect(loadConfig({ MAX_IMPORT_MB: "50" }).maxImportBytes).toBe(
      50 * 1024 * 1024,
    );
  });

  it("rejects an import limit it can't serve", () => {
    expect(() => loadConfig({ MAX_IMPORT_MB: "0" })).toThrow(/MAX_IMPORT_MB/);
    expect(() => loadConfig({ MAX_IMPORT_MB: "5000" })).toThrow(
      /MAX_IMPORT_MB/,
    );
  });

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
