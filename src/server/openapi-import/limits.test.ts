import { describe, expect, it } from "vitest";
import { buildOpenApi, lintContract } from "../export/openapi";
import { testEndpoint, testPage, testProject } from "../export/test-input";
import { validateProjectFile } from "../project-file/validate";
import { createTestApp } from "../test-utils";
import { convertOpenApi } from "./convert";
import { moduleUrl, runCold } from "./test-cold";
import { convert, doc31, endpoint, type Loose, refusal } from "./test-convert";

// What a small document can make the import do: every copy a reference
// makes is counted against the value limit, nothing costs more for being
// deep or having long names, and nothing grows with the square of a count.
// Memory is checked in a process with a small container's heap.

/** `/a-`, `/a.`, `/a_`, … : distinct paths whose suggested operation IDs are the same. */
function sameBasePaths(count: number) {
  const symbols = ["-", ".", "_", "~"];
  return Array.from({ length: count }, (_, index) => {
    let suffix = "";
    let rest = index;
    do {
      suffix += symbols[rest % 4];
      rest = Math.floor(rest / 4);
    } while (rest > 0);
    return `/a${suffix}`;
  });
}

const OK = { "200": { description: "OK" } };

function timed<T>(work: () => T): [T, number] {
  const started = performance.now();
  const result = work();
  return [result, performance.now() - started];
}

describe("references that copy parts in", () => {
  it("count every copy against the value limit, headers and parameters too", {
    timeout: 120_000,
  }, () => {
    // 5,000 headers, in each of 300 responses.
    const headers = Object.fromEntries(
      Array.from({ length: 5_000 }, (_, index) => [`h${index}`, {}]),
    );
    const paths = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `/p${index}`,
        {
          get: { responses: { "200": { $ref: "#/components/responses/R" } } },
        },
      ]),
    );
    expect(
      refusal(
        doc31({
          paths,
          components: { responses: { R: { description: "OK", headers } } },
        }),
      ),
    ).toMatch(/more than 1,000,000 values once its references are copied in/);

    // 2,000 parameters without a schema, on 7 operations of a path item
    // that 100 paths use.
    const parameters = Array.from({ length: 2_000 }, (_, index) => ({
      name: `q${index}`,
      in: "query",
    }));
    const methods = [
      "get",
      "put",
      "post",
      "delete",
      "options",
      "head",
      "patch",
    ];
    expect(
      refusal(
        doc31({
          paths: Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `/i${index}`,
              { $ref: "#/components/pathItems/P" },
            ]),
          ),
          components: {
            pathItems: {
              P: {
                parameters,
                ...Object.fromEntries(
                  methods.map((method) => [method, { responses: OK }]),
                ),
              },
            },
          },
        }),
      ),
    ).toMatch(/more than 1,000,000 values once its references are copied in/);

    // Headers left out unread count too: 2,048 spellings of Content-Type.
    const spellings = Array.from({ length: 2_048 }, (_, bits) => {
      let letter = 0;
      return [..."content-type"]
        .map((char) =>
          char === "-"
            ? char
            : (bits >> letter++) & 1
              ? char.toUpperCase()
              : char,
        )
        .join("");
    });
    expect(new Set(spellings).size).toBe(2_048);
    expect(
      refusal(
        doc31({
          paths: Object.fromEntries(
            Array.from({ length: 600 }, (_, index) => [
              `/c${index}`,
              {
                get: {
                  responses: { "200": { $ref: "#/components/responses/R" } },
                },
              },
            ]),
          ),
          components: {
            responses: {
              R: {
                description: "OK",
                headers: Object.fromEntries(
                  spellings.map((name) => [name, { schema: {} }]),
                ),
              },
            },
          },
        }),
      ),
    ).toMatch(/more than 1,000,000 values once its references are copied in/);

    // And so do parameters left out unread: cookies.
    expect(
      refusal(
        doc31({
          paths: Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `/k${index}`,
              { $ref: "#/components/pathItems/K" },
            ]),
          ),
          components: {
            pathItems: {
              K: {
                parameters: Array.from({ length: 2_000 }, (_, index) => ({
                  name: `c${index}`,
                  in: "cookie",
                })),
                ...Object.fromEntries(
                  methods.map((method) => [method, { responses: OK }]),
                ),
              },
            },
          },
        }),
      ),
    ).toMatch(/more than 1,000,000 values once its references are copied in/);

    // Fields the app doesn't keep are read each time too.
    const extensions = Object.fromEntries(
      Array.from({ length: 20_000 }, (_, index) => [`x-e${index}`, 1]),
    );
    expect(
      refusal(
        doc31({
          paths: Object.fromEntries(
            Array.from({ length: 100 }, (_, index) => [
              `/e${index}`,
              {
                get: {
                  responses: { "200": { $ref: "#/components/responses/R" } },
                },
              },
            ]),
          ),
          components: {
            responses: { R: { description: "OK", ...extensions } },
          },
        }),
      ),
    ).toMatch(/more than 1,000,000 values once its references are copied in/);
  });

  it("follow a chain of references without recursion, however long", {
    timeout: 120_000,
  }, () => {
    // 50,000 schemas, each only a reference to the next.
    const chain: Record<string, unknown> = { d49999: { type: "string" } };
    for (let index = 0; index < 49_999; index++) {
      chain[`d${index}`] = { $ref: `#/x-chain/d${index + 1}` };
    }
    const converted = convert(
      doc31({
        "x-chain": chain,
        paths: {
          "/things": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": { schema: { $ref: "#/x-chain/d0" } },
                  },
                },
              },
            },
          },
        },
      }),
    );
    expect(
      endpoint(converted, "GET /things").responses[0]?.body?.schema,
    ).toEqual({ type: "string" });

    // Each of 2,000 properties refers to the next: copying them all is
    // 2,000,000 copies, which the value limit stops, saying so.
    const properties: Record<string, unknown> = { p1999: { type: "string" } };
    for (let index = 0; index < 1_999; index++) {
      properties[`p${index}`] = {
        $ref: `#/components/schemas/X/properties/p${index + 1}`,
      };
    }
    const [message, ms] = timed(() =>
      refusal(
        doc31({
          components: { schemas: { X: { type: "object", properties } } },
        }),
      ),
    );
    expect(message).toMatch(
      /more than 1,000,000 values once its references are copied in/,
    );
    expect(ms).toBeLessThan(5_000);
  });
});

