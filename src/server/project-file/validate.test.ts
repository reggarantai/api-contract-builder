import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROJECT_FILE_VERSION, UPGRADES, upgradeDocument } from "./format";
import { validateProjectFile } from "./validate";

const FIXTURE = fs.readFileSync(
  path.resolve("test/fixtures/project-file-v1/project.json"),
  "utf8",
);

// biome-ignore lint/suspicious/noExplicitAny: tests change the document freely.
type Doc = any;
const fixture = (): Doc => JSON.parse(FIXTURE);

function check(document: unknown, appVersion = "1.2.3") {
  return validateProjectFile(document, { appVersion });
}

function failure(document: unknown, appVersion?: string) {
  const result = check(document, appVersion);
  if ("document" in result) {
    throw new Error("Expected the file to be refused");
  }
  return result;
}

function issuesOf(document: unknown) {
  return failure(document).issues;
}

/** The fixture changed by `change`, and the issues it then has. */
function issuesAfter(change: (document: Doc) => void) {
  const document = fixture();
  change(document);
  return issuesOf(document);
}

describe("validating a project file", () => {
  it("accepts the frozen version 1 fixture", () => {
    const result = check(fixture());
    expect("document" in result && result.document.project.name).toBe(
      "Fixture Shop",
    );
  });

  it("trims text the way the API does", () => {
    const document = fixture();
    document.models[0].description = "  Spaces around  ";
    const result = check(document);
    expect("document" in result && result.document.models[0]?.description).toBe(
      "Spaces around",
    );
  });

  describe("what the file is", () => {
    it.each([
      ["a list", []],
      ["text", "project"],
      ["null", null],
    ])("refuses %s", (_, document) => {
      expect(failure(document).error).toMatch(
        /isn't an API Contract Builder project file/,
      );
    });

    it("refuses another format", () => {
      const document = fixture();
      document.format = "postman-collection";
      expect(failure(document).error).toMatch(
        /isn't an API Contract Builder project file/,
      );
      delete document.format;
      expect(failure(document).error).toMatch(
        /isn't an API Contract Builder project file/,
      );
    });

    it.each([["1"], [0], [1.5], [null]])(
      "refuses the format version %j",
      (version) => {
        const document = fixture();
        document.formatVersion = version;
        expect(failure(document).error).toMatch(/formatVersion/);
      },
    );

    it("refuses a file from a newer version, saying which", () => {
      const document = fixture();
      document.formatVersion = 2;
      document.generator = "API Contract Builder 9.0.0";
      document.somethingNew = true;

      const { error, issues } = failure(document);
      expect(error).toBe(
        "This project file is from a newer version of API Contract Builder (format 2, made by API Contract Builder 9.0.0). This version reads format 1 and older: update the app to import it.",
      );
      expect(issues).toEqual([]);
    });

    it("allows a $schema and a generator, and nothing else at the top", () => {
      const document = fixture();
      document.$schema = "https://example.com/project-file.schema.json";
      delete document.generator;
      expect("document" in check(document)).toBe(true);

      document.extra = 1;
      document.generator = 5;
      expect(issuesOf(document)).toEqual([
        { path: "generator", message: expect.stringMatching(/string/) },
        { path: "extra", message: "Not a field of project files" },
      ]);
    });

    it("refuses parts that aren't lists", () => {
      const document = fixture();
      document.models = {};
      delete document.pages;
      expect(issuesOf(document)).toEqual([
        { path: "models", message: expect.stringMatching(/array/) },
        { path: "pages", message: expect.stringMatching(/array/) },
      ]);
    });
  });

  describe("upgrading older formats", () => {
    it("runs each step from the file's version to the current one", () => {
      const steps: string[] = [];
      const upgraded = upgradeDocument({ formatVersion: 1, a: 1 }, 1, {
        current: 3,
        upgrades: {
          1: (document) => {
            steps.push("1 → 2");
            return { ...document, b: 2 };
          },
          2: (document) => {
            steps.push("2 → 3");
            return { ...document, c: 3 };
          },
        },
      });

      expect(steps).toEqual(["1 → 2", "2 → 3"]);
      expect(upgraded).toEqual({ formatVersion: 3, a: 1, b: 2, c: 3 });
    });

    it("has an upgrade from every older version", () => {
      for (let version = 1; version < PROJECT_FILE_VERSION; version++) {
        expect(UPGRADES[version], `format ${version}`).toBeTypeOf("function");
      }
    });

    it("fails loudly when a step is missing", () => {
      expect(() =>
        upgradeDocument({}, 1, { current: 2, upgrades: {} }),
      ).toThrow(/No upgrade from project file format 1/);
    });
  });

  describe("fields the format doesn't have", () => {
    it.each([
      [
        "project.colour",
        "Project settings",
        (d: Doc) => (d.project.colour = "red"),
      ],
      [
        "models.0.revision",
        "Model Category",
        (d: Doc) => (d.models[0].revision = 3),
      ],
      [
        "endpoints.0.responses.0.body.examples.0.note",
        "GET /items",
        (d: Doc) => (d.endpoints[0].responses[0].body.examples[0].note = "x"),
      ],
      [
        "pages.0.states.1.causes.0.extra",
        "Page Items",
        (d: Doc) => (d.pages[0].states[1].causes[0].extra = true),
      ],
      [
        "pages.0.mockups.0.width",
        "Page Items",
        (d: Doc) => (d.pages[0].mockups[0].width = 3),
      ],
      [
        "pages.0.endpoints.0.sortOrder",
        "Page Items",
        (d: Doc) => (d.pages[0].endpoints[0].sortOrder = 0),
      ],
      [
        "errorTypes.0.endpointIds",
        "Error type not-found",
        (d: Doc) => (d.errorTypes[0].endpointIds = []),
      ],
    ])("refuses %s", (field, owner, change) => {
      expect(issuesAfter(change)).toEqual([
        { path: field, message: `${owner}: Not a field of project files` },
      ]);
    });

    it("leaves schemas and example values to the author", () => {
      const document = fixture();
      document.models[0].schema["x-anything"] = { nested: true };
      document.endpoints[0].responses[0].body.examples[0].value = {
        whatever: [1, { revision: 2 }],
      };
      expect("document" in check(document)).toBe(true);
    });
  });

  describe("the API's rules", () => {
    it.each([
      [
        "a duplicate scheme key",
        (d: Doc) => (d.project.securitySchemes[1].key = "bearerAuth"),
        "project.securitySchemes.1.key",
        /Key must be unique/,
      ],
      [
        "a default scheme the project lacks",
        (d: Doc) => (d.project.defaultSecuritySchemeId = "gone"),
        "project.defaultSecuritySchemeId",
        /one of this project's schemes/,
      ],
      [
        "an invalid slug",
        (d: Doc) => (d.project.slug = "Fixture Shop"),
        "project.slug",
        /lowercase/,
      ],
      [
        "an invalid model name",
        (d: Doc) => (d.models[0].name = "Bad name"),
        "models.0.name",
        /^Model Bad name: Use letters/,
      ],
      [
        "model names that differ only in case",
        (d: Doc) => (d.models[1].name = "category"),
        "models.1.name",
        /^Model category: Another model has this name/,
      ],
      [
        "a reference to a missing model",
        (d: Doc) =>
          (d.models[0].schema.properties.featured.$ref = "model:gone"),
        "models.0.schema",
        /^Model Category: References a model that doesn't exist: model:gone/,
      ],
      [
        "a reference by component name",
        (d: Doc) =>
          (d.models[0].schema.properties.featured.$ref =
            "#/components/schemas/Item"),
        "models.0.schema",
        /Unsupported reference "#\/components\/schemas\/Item"/,
      ],
      [
        "an error type with a 2xx status",
        (d: Doc) => (d.errorTypes[0].status = "200"),
        "errorTypes.0.status",
        /^Error type not-found: Use a 4xx or 5xx status code/,
      ],
      [
        "error type names that differ only in case",
        (d: Doc) => (d.errorTypes[1].name = "Not-Found"),
        "errorTypes.1.name",
        /Another error type has this name/,
      ],
      [
        "path parameters that don't match the path",
        (d: Doc) => (d.endpoints[2].path = "/items/{id}"),
        "endpoints.2.parameters.path",
        /^GET \/items\/\{id\}: Path parameters must match the path/,
      ],
      [
        "two endpoints with the same method and path",
        (d: Doc) => {
          d.endpoints[1].method = "GET";
          d.endpoints[1].requestBody = null;
        },
        "endpoints.1.path",
        /GET \/items is already in this file/,
      ],
      [
        "paths that differ only in parameter names",
        (d: Doc) => {
          d.endpoints[0].path = "/items/{key}";
          d.endpoints[0].parameters.path = {
            type: "object",
            properties: { key: { type: "string" } },
            required: ["key"],
          };
        },
        "endpoints.2.path",
        /GET \/items\/\{key\} is already in this file/,
      ],
      [
        "a repeated operation ID",
        (d: Doc) => (d.endpoints[1].operationId = "listItems"),
        "endpoints.1.operationId",
        /Already used by GET \/items/,
      ],
      [
        "a scheme the project lacks",
        (d: Doc) => (d.endpoints[1].security.schemeIds = ["bearer", "gone"]),
        "endpoints.1.security.schemeIds",
        /Pick schemes from the project's authentication settings/,
      ],
      [
        "an error type the file lacks",
        (d: Doc) =>
          (d.endpoints[0].responses[1].errors[0].errorTypeId = "gone"),
        "endpoints.0.responses.1.errors.0.errorTypeId",
        /This error type isn't in the project/,
      ],
      [
        "an error type in a response of another status",
        (d: Doc) =>
          (d.endpoints[0].responses[1].errors[0].errorTypeId = "not-found"),
        "endpoints.0.responses.1.errors.0.errorTypeId",
        /not-found is a 404 error, so a 429 response can't use it/,
      ],
      [
        "repeated page slugs",
        (d: Doc) => (d.pages[1].slug = "items"),
        "pages.1.slug",
        /^Page Item: Another page has this slug/,
      ],
      [
        "a link to an endpoint the file lacks",
        (d: Doc) => (d.pages[1].endpoints[1].endpointId = "gone"),
        "pages.1.endpoints.1.endpointId",
        /Pick an endpoint of this project/,
      ],
      [
        "a state from a response the endpoint lacks",
        (d: Doc) => (d.pages[0].states[1].causes[0].responseId = "gone"),
        "pages.0.states.1.causes.0",
        /GET \/items has no such response anymore/,
      ],
      [
        "a state showing another page's mockup",
        (d: Doc) => {
          d.pages[1].mockups = [
            {
              id: "other",
              file: "mockups/items.png",
              originalName: "",
              caption: "",
            },
          ];
          d.pages[0].mockups.shift();
          d.pages[0].states[1].mockupIds = ["other"];
        },
        "pages.0.states.1.mockupIds",
        /This page has no such mockup/,
      ],
      [
        "a caption longer than an upload's",
        (d: Doc) => (d.pages[0].mockups[0].caption = "x".repeat(301)),
        "pages.0.mockups.0.caption",
        /300/,
      ],
      [
        "an original name longer than an upload keeps",
        (d: Doc) => (d.pages[0].mockups[0].originalName = "x".repeat(256)),
        "pages.0.mockups.0.originalName",
        /255/,
      ],
    ])("refuses %s", (_, change, issuePath, message) => {
      const issues = issuesAfter(change);
      expect(issues.map((issue) => issue.path)).toContain(issuePath);
      expect(issues.find((issue) => issue.path === issuePath)?.message).toMatch(
        message,
      );
    });

    it("accepts what uploads accept as an original name, even nothing", () => {
      const document = fixture();
      document.pages[0].mockups[0].originalName = "";
      document.pages[0].mockups[1].originalName = `../${"x".repeat(252)}`;
      expect("document" in check(document)).toBe(true);
    });

    it("accepts references between models in any order, and to themselves", () => {
      // The fixture's Item refers to itself, and Category and Item to each other.
      expect("document" in check(fixture())).toBe(true);
    });
  });

  describe("keys", () => {
    it.each([
      [
        "models",
        (d: Doc) => (d.models[1].id = "category"),
        "models.1.id",
        /Another model has this ID/,
      ],
      [
        "error types",
        (d: Doc) => (d.errorTypes[1].id = "not-found"),
        "errorTypes.1.id",
        /Another error type has this ID/,
      ],
      [
        "endpoints",
        (d: Doc) => (d.endpoints[1].id = "list-items"),
        "endpoints.1.id",
        /Another endpoint has this ID/,
      ],
      [
        "pages",
        (d: Doc) => (d.pages[1].id = "items-page"),
        "pages.1.id",
        /Another page has this ID/,
      ],
      [
        "mockups, across pages",
        (d: Doc) =>
          (d.pages[1].mockups = [
            {
              id: "list-shot",
              file: "mockups/other.png",
              originalName: "",
              caption: "",
            },
          ]),
        "pages.1.mockups.0.id",
        /Another mockup has this ID/,
      ],
      ["the project", (d: Doc) => (d.project.id = ""), "project.id", /./],
    ])(
      "refuses repeated or empty keys of %s",
      (_, change, issuePath, message) => {
        const issues = issuesAfter(change);
        expect(
          issues.find((issue) => issue.path === issuePath)?.message,
        ).toMatch(message);
      },
    );

    it("treats names of Object.prototype as plain keys", () => {
      const document = fixture();
      document.models[0].id = "constructor";
      document.models[1].schema.properties.category.$ref = "model:constructor";
      document.models[1].id = "__proto__";
      for (const target of [
        document.models[0].schema.properties.featured,
        document.models[1].schema.properties.related.items,
        document.errorTypes[0].body.schema.properties.nearest,
        document.endpoints[0].responses[0].body.schema.items,
        document.endpoints[1].requestBody.schema,
        document.endpoints[1].responses[0].body.schema,
        document.endpoints[2].responses[0].body.schema,
      ]) {
        target.$ref = "model:__proto__";
      }
      expect("document" in check(document)).toBe(true);

      document.models[0].schema.properties.featured.$ref = "model:toString";
      expect(issuesOf(document)).toEqual([
        {
          path: "models.0.schema",
          message:
            "Model Category: References a model that doesn't exist: model:toString",
        },
      ]);
    });
  });

  describe("mockup files", () => {
    it.each([
      "../items.png",
      "/items.png",
      "mockups\\items.png",
      "mockups//items.png",
      "mockups/./items.png",
      "",
      `mockups/${"x".repeat(250)}.png`,
    ])("refuses the path %j", (file) => {
      const issues = issuesAfter((d) => (d.pages[0].mockups[0].file = file));
      expect(issues.map((issue) => issue.path)).toEqual([
        "pages.0.mockups.0.file",
      ]);
    });

    it("refuses a file that two mockups use", () => {
      expect(
        issuesAfter((d) => (d.pages[0].mockups[1].file = "mockups/items.png")),
      ).toEqual([
        {
          path: "pages.0.mockups.1.file",
          message:
            "Page Items: Another mockup uses mockups/items.png; each mockup has a file of its own",
        },
      ]);
    });
  });

  describe("files with many problems", () => {
    it("lists 50 problems, and stops looking after them", () => {
      const document = fixture();
      for (let index = 0; index < 60; index++) {
        document.models.push({
          id: `m${index}`,
          name: "Bad name",
          description: "",
          schema: {},
        });
      }
      const { error, issues } = failure(document);
      expect(issues).toHaveLength(50);
      expect(error).toBe(
        "This project file can't be imported: it has more than 50 problems (the first 50 are listed).",
      );
    });

    it("stops early with a million broken parts", () => {
      const document = fixture();
      document.models = new Array(1_000_000).fill(0);
      const { error, issues } = failure(document);
      expect(issues).toHaveLength(50);
      expect(issues[0]).toEqual({
        path: "models.0",
        message: "Model #1: Expected an object",
      });
      expect(error).toMatch(/more than 50 problems/);
    });

    it("stops early with a part full of fields the format doesn't have", () => {
      const document = fixture();
      for (let index = 0; index < 100_000; index++) {
        document.models[0][`extra${index}`] = index;
      }
      const { issues } = failure(document);
      expect(issues).toHaveLength(50);
    });

    it("shortens long names in issue paths", () => {
      const document = fixture();
      document.models[0]["x".repeat(200_000)] = 1;
      const [issue] = failure(document).issues;
      expect(issue?.path.length).toBeLessThan(100);
    });
  });

  it("repairs response IDs saved before they had to be unique, as reading the database does", () => {
    const document = fixture();
    // GET /items/{itemId}: both responses called "ok".
    document.endpoints[2].responses[1].id = "ok";
    const result = check(document);
    expect(
      "document" in result &&
        result.document.endpoints[2]?.responses.map((response) => response.id),
    ).toEqual(["ok", "ok-2"]);
  });

  it("takes as many scheme IDs as the API does", () => {
    const document = fixture();
    document.endpoints[1].security.schemeIds = new Array(1001).fill("bearer");
    expect("document" in check(document)).toBe(true);
  });

  it("refuses scheme IDs that aren't text with one problem, not one each", () => {
    const document = fixture();
    document.endpoints[1].security.schemeIds = new Array(100_000).fill(5);
    expect(issuesOf(document)).toEqual([
      {
        path: "endpoints.1.security.schemeIds",
        message: "POST /items: Scheme IDs must be text",
      },
    ]);
  });

  it("turns an upgrade that fails on an odd file into a refusal", () => {
    const result = validateProjectFile(fixture(), {
      appVersion: "1.2.3",
      format: {
        current: 2,
        upgrades: {
          1: () => {
            throw new TypeError("pages.map is not a function");
          },
        },
      },
    });
    expect(result).toEqual({
      error:
        "This project file of format 1 couldn't be upgraded to format 2: pages.map is not a function",
      issues: [],
    });
  });

  it("takes schemas and examples nested up to 256 levels deep, as the API does, and refuses deeper ones", () => {
    const deepSchema = (levels: number) => {
      let schema: Doc = { type: "string" };
      for (let level = 1; level < levels; level++) {
        schema = { type: "array", items: schema };
      }
      return schema;
    };
    const deepValue = (levels: number) => {
      let value: Doc = 0;
      for (let level = 0; level < levels; level++) {
        value = [value];
      }
      return value;
    };
    const document = fixture();
    document.models[0].schema = deepSchema(256);
    document.errorTypes[0].body.example = deepValue(256);
    document.endpoints[1].requestBody.examples[0].value = deepValue(256);
    expect(check(document)).toHaveProperty("document");

    // Far past where following references would run out of stack.
    document.models[0].schema = deepSchema(20_000);
    document.errorTypes[0].body.example = deepValue(257);
    document.endpoints[1].requestBody.examples[0].value = deepValue(257);
    document.endpoints[2].responses[1].errors[0].examples[0].value =
      deepValue(257);
    const message = (owner: string, what: string) =>
      `${owner}: This ${what} is nested more than 256 levels deep`;
    expect(issuesOf(document)).toEqual([
      { path: "models.0.schema", message: message("Model Category", "schema") },
      {
        path: "errorTypes.0.body.example",
        message: message("Error type not-found", "example"),
      },
      {
        path: "endpoints.1.requestBody.examples.0.value",
        message: message("POST /items", "example"),
      },
      {
        path: "endpoints.2.responses.1.errors.0.examples.0.value",
        message: message("GET /items/{itemId}", "example"),
      },
    ]);
  });

  it("says when a newer version made a file it can't import", () => {
    const document = fixture();
    document.models[0].name = "Bad name";
    document.generator = "API Contract Builder 1.10.0";
    expect(failure(document, "1.9.3").error).toBe(
      "This project file can't be imported: it has 1 problem. It was made by API Contract Builder 1.10.0, newer than this one (1.9.3): updating the app may help.",
    );
    expect(failure(document, "1.10.0").error).toBe(
      "This project file can't be imported: it has 1 problem.",
    );
  });
});
