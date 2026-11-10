import { describe, expect, it } from "vitest";
import { convert, doc31, endpoint, type Loose, readable } from "./test-convert";

const problem = {
  type: "object",
  properties: { type: { type: "string" }, title: { type: "string" } },
};

function catalog(name: string, status: number, extra: Loose = {}) {
  return {
    summary: `${name} title`,
    description: `When ${name} happens.`,
    value: {
      type: `https://api.example/problems/${name}`,
      title: `${name} title`,
      status,
      ...extra,
    },
  };
}

/** A problem+json content with these examples. */
function problems(
  examples: Loose,
  schema: Loose = { $ref: "#/components/schemas/Problem" },
) {
  return { "application/problem+json": { schema, examples } };
}

const ref = (name: string) => ({ $ref: `#/components/examples/${name}` });

function docWith(paths: Loose, examples: Loose, schemas: Loose = {}) {
  return doc31({
    components: { schemas: { Problem: problem, ...schemas }, examples },
    paths,
  });
}

describe("error types from components.examples", () => {
  it("makes an example that error responses refer to by its own name an error type, which they then use", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "404": {
                  description: "Not Found",
                  content: problems({ "not-found": ref("not-found") }),
                },
              },
            },
          },
          "/b": {
            get: {
              responses: {
                "404": {
                  description: "Not Found",
                  content: problems({ "not-found": ref("not-found") }),
                },
              },
            },
          },
        },
        { "not-found": catalog("not-found", 404) },
      ),
    );
    const [errorType] = converted.document.errorTypes;
    expect(converted.document.errorTypes).toHaveLength(1);
    expect({
      ...errorType,
      body: {
        ...errorType?.body,
        schema: readable(converted.document, errorType?.body.schema),
      },
    }).toEqual({
      id: expect.any(String),
      name: "not-found",
      status: "404",
      title: "not-found title",
      description: "When not-found happens.",
      headers: { type: "object", properties: {} },
      body: {
        contentType: "application/problem+json",
        schema: { $ref: "#/components/schemas/Problem" },
        example: {
          type: "https://api.example/problems/not-found",
          title: "not-found title",
          status: 404,
        },
      },
    });
    for (const label of ["GET /a", "GET /b"]) {
      expect(endpoint(converted, label).responses[0]).toMatchObject({
        body: null,
        errors: [{ errorTypeId: errorType?.id, examples: [] }],
      });
    }
  });

  it("takes inline problem details with an error type's type as that endpoint's own examples of it (RFC 9457)", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            post: {
              responses: {
                "422": {
                  description: "Invalid",
                  content: problems({
                    "missing-name": {
                      summary: "No name",
                      value: {
                        type: "https://api.example/problems/invalid",
                        title: "invalid title",
                        status: 422,
                        errors: ["name"],
                      },
                    },
                  }),
                },
              },
            },
          },
        },
        { invalid: catalog("invalid", 422) },
      ),
    );
    const [errorType] = converted.document.errorTypes;
    expect(errorType).toMatchObject({ name: "invalid", status: "422" });
    expect(endpoint(converted, "POST /a").responses[0]).toMatchObject({
      body: null,
      errors: [
        {
          errorTypeId: errorType?.id,
          examples: [
            {
              name: "missing-name",
              summary: "No name",
              value: { errors: ["name"] },
            },
          ],
        },
      ],
    });
  });

  it("takes several error types in one response, in their order", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({ taken: ref("taken"), busy: ref("busy") }),
                },
              },
            },
          },
          "/b": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({ taken: ref("taken") }),
                },
              },
            },
          },
        },
        { taken: catalog("taken", 409), busy: catalog("busy", 409) },
      ),
    );
    const ids = Object.fromEntries(
      converted.document.errorTypes.map((item) => [item.name, item.id]),
    );
    expect(endpoint(converted, "POST /a").responses[0]?.errors).toEqual([
      { errorTypeId: ids.taken, examples: [] },
      { errorTypeId: ids.busy, examples: [] },
    ]);
  });

  it("takes a status from a range or default response only from the example's status", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "4XX": {
                  description: "Client error",
                  content: problems({ teapot: ref("teapot") }),
                },
              },
            },
          },
          "/b": {
            get: {
              responses: {
                default: {
                  description: "Error",
                  content: problems({ vague: ref("vague") }),
                },
              },
            },
          },
        },
        {
          teapot: catalog("teapot", 418),
          vague: {
            summary: "Vague",
            value: { type: "https://api.example/problems/vague" },
          },
        },
      ),
    );
    expect(
      converted.document.errorTypes.map((item) => [item.name, item.status]),
    ).toEqual([["teapot", "418"]]);
    expect(endpoint(converted, "GET /b").responses[0]).toMatchObject({
      errors: [],
      body: { examples: [{ name: "vague", summary: "Vague" }] },
    });
  });

  it("keeps plain bodies where the export wouldn't write the same response", () => {
    const converted = convert(
      docWith(
        {
          // Another key than the component's name: the example's name would change.
          "/renamed": {
            get: {
              responses: {
                "404": {
                  description: "Not Found",
                  content: problems({ missing: ref("not-found") }),
                },
              },
            },
          },
          // An example no error type explains.
          "/mixed": {
            get: {
              responses: {
                "404": {
                  description: "Not Found",
                  content: problems({
                    "not-found": ref("not-found"),
                    other: { value: { type: "https://elsewhere.example/x" } },
                  }),
                },
              },
            },
          },
          // One error type's examples apart, which the export can't write.
          "/apart": {
            get: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({
                    one: {
                      value: {
                        type: "https://api.example/problems/taken",
                        n: 1,
                      },
                    },
                    busy: ref("busy"),
                    two: {
                      value: {
                        type: "https://api.example/problems/taken",
                        n: 2,
                      },
                    },
                  }),
                },
              },
            },
          },
        },
        {
          "not-found": catalog("not-found", 404),
          taken: catalog("taken", 409),
          busy: catalog("busy", 409),
        },
      ),
    );
    for (const label of ["GET /mixed", "GET /apart"]) {
      const [response] = endpoint(converted, label).responses;
      expect(response?.errors, label).toEqual([]);
      expect(response?.body?.examples.length, label).toBeGreaterThan(0);
    }
    // Not the catalog's example, which would be renamed not-found: a copy of
    // it, under its own name, is that endpoint's own example of the type.
    const notFound = converted.document.errorTypes.find(
      (item) => item.name === "not-found",
    );
    expect(endpoint(converted, "GET /renamed").responses[0]).toMatchObject({
      body: null,
      errors: [
        {
          errorTypeId: notFound?.id,
          examples: [
            {
              name: "missing",
              value: { type: "https://api.example/problems/not-found" },
            },
          ],
        },
      ],
    });
  });

  it("keeps a plain body where the error types' own schemas would make the export write another", () => {
    const other = { type: "object", properties: { code: { type: "integer" } } };
    const converted = convert(
      docWith(
        {
          // Each alone: taken has Problem, busy has Other.
          "/a": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({ taken: ref("taken") }),
                },
              },
            },
          },
          "/b": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems(
                    { busy: ref("busy") },
                    { $ref: "#/components/schemas/Other" },
                  ),
                },
              },
            },
          },
          // Together under one schema: the export would write anyOf both.
          "/c": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({ taken: ref("taken"), busy: ref("busy") }),
                },
              },
            },
          },
        },
        { taken: catalog("taken", 409), busy: catalog("busy", 409) },
        { Other: other },
      ),
    );
    expect(converted.document.errorTypes.map((item) => item.name)).toEqual([
      "taken",
      "busy",
    ]);
    expect(endpoint(converted, "POST /a").responses[0]?.errors).toHaveLength(1);
    expect(endpoint(converted, "POST /b").responses[0]?.errors).toHaveLength(1);
    expect(endpoint(converted, "POST /c").responses[0]).toMatchObject({
      errors: [],
      body: { examples: [{ name: "taken" }, { name: "busy" }] },
    });
  });

  it("doesn't match about:blank, a type two examples share, or a status that doesn't fit", () => {
    const blank = (status: number) => ({
      type: "about:blank",
      title: "Error",
      status,
    });
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "400": {
                  description: "Bad",
                  content: problems({ bad: { value: blank(400) } }),
                },
              },
            },
          },
          "/b": {
            get: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({
                    x: {
                      value: {
                        type: "https://api.example/problems/shared",
                        status: 409,
                      },
                    },
                  }),
                },
                "410": {
                  description: "Gone",
                  content: problems({
                    y: {
                      value: {
                        type: "https://api.example/problems/gone",
                        status: 500,
                      },
                    },
                  }),
                },
              },
            },
          },
        },
        {
          generic: { summary: "Generic", value: blank(400) },
          one: {
            summary: "One",
            value: { type: "https://api.example/problems/shared", status: 409 },
          },
          two: {
            summary: "Two",
            value: { type: "https://api.example/problems/shared", status: 409 },
          },
          gone: catalog("gone", 410),
        },
      ),
    );
    expect(converted.document.errorTypes).toEqual([]);
    for (const label of ["GET /a", "GET /b"]) {
      for (const response of endpoint(converted, label).responses) {
        expect(response.errors, `${label} ${response.status}`).toEqual([]);
      }
    }
  });

  it("refuses an error type whose usages disagree on status, content type, or schema", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "400": {
                  description: "Bad",
                  content: problems({ odd: ref("odd") }),
                },
              },
            },
          },
          "/b": {
            get: {
              responses: {
                "422": {
                  description: "Invalid",
                  content: problems({ odd: ref("odd") }),
                },
              },
            },
          },
          "/c": {
            get: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: {
                    "application/json": {
                      schema: { type: "object" },
                      examples: { split: ref("split") },
                    },
                  },
                },
              },
            },
          },
          "/d": {
            get: {
              responses: {
                "409": {
                  description: "Conflict",
                  content: problems({ split: ref("split") }),
                },
              },
            },
          },
        },
        { odd: catalog("odd", 400), split: catalog("split", 409) },
      ),
    );
    expect(converted.document.errorTypes).toEqual([]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/couldn't be error types.*odd.*split/s),
    );
  });

  it("keeps an error type in the response OpenAPI picks for its status, and doesn't use it in a less specific one", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "500": {
                  description: "Server error",
                  content: problems({ crash: ref("crash") }),
                },
                default: {
                  description: "Error",
                  content: problems({ crash: ref("crash") }),
                },
              },
            },
          },
        },
        { crash: catalog("crash", 500) },
      ),
    );
    const responses = endpoint(converted, "GET /a").responses;
    expect(responses[0]?.errors).toHaveLength(1);
    expect(responses[1]).toMatchObject({
      errors: [],
      body: { examples: [{ name: "crash" }] },
    });
  });

  it("gives error types the headers the export merged into their responses, when that's certain", () => {
    const retry = {
      required: true,
      description: "Seconds to wait",
      schema: { type: "integer", examples: [60] },
    };
    const converted = convert(
      docWith(
        {
          "/a": {
            post: {
              responses: {
                "429": {
                  description: "Too many",
                  headers: { "Retry-After": retry },
                  content: problems({ slow: ref("slow") }),
                },
              },
            },
          },
          "/b": {
            post: {
              responses: {
                "429": {
                  description: "Too many",
                  headers: { "Retry-After": retry },
                  content: problems({ slow: ref("slow") }),
                },
              },
            },
          },
          "/c": {
            post: {
              responses: {
                "409": {
                  description: "Conflict",
                  headers: {
                    "Retry-After": {
                      description: "Only with `busy`: Seconds to wait",
                      schema: { type: "integer", examples: [2] },
                    },
                  },
                  content: problems({ taken: ref("taken"), busy: ref("busy") }),
                },
              },
            },
          },
          // Once alone: its header could be the response's own.
          "/d": {
            patch: {
              responses: {
                "415": {
                  description: "Unsupported",
                  headers: {
                    "Accept-Patch": {
                      required: true,
                      schema: { type: "string" },
                    },
                  },
                  content: problems({ unsupported: ref("unsupported") }),
                },
              },
            },
          },
        },
        {
          slow: catalog("slow", 429),
          taken: catalog("taken", 409),
          busy: catalog("busy", 409),
          unsupported: catalog("unsupported", 415),
        },
      ),
    );
    const byName = Object.fromEntries(
      converted.document.errorTypes.map((item) => [item.name, item]),
    );
    expect(byName.slow?.headers).toEqual({
      type: "object",
      properties: {
        "Retry-After": {
          type: "integer",
          examples: [60],
          description: "Seconds to wait",
        },
      },
      required: ["Retry-After"],
    });
    expect(byName.busy?.headers).toEqual({
      type: "object",
      properties: {
        "Retry-After": {
          type: "integer",
          examples: [2],
          description: "Seconds to wait",
        },
      },
    });
    expect(byName.unsupported?.headers).toEqual({
      type: "object",
      properties: {},
    });
    expect(endpoint(converted, "POST /a").responses[0]?.headers).toEqual({
      type: "object",
      properties: {},
    });
    expect(endpoint(converted, "PATCH /d").responses[0]?.headers).toMatchObject(
      { properties: { "Accept-Patch": { type: "string" } } },
    );
  });

  it("copies examples that only success responses share, and doesn't import examples nothing uses", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": { examples: { pet: ref("pet") } },
                  },
                },
              },
            },
          },
        },
        {
          pet: { summary: "A pet", value: { name: "Rex" } },
          spare: catalog("spare", 400),
        },
      ),
    );
    expect(converted.document.errorTypes).toEqual([]);
    expect(endpoint(converted, "GET /a").responses[0]?.body?.examples).toEqual([
      { id: "x1", name: "pet", summary: "A pet", value: { name: "Rex" } },
    ]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/components\.examples.*spare/s),
    );
  });

  it("leaves error types whose names differ only in case as plain examples", () => {
    const converted = convert(
      docWith(
        {
          "/a": {
            get: {
              responses: {
                "404": {
                  description: "Not Found",
                  content: problems({ Gone: ref("Gone") }),
                },
              },
            },
          },
          "/b": {
            get: {
              responses: {
                "410": {
                  description: "Gone",
                  content: problems({ gone: ref("gone") }),
                },
              },
            },
          },
        },
        { Gone: catalog("Gone", 404), gone: catalog("gone", 410) },
      ),
    );
    expect(converted.document.errorTypes.map((item) => item.name)).toEqual([
      "Gone",
    ]);
    expect(endpoint(converted, "GET /b").responses[0]?.errors).toEqual([]);
  });
});

describe("error types, more closely", () => {
  it("keep a header named __proto__ as a header", () => {
    const response = {
      description: "Too Many Requests",
      headers: { "proto-header": { schema: { type: "string" } } },
      content: problems({ "slow-down": ref("slow-down") }),
    };
    const doc = docWith(
      {
        "/a": { get: { responses: { "429": response } } },
        "/b": { get: { responses: { "429": response } } },
      },
      { "slow-down": catalog("slow-down", 429) },
    );
    // JSON.parse keeps __proto__ as an own key, as the readers do.
    const converted = convert(
      JSON.parse(
        JSON.stringify(doc).replaceAll('"proto-header"', '"__proto__"'),
      ),
    );
    const [errorType] = converted.document.errorTypes;
    expect(errorType?.name).toBe("slow-down");
    expect(
      Object.hasOwn(
        (errorType?.headers.properties ?? {}) as object,
        "__proto__",
      ),
    ).toBe(true);
  });
});