describe("long names and deep places", () => {
  /** A schema 50 levels deep, each property name 10,000 characters long. */
  function deep(inner: unknown) {
    const name = "n".repeat(10_000);
    let schema = inner;
    for (let level = 0; level < 50; level++) {
      schema = { type: "object", properties: { [name]: schema } };
    }
    return schema;
  }

  it("cost the same as short ones in notices, which show a shortened place", {
    timeout: 120_000,
  }, () => {
    const allOf = Array.from({ length: 1_000 }, () => ({ nullable: true }));
    const [converted, ms] = timed(() =>
      convert(doc31({ components: { schemas: { X: deep({ allOf }) } } })),
    );
    expect(converted.messages.join("\n")).toMatch(
      /nullable isn't a keyword of OpenAPI 3.1, so it has no effect in 1,000 schemas/,
    );
    const deepest = converted.notices.find((notice) =>
      notice.path.includes("nnnn"),
    );
    expect(deepest?.path).toMatch(
      /^\/components\/schemas\/X\/properties\/n+…$/,
    );
    for (const notice of converted.notices) {
      expect(notice.path.length).toBeLessThanOrEqual(1000);
    }
    expect(ms).toBeLessThan(5_000);
  });

  it("show a shortened place in a refusal too", () => {
    const allOf = Array.from({ length: 100 }, (_, index) => ({
      $ref: `#/nowhere/${index}`,
    }));
    const result = convertOpenApi(
      doc31({ components: { schemas: { X: deep({ allOf }) } } }),
      {},
    );
    if (!("error" in result)) throw new Error("Expected a refusal");
    expect(result.issues.length).toBeGreaterThan(10);
    for (const issue of result.issues) {
      expect(issue.path).toMatch(/…$/);
      expect(issue.path.length).toBeLessThanOrEqual(1000);
    }
  });

  it("cost the same as short ones when a reference is copied in many times", {
    timeout: 120_000,
  }, () => {
    // One reference 1,000,000 characters long, in a schema copied into
    // 4,000 places: located each time, that took seconds.
    const name = "n".repeat(1_000_000);
    const properties = Object.fromEntries(
      Array.from({ length: 4_000 }, (_, index) => [
        `f${index}`,
        { $ref: "#/components/schemas/H/properties/s" },
      ]),
    );
    const [converted, ms] = timed(() =>
      convert(
        doc31({
          components: {
            schemas: {
              A: { properties: { [name]: { type: "string" } } },
              H: {
                properties: {
                  s: {
                    properties: {
                      x: { $ref: `#/components/schemas/A/properties/${name}` },
                    },
                  },
                },
              },
              B: { type: "object", properties },
            },
          },
        }),
      ),
    );
    expect(
      converted.document.models.find((model) => model.name === "B")?.schema
        .properties,
    ).toMatchObject({
      f3999: { properties: { x: { type: "string" } } },
    });
    expect(ms).toBeLessThan(4_000);
  });
});

