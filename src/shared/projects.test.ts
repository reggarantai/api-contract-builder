import { describe, expect, it } from "vitest";
import { type ProjectSettings, projectSettingsSchema } from "./projects";

const base: ProjectSettings = {
  name: "Inventory",
  slug: "inventory",
  description: "",
  apiVersion: "1.0.0",
  servers: [],
  securitySchemes: [],
  defaultSecuritySchemeId: null,
};

function issuePaths(settings: ProjectSettings) {
  const result = projectSettingsSchema.safeParse(settings);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join("."));
}

describe("projectSettingsSchema", () => {
  it("accepts absolute http(s) URLs and relative paths for servers", () => {
    expect(
      issuePaths({
        ...base,
        servers: [
          {
            id: "a",
            name: "Production",
            url: "https://api.example.com",
            description: "",
          },
          { id: "b", name: "Same origin", url: "/api", description: "" },
        ],
      }),
    ).toEqual([]);
  });

  it("rejects other server URLs", () => {
    expect(
      issuePaths({
        ...base,
        servers: [
          { id: "a", name: "FTP", url: "ftp://example.com", description: "" },
        ],
      }),
    ).toEqual(["servers.0.url"]);
  });

  it("requires unique security scheme keys", () => {
    expect(
      issuePaths({
        ...base,
        securitySchemes: [
          { id: "a", key: "auth", type: "basic", description: "" },
          {
            id: "b",
            key: "auth",
            type: "bearer",
            bearerFormat: "JWT",
            description: "",
          },
        ],
      }),
    ).toEqual(["securitySchemes.1.key"]);
  });

  it("requires a parameter name for API key schemes", () => {
    expect(
      issuePaths({
        ...base,
        securitySchemes: [
          {
            id: "a",
            key: "apiKey",
            type: "apiKey",
            in: "header",
            name: " ",
            description: "",
          },
        ],
      }),
    ).toEqual(["securitySchemes.0.name"]);
  });

  it("requires the default scheme to exist", () => {
    const scheme = {
      id: "a",
      key: "auth",
      type: "basic" as const,
      description: "",
    };

    expect(
      issuePaths({
        ...base,
        securitySchemes: [scheme],
        defaultSecuritySchemeId: "a",
      }),
    ).toEqual([]);
    expect(
      issuePaths({
        ...base,
        securitySchemes: [scheme],
        defaultSecuritySchemeId: "missing",
      }),
    ).toEqual(["defaultSecuritySchemeId"]);
  });
});
