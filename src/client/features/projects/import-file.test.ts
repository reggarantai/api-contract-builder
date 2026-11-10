import { describe, expect, it } from "vitest";
import { importFileType } from "./import-file";

const file = (name: string, content: string | Uint8Array<ArrayBuffer>) =>
  new File([content], name);

describe("what a chosen file is sent as", () => {
  it("goes by the name when it says", async () => {
    expect(await importFileType(file("shop.project.zip", "x"))).toEqual({
      contentType: "application/zip",
      openapi: false,
    });
    expect(await importFileType(file("API.JSON", "x"))).toEqual({
      contentType: "application/json",
      openapi: true,
    });
    expect(await importFileType(file("openapi.yaml", "{}"))).toEqual({
      contentType: "application/yaml",
      openapi: true,
    });
    expect(await importFileType(file("openapi.yml", "{}"))).toEqual({
      contentType: "application/yaml",
      openapi: true,
    });
  });

  it("goes by the first bytes otherwise: a zip, JSON, or else YAML", async () => {
    expect(
      await importFileType(
        file("backup", new Uint8Array([0x50, 0x4b, 0x03, 0x04])),
      ),
    ).toEqual({ contentType: "application/zip", openapi: false });
    expect(
      await importFileType(file("spec", '﻿ \n {"openapi": "3.1.0"}')),
    ).toEqual({ contentType: "application/json", openapi: true });
    expect(await importFileType(file("notes.txt", "openapi: 3.1.0\n"))).toEqual(
      { contentType: "application/yaml", openapi: true },
    );
    expect(await importFileType(file("empty", ""))).toEqual({
      contentType: "application/yaml",
      openapi: true,
    });
  });
});