describe("a deep document read cold, with a small container's heap", () => {
  it("indexes the $ids and $anchors of OpenAPI 3.1 without a path for each value", {
    timeout: 120_000,
  }, () => {
    const run = runCold(
      `
      import { convertOpenApi } from ${moduleUrl("src/server/openapi-import/convert.ts")};
      import { readOpenApiTextSync } from ${moduleUrl("src/server/openapi-import/read.ts")};
      const depth = 250;
      const deep = (inner) => '{"a":'.repeat(depth) + inner + "}".repeat(depth);
      const anchors = Array.from({ length: 100_000 }, (_, index) => '{"$anchor":"n' + index + '"}').join(",");
      for (const part of [
        '"foo":' + deep("[" + "0,".repeat(300_000) + "0]"),
        '"components":{"schemas":{"X":' + deep('{"allOf":[' + anchors + ']}') + "}}",
      ]) {
        const text = '{"openapi":"3.1.0","info":{"title":"T","version":"1"},' + part + "}";
        const read = readOpenApiTextSync(new TextEncoder().encode(text), "json");
        if ("error" in read) throw new Error(read.error);
        const result = convertOpenApi(read.value, {});
        console.log("error" in result ? "refused: " + result.error : "made");
      }
      `,
      { heapMb: 256 },
    );
    expect(run.output).toBe("made\nmade");
    expect(run.status).toBe(0);
  });
});

