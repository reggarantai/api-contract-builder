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

  it("rejects an invalid port", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
  });
});
