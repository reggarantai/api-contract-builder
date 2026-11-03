import { describe, expect, it } from "vitest";
import { endpointFieldsSchema } from "../../shared/endpoints";
import {
  type Mockup,
  mockupSchema,
  pageFieldsSchema,
} from "../../shared/pages";
import {
  testEndpoint,
  testErrorType,
  testInput,
  testModel,
  testPage,
  testProject,
} from "../export/test-input";
import { buildProjectFile, projectFileName, projectFileText } from "./build";
import { PROJECT_FILE_FORMAT, PROJECT_FILE_VERSION } from "./format";

function mockup(id: string, pageId: string, extension = "png"): Mockup {
  return {
    id,
    pageId,
    url: `/uploads/p1/${id}.${extension}`,
    originalName: `Screen ${id}.${extension}`,
    mimeType: extension === "jpg" ? "image/jpeg" : "image/png",
    width: 3,
    height: 2,
    caption: `Caption ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const login = testEndpoint("e1", "POST", "/auth/login");
const input = testInput({
  project: testProject({
    servers: [{ id: "prod", name: "Production", url: "/v1", description: "" }],
    securitySchemes: [
      {
        id: "bearer",
        key: "bearerAuth",
        type: "bearer",
        bearerFormat: "",
        description: "",
      },
    ],
    defaultSecuritySchemeId: "bearer",
    revision: 7,
  }),
  models: [testModel("m1", "User", { type: "object", properties: {} })],
  errorTypes: [testErrorType("t1", "not-found", "404")],
  endpoints: [login],
  pages: [
    testPage(
      "g1",
      "Login",
      [{ endpointId: "e1", trigger: "on_submit", note: "" }],
      {
        mockups: [mockup("k1", "g1"), mockup("k2", "g1", "jpg")],
        states: [
          {
            id: "s1",
            kind: "idle",
            name: "Form",
            description: "",
            causes: [],
            mockupIds: ["k1", "k2"],
          },
        ],
      },
    ),
  ],
});

const sizes = new Map([
  ["k1", 10],
  ["k2", 20],
]);
const build = (sizeOf = (item: Mockup) => sizes.get(item.id)) =>
  buildProjectFile(input, { generator: "API Contract Builder 1.2.3", sizeOf });

describe("building a project file", () => {
  it("starts with what the file is, then the project's parts", () => {
    const { document } = build();

    expect(Object.keys(document)).toEqual([
      "format",
      "formatVersion",
      "generator",
      "project",
      "models",
      "errorTypes",
      "endpoints",
      "pages",
    ]);
    expect(document.format).toBe(PROJECT_FILE_FORMAT);
    expect(document.formatVersion).toBe(PROJECT_FILE_VERSION);
    expect(document.generator).toBe("API Contract Builder 1.2.3");
  });

  it("keeps what the API saves, with IDs that references use", () => {
    const { document } = build();

    expect(Object.keys(document.project)).toEqual([
      "id",
      "name",
      "slug",
      "description",
      "apiVersion",
      "servers",
      "securitySchemes",
      "defaultSecuritySchemeId",
    ]);
    expect(Object.keys(document.models[0] ?? {})).toEqual([
      "id",
      "name",
      "description",
      "schema",
    ]);
    expect(Object.keys(document.errorTypes[0] ?? {})).toEqual([
      "id",
      "name",
      "status",
      "title",
      "description",
      "headers",
      "body",
    ]);
    // Derived from the shared rules, so a new endpoint field is exported too.
    expect(Object.keys(document.endpoints[0] ?? {})).toEqual([
      "id",
      ...Object.keys(endpointFieldsSchema.shape),
    ]);
    // Mockups go just before states, where a reader looks for them.
    expect(Object.keys(document.pages[0] ?? {})).toEqual([
      "id",
      ...Object.keys(pageFieldsSchema.shape).filter((key) => key !== "states"),
      "mockups",
      "states",
    ]);
    expect(document.pages[0]?.mockups[0]).toEqual({
      id: "k1",
      file: "mockups/k1.png",
      originalName: "Screen k1.png",
      caption: "Caption k1",
    });
    expect(document.endpoints[0]?.responses).toEqual(login.responses);
  });

  it("orders models, error types, and endpoints by ID, so renames and moves stay in place", () => {
    const { document } = buildProjectFile(
      testInput({
        models: [
          testModel("m2", "Alpha", { type: "object" }),
          testModel("m1", "Beta", { type: "object" }),
        ],
        errorTypes: [
          testErrorType("t2", "a-error", "400"),
          testErrorType("t1", "b-error", "500"),
        ],
        endpoints: [
          testEndpoint("e2", "GET", "/a"),
          testEndpoint("e1", "GET", "/b"),
        ],
      }),
      { generator: "x", sizeOf: () => 1 },
    );
    expect(document.models.map((model) => model.id)).toEqual(["m1", "m2"]);
    expect(document.errorTypes.map((item) => item.id)).toEqual(["t1", "t2"]);
    expect(document.endpoints.map((item) => item.id)).toEqual(["e1", "e2"]);
  });

  it("keeps each mockup field that its image or this instance doesn't give", () => {
    // A field added to mockups fails here until it's kept or derived.
    const kept = ["id", "originalName", "caption"];
    const derived = [
      "pageId",
      "url",
      "mimeType",
      "width",
      "height",
      "createdAt",
    ];
    expect(Object.keys(mockupSchema.shape).sort()).toEqual(
      [...kept, ...derived].sort(),
    );
    expect(
      Object.keys(build().document.pages[0]?.mockups[0] ?? {}).sort(),
    ).toEqual([...kept, "file"].sort());
  });

  it("leaves out revisions, times, and what this instance derives", () => {
    const text = projectFileText(build().document);

    for (const left of [
      "revision",
      "createdAt",
      "updatedAt",
      "projectId",
      "endpointIds",
      "pageId",
      "/uploads/",
      "mimeType",
      "width",
      "pathKey",
    ]) {
      expect(text).not.toContain(left);
    }
  });

  it("lists the image files with their sizes, named by mockup ID", () => {
    expect(build().files).toEqual([
      {
        path: "mockups/k1.png",
        mockup: expect.objectContaining({ id: "k1" }),
        size: 10,
      },
      {
        path: "mockups/k2.jpg",
        mockup: expect.objectContaining({ id: "k2" }),
        size: 20,
      },
    ]);
  });

  it("leaves out mockups without a file, and takes them out of states", () => {
    const { document, files, missing } = build((item) =>
      item.id === "k2" ? undefined : 10,
    );

    expect(document.pages[0]?.mockups.map((item) => item.id)).toEqual(["k1"]);
    expect(document.pages[0]?.states[0]?.mockupIds).toEqual(["k1"]);
    expect(files.map((file) => file.path)).toEqual(["mockups/k1.png"]);
    expect(missing).toEqual([{ page: "Login", mockup: "Screen k2.jpg" }]);
  });

  it("writes indented JSON ending in a newline, the same each time", () => {
    const text = projectFileText(build().document);

    expect(
      text.startsWith('{\n  "format": "api-contract-builder/project",\n'),
    ).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(projectFileText(build().document)).toBe(text);
  });

  it("names the download after the project's slug", () => {
    expect(projectFileName("inventory-app")).toBe("inventory-app.project.zip");
  });

  it("indents 64 levels deep and writes deeper parts on one line, so deep models stay small", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let index = 0; index < 3000; index++) {
      schema = { type: "array", items: schema };
    }
    const { document } = buildProjectFile(
      testInput({ models: [testModel("m1", "Deep", schema as never)] }),
      { generator: "x", sizeOf: () => 1 },
    );
    const text = projectFileText(document);

    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(document)));
    expect(text.length).toBeLessThan(200_000);
    // As JSON.stringify indents them, as far as it goes.
    const shallow = build().document;
    expect(projectFileText(shallow)).toBe(
      `${JSON.stringify(shallow, null, 2)}\n`,
    );
  });
});