describe("many parts with the same name", () => {
  it("get their unique names in linear time", { timeout: 300_000 }, () => {
    const paths = (make: (index: number) => [string, unknown]) =>
      Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => make(i)));
    const cases: [string, unknown][] = [
      [
        "operation IDs",
        doc31({
          paths: paths((index) => [
            `/p${index}`,
            { get: { operationId: "x", responses: OK } },
          ]),
        }),
      ],
      [
        "operation IDs the export suggests",
        doc31({
          paths: Object.fromEntries(
            sameBasePaths(20_000).map((path) => [
              path,
              { get: { responses: OK } },
            ]),
          ),
        }),
      ],
      [
        "operation IDs that look suggested, in the opposite order",
        doc31({
          paths: Object.fromEntries(
            sameBasePaths(20_000)
              .sort()
              .map((path, index, all) => [
                path,
                {
                  get: {
                    operationId:
                      index === all.length - 1
                        ? "getA"
                        : `getA${all.length - index}`,
                    responses: OK,
                  },
                },
              ]),
          ),
        }),
      ],
      [
        "model names",
        doc31({
          components: {
            schemas: Object.fromEntries(
              Array.from({ length: 20_000 }, (_, index) => [
                `a${String.fromCharCode(0x4e00 + index)}`,
                { type: "string" },
              ]),
            ),
          },
        }),
      ],
      [
        "page slugs",
        doc31({
          tags: Array.from({ length: 20_000 }, () => ({ name: "Same" })),
          paths: {
            "/p": {
              get: {
                responses: OK,
                "x-pages": [{ page: "Same", slug: "same", trigger: "load" }],
              },
            },
          },
        }),
      ],
    ];
    for (const [what, doc] of cases) {
      const [result, ms] = timed(() => convertOpenApi(doc, {}));
      expect("error" in result ? result.error : "made", what).toBe("made");
      expect(ms, what).toBeLessThan(5_000);
    }
  });

  it("export in linear time: operation IDs, tags, and the report", () => {
    const endpoints = sameBasePaths(20_000).map((path, index) =>
      testEndpoint(`e${index}`, "GET", path),
    );
    const pages = Array.from({ length: 80_000 }, (_, index) =>
      testPage(`g${index}`, "Same", [], { slug: `same-${index}` }),
    );
    const input = {
      project: testProject(),
      models: [],
      endpoints,
      pages,
      errorTypes: [],
    };
    const [doc, built] = timed(() => buildOpenApi(input, {}));
    expect(Object.keys(doc.paths)).toHaveLength(20_000);
    expect(doc.tags?.at(-1)?.name).toBe("Same (same-79999)");
    // About 0.1 s here; 20,000 alike names took 10 to 18 s before.
    expect(built).toBeLessThan(5_000);
    const [warnings, linted] = timed(() => lintContract(input, {}));
    expect(warnings.length).toBeGreaterThan(20_000);
    expect(linted).toBeLessThan(3_000);
  });
});

describe("text that references copy in", () => {
  it("counts against 16 MB, as much as a document may have, so a small file can't make a huge project", () => {
    // One example of 100 KB that 200 responses use: 20 MB once copied.
    const paths = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [
        `/p${index}`,
        { get: { responses: { "200": { $ref: "#/components/responses/R" } } } },
      ]),
    );
    const doc = doc31({
      paths,
      components: {
        responses: {
          R: {
            description: "OK",
            content: {
              "application/json": {
                examples: { big: { $ref: "#/components/examples/Big" } },
              },
            },
          },
        },
        examples: { Big: { value: "x".repeat(100 * 1024) } },
      },
    });
    const [message, ms] = timed(() => refusal(doc));
    expect(message).toMatch(
      /makes a project of more than 16 MB of text once its references are copied in/,
    );
    expect(ms).toBeLessThan(5_000);
    // 120 responses, 12 MB: within it.
    for (let index = 120; index < 200; index++) delete paths[`/p${index}`];
    expect(convert(doc).document.endpoints).toHaveLength(120);
  });
});

describe("text a project gets after its endpoints", () => {
  it("counts too: pages' descriptions on top of copied responses", {
    timeout: 60_000,
  }, () => {
    // 100 responses copy a 140 KB description: 14 MB, within 16 MB; the
    // 150 pages of the tags then add 3 MB of their own descriptions.
    const description = "d".repeat(140 * 1024);
    const doc = doc31({
      tags: Array.from({ length: 150 }, (_, index) => ({
        name: `Page ${index}`,
        description: "t".repeat(20_000),
      })),
      paths: Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          `/p${index}`,
          {
            get: {
              "x-pages": [
                {
                  page: `Page ${index}`,
                  slug: `page-${index}`,
                  trigger: "on_load",
                },
              ],
              responses: { "200": { $ref: "#/components/responses/R" } },
            },
          },
        ]),
      ),
      components: {
        responses: {
          R: {
            description: "OK",
            content: {
              "application/json": { schema: { type: "string", description } },
            },
          },
        },
      },
    });
    expect(refusal(doc)).toMatch(
      /makes a project of more than 16 MB of text once its references are copied in/,
    );
  });
});

