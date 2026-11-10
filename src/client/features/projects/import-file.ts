/** How a chosen file is sent to the import: as a project file, or an OpenAPI document. */
export type ImportFileType = {
  contentType: "application/zip" | "application/json" | "application/yaml";
  openapi: boolean;
};

/**
 * What a file is, by its name, else by its first bytes: a zip starts with
 * "PK", JSON with "{"; anything else is read as YAML, which JSON is too.
 * Browsers' own types for YAML files vary, or are missing.
 */
export async function importFileType(
  file: Blob & { name: string },
): Promise<ImportFileType> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip"))
    return { contentType: "application/zip", openapi: false };
  if (name.endsWith(".json"))
    return { contentType: "application/json", openapi: true };
  if (name.endsWith(".yaml") || name.endsWith(".yml")) {
    return { contentType: "application/yaml", openapi: true };
  }
  const head = new Uint8Array(await file.slice(0, 1024).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) {
    return { contentType: "application/zip", openapi: false };
  }
  const text = new TextDecoder().decode(head).replace(/^﻿/, "").trimStart();
  return text.startsWith("{")
    ? { contentType: "application/json", openapi: true }
    : { contentType: "application/yaml", openapi: true };
}