describe("notices of many different names", () => {
  it("are one kind, with a few of the names, in little memory", () => {
    const run = runCold(
      `
      import { convertOpenApi } from ${moduleUrl("src/server/openapi-import/convert.ts")};
      const operation = { responses: { "200": { description: "OK" } } };
      for (let index = 0; index < 300_000; index++) operation["x-e" + index] = 1;
      const result = convertOpenApi({ openapi: "3.1.0", info: { title: "T", version: "1" }, paths: { ["/" + "p".repeat(400)]: { get: operation } } }, {});
      if ("error" in result) console.log("refused: " + result.error);
      else console.log(result.notices.filter((notice) => /xtension/.test(notice.message)).map((notice) => notice.message).join("\\n"));
      `,
      { heapMb: 256 },
    );
    expect(run.output).toMatch(
      /^Extensions aren't kept \(300,000 places: x-e0, x-e1, x-e2, and others\)$/,
    );
    expect(run.status).toBe(0);
  });
});

describe("parts a shared component repeats for each use", () => {
  /** `count` operations whose 200 response is components.responses.R. */
  const sharing = (count: number, response: unknown, parts: Loose = {}) =>
    doc31({
      ...parts,
      paths: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `/s${index}`,
          {
            get: { responses: { "200": { $ref: "#/components/responses/R" } } },
          },
        ]),
      ),
      components: { ...parts.components, responses: { R: response } },
    });
  const many = (count: number, make: (index: number) => [string, unknown]) =>
    Object.fromEntries(
      Array.from({ length: count }, (_, index) => make(index)),
    );

  it("count each time, however they're left out", { timeout: 120_000 }, () => {
    const cases: [string, unknown][] = [
      [
        "media types of a shared response",
        sharing(1_000, {
          description: "OK",
          content: many(20_000, (index) => [`text/x-${index}`, {}]),
        }),
      ],
      [
        "fields beside a shared reference",
        sharing(
          1_000,
          {
            description: "OK",
            headers: {
              h: {
                $ref: "#/components/headers/H",
                ...many(20_000, (index) => [`x-${index}`, 1]),
              },
            },
          },
          { components: { headers: { H: { schema: { type: "string" } } } } },
        ),
      ],
      [
        "additionalOperations of a shared path item",
        {
          openapi: "3.2.0",
          info: { title: "T", version: "1" },
          paths: many(1_000, (index) => [
            `/a${index}`,
            { $ref: "#/components/pathItems/P" },
          ]),
          components: {
            pathItems: {
              P: {
                get: { responses: OK },
                additionalOperations: many(20_000, (index) => [
                  `M${index}`,
                  { responses: OK },
                ]),
              },
            },
          },
        },
      ],
      [
        "x-pages entries of a shared operation",
        doc31({
          paths: many(1_000, (index) => [
            `/x${index}`,
            { $ref: "#/components/pathItems/P" },
          ]),
          components: {
            pathItems: {
              P: {
                get: {
                  responses: OK,
                  "x-pages": Array.from({ length: 20_000 }, () => ({
                    page: "",
                  })),
                },
              },
            },
          },
        }),
      ],
      [
        "media types of a shared parameter",
        doc31({
          paths: many(1_000, (index) => [
            `/q${index}`,
            {
              get: {
                parameters: [{ $ref: "#/components/parameters/Q" }],
                responses: OK,
              },
            },
          ]),
          components: {
            parameters: {
              Q: {
                name: "q",
                in: "query",
                content: many(20_000, (index) => [`text/x-${index}`, {}]),
              },
            },
          },
        }),
      ],
    ];
    for (const [what, doc] of cases) {
      const [message, ms] = timed(() => refusal(doc));
      expect(message, what).toMatch(
        /more than 1,000,000 values once its references are copied in/,
      );
      expect(ms, what).toBeLessThan(5_000);
    }
  });
});

describe("many parts with names that are alike once cut to fit", () => {
  /** The `index`th of distinct `length`-character tails. */
  const tail = (index: number, alphabet: string, length: number) => {
    let text = "";
    let rest = index;
    for (let place = 0; place < length; place++) {
      text = (alphabet[rest % alphabet.length] as string) + text;
      rest = Math.floor(rest / alphabet.length);
    }
    return text;
  };

  it("get their unique names in linear time", { timeout: 300_000 }, () => {
    // Pairs that need a number, whose numbered names, cut to fit, are the
    // same for every pair: 59 characters in common, the rest differing.
    const lower = "abcdefghijklmnopqrstuvwxyz0123456789._-";
    const word =
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_";
    const schemas: Record<string, unknown> = {};
    const paths: Record<string, unknown> = {};
    const tags: { name: string }[] = [];
    for (let index = 0; index < 10_000; index++) {
      const name = `${"x".repeat(59)}${tail(index, lower, 5)}`;
      // Unique ignoring case, so the second needs a number.
      schemas[name] = { type: "string" };
      schemas[`X${name.slice(1)}`] = { type: "string" };
      const id = `${"x".repeat(96)}${tail(index, word, 4)}`;
      paths[`/a${index}`] = { get: { operationId: id, responses: OK } };
      paths[`/b${index}`] = { get: { operationId: `${id}Z`, responses: OK } };
      const tag = `${"x".repeat(59)}${tail(index, "abcdefghijklmnopqrstuvwxyz0123456789", 5)}`;
      tags.push({ name: tag }, { name: tag });
    }
    const cases: [string, unknown][] = [
      ["model names cut to 64 characters", doc31({ components: { schemas } })],
      ["operation IDs cut to 100 characters", doc31({ paths })],
      [
        "page slugs cut to 64 characters",
        doc31({
          tags,
          paths: {
            "/p": { get: { "x-pages": [], responses: OK } },
          },
        }),
      ],
    ];
    for (const [what, doc] of cases) {
      const [result, ms] = timed(() => convertOpenApi(doc, {}));
      expect("error" in result ? result.error : "made", what).toBe("made");
      expect(ms, what).toBeLessThan(5_000);
    }
  });

  it("make error types and check them in linear time", {
    timeout: 300_000,
  }, () => {
    const count = 10_000;
    const examples = Object.fromEntries(
      Array.from({ length: count }, (_, index) => [
        `e${index}`,
        {
          summary: `E${index}`,
          value: {
            type: `https://api.example/problems/e${index}`,
            status: 404,
          },
        },
      ]),
    );
    const response = (index: number) => ({
      description: "Not Found",
      content: {
        "application/problem+json": {
          schema: { type: "object" },
          examples: {
            [`e${index}`]: { $ref: `#/components/examples/e${index}` },
          },
        },
      },
    });
    const doc = doc31({
      components: { examples },
      paths: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `/r${index}`,
          { get: { responses: { "404": response(index) } } },
        ]),
      ),
    });
    const [result, converted] = timed(() => convertOpenApi(doc, {}));
    if ("error" in result) throw new Error(result.error);
    expect(result.document.errorTypes).toHaveLength(count);
    expect(converted).toBeLessThan(4_000);
    const [checked, validated] = timed(() =>
      validateProjectFile(structuredClone(result.document), {
        appVersion: "1.2.3",
      }),
    );
    expect("error" in checked ? checked.error : "valid").toBe("valid");
    expect(validated).toBeLessThan(4_000);
  });
});

describe("text the exports write", () => {
  /** `count` operations whose 404 is one shared response, made an error type. */
  const sharedError = (count: number, response: Loose) =>
    doc31({
      paths: Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `/p${index}`,
          {
            get: {
              responses: {
                "200": { description: "OK" },
                "404": { $ref: "#/components/responses/NotFound" },
              },
            },
          },
        ]),
      ),
      components: {
        responses: { NotFound: { description: "Not found", ...response } },
        examples: {
          "not-found": {
            summary: "Not found",
            value: {
              type: "https://example.com/not-found",
              title: "Not found",
              status: 404,
            },
          },
        },
      },
    });
  const content = (schema: unknown) => ({
    "application/problem+json": {
      schema,
      examples: { "not-found": { $ref: "#/components/examples/not-found" } },
    },
  });

  it("counts an error type's schema and headers in each response that uses it, as the export writes them", () => {
    const long = "d".repeat(100 * 1024);
    for (const [what, response] of [
      ["schema", { content: content({ type: "object", description: long }) }],
      [
        "headers",
        {
          headers: {
            "X-Info": { description: long, schema: { type: "string" } },
          },
          content: content({ type: "object" }),
        },
      ],
    ] as const) {
      // 300 responses of 100 KB each: 30 MB once written out, though the
      // error type holds it once.
      const [message, ms] = timed(() => refusal(sharedError(300, response)));
      expect(message, what).toMatch(
        /makes a project of more than 16 MB of text once its references are copied in/,
      );
      expect(ms, what).toBeLessThan(5_000);
    }
    // 100 responses, 10 MB: within it, and made one error type.
    const converted = convert(
      sharedError(100, {
        content: content({ type: "object", description: long }),
      }),
    );
    expect(converted.document.errorTypes).toHaveLength(1);
  });
});

describe("what the exports write, beyond the project", () => {
  /** What importing `doc` answers. */
  const importing = async (doc: unknown) => {
    const t = createTestApp();
    try {
      const response = await t.app.request("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      return {
        status: response.status,
        body: (await response.json()) as { error?: string },
      };
    } finally {
      t.close();
    }
  };
  const letters = "abcdefghijklmnopqrstuvwxyz";
  const word = (index: number) => {
    let text = "";
    let rest = index;
    for (let place = 0; place < 4; place++) {
      text += letters[rest % 26];
      rest = Math.floor(rest / 26);
    }
    return text;
  };
  /** `pages` pages of long names, each linking the one operation that `paths` paths share. */
  const linked = (pages: number, paths: number) =>
    doc31({
      paths: Object.fromEntries(
        Array.from({ length: paths }, (_, index) => [
          `/p${index}`,
          { $ref: "#/components/pathItems/I" },
        ]),
      ),
      components: {
        pathItems: {
          I: {
            get: {
              "x-status": "draft",
              "x-pages": Array.from({ length: pages }, (_, index) => ({
                page: `Page ${word(index)} ${"n".repeat(90)}`,
                slug: `${word(index)}-${"s".repeat(58)}`,
                trigger: "on_load",
              })),
              responses: OK,
            },
          },
        },
      },
    });

  it("refuses a project whose OpenAPI export would hold more than 32 MB of text", {
    timeout: 120_000,
  }, async () => {
    // 7,000 pages linking 20 operations: each link writes the page's name
    // and slug into the operation (tags and x-pages), 40 MB in all.
    const [pages, pagesMs] = timed(() => refusal(linked(7_000, 20)));
    expect(pages).toMatch(/OpenAPI export would hold more than 32 MB of text/);
    expect(pagesMs).toBeLessThan(5_000);
    // A schema of 1,000 references to a model with a 64-character name,
    // in 250 responses: each reference is written as its name, 36 MB.
    const name = "M".repeat(64);
    const started = performance.now();
    const refs = await importing(
      doc31({
        paths: Object.fromEntries(
          Array.from({ length: 250 }, (_, index) => [
            `/r${index}`,
            {
              get: {
                responses: { "200": { $ref: "#/components/responses/R" } },
              },
            },
          ]),
        ),
        components: {
          schemas: { [name]: { type: "string" } },
          responses: {
            R: {
              description: "OK",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: Object.fromEntries(
                      Array.from({ length: 1_000 }, (_, index) => [
                        `p${index}`,
                        { $ref: `#/components/schemas/${name}` },
                      ]),
                    ),
                  },
                },
              },
            },
          },
        },
      }),
    );
    expect(refs.status).toBe(400);
    expect(refs.body.error).toMatch(
      /OpenAPI export would hold more than 32 MB of text/,
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    // 2,000 pages linking 15 operations: within it.
    const within = await importing(linked(2_000, 15));
    expect(within.status).toBe(201);
  });

  it("refuses a project whose Markdown export would hold more than 16 MB of text", {
    timeout: 120_000,
  }, async () => {
    // 50 endpoints of 30 KB of text, each linked by `pages` pages: the
    // Markdown bundle writes every endpoint into each page that calls it.
    const text = "t".repeat(10_000);
    const calledBy = (pages: number) =>
      doc31({
        paths: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            `/e${index}`,
            {
              get: {
                description: text,
                "x-notes-fe": text,
                "x-notes-be": text,
                "x-pages": Array.from({ length: pages }, (_, page) => ({
                  page: `Page ${page}`,
                  slug: `page-${page}`,
                  trigger: "on_load",
                })),
                responses: OK,
              },
            },
          ]),
        ),
      });
    // 12 pages, 18 MB: past it as written, though within what its budget counts.
    const written = await importing(calledBy(12));
    expect(written.status).toBe(400);
    expect(written.body.error).toMatch(
      /Markdown export would hold more than 16 MB of text/,
    );
    // 8 pages, 12 MB: within it.
    expect((await importing(calledBy(8))).status).toBe(201);
    // 40 pages, 60 MB: past its budget, which stops it early.
    const started = performance.now();
    const markdown = await importing(
      doc31({
        paths: Object.fromEntries(
          Array.from({ length: 50 }, (_, index) => [
            `/e${index}`,
            {
              get: {
                description: text,
                "x-notes-fe": text,
                "x-notes-be": text,
                "x-pages": Array.from({ length: 40 }, (_, page) => ({
                  page: `Page ${page}`,
                  slug: `page-${page}`,
                  trigger: "on_load",
                })),
                responses: OK,
              },
            },
          ]),
        ),
      }),
    );
    expect(markdown.status).toBe(400);
    expect(markdown.body.error).toMatch(
      /Markdown export would hold more than 16 MB of text/,
    );
    expect(performance.now() - started).toBeLessThan(10_000);
  });
});

describe("the files the exports write", () => {
  /** What importing `doc` answers. */
  const importing = async (doc: unknown) => {
    const t = createTestApp();
    try {
      const response = await t.app.request("/api/projects/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(doc),
      });
      return {
        status: response.status,
        body: (await response.json()) as { error?: string },
      };
    } finally {
      t.close();
    }
  };
  /** A model nested `levels` deep, with `inner` at the bottom. */
  const nested = (levels: number, inner: unknown) => {
    let schema = inner;
    for (let level = 0; level < levels; level++) {
      schema = { type: "object", properties: { a: schema } };
    }
    return doc31({ components: { schemas: { Deep: schema } } });
  };

  it("are measured as written, indented, so a deep part can't make them huge", {
    timeout: 120_000,
  }, async () => {
    // 200,000 values 120 levels deep: each on its own line, indented 240
    // spaces, 100 MB once written, though the project holds 2 MB.
    const deep = await importing(
      nested(120, {
        enum: Array.from({ length: 200_000 }, (_, index) => index % 10),
      }),
    );
    expect(deep.status).toBe(400);
    expect(deep.body.error).toMatch(
      /OpenAPI export would hold more than 32 MB of text/,
    );
    // A text of 100,000 lines as deep: YAML writes each line indented.
    const lines = await importing(
      nested(120, { type: "string", description: "x\n".repeat(100_000) }),
    );
    expect(lines.status).toBe(400);
    // The same, 20 levels deep: within it.
    expect(
      (
        await importing(
          nested(20, { type: "string", description: "x\n".repeat(100_000) }),
        )
      ).status,
    ).toBe(201);
  });

  it("are measured with their escapes", { timeout: 120_000 }, async () => {
    // One example of 100 KB of control characters in 150 responses: 15 MB
    // in the project, but JSON writes each as \u0001, six times as long.
    const value = "\u0001".repeat(100 * 1024);
    const escaped = await importing(
      doc31({
        paths: Object.fromEntries(
          Array.from({ length: 150 }, (_, index) => [
            `/p${index}`,
            {
              get: {
                responses: { "200": { $ref: "#/components/responses/R" } },
              },
            },
          ]),
        ),
        components: {
          responses: {
            R: {
              description: "OK",
              content: {
                "application/json": {
                  examples: { E: { $ref: "#/components/examples/E" } },
                },
              },
            },
          },
          examples: { E: { value } },
        },
      }),
    );
    expect(escaped.status).toBe(400);
    expect(escaped.body.error).toMatch(
      /OpenAPI export would hold more than 32 MB of text/,
    );
  });
});
