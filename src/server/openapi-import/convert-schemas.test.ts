import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_NESTING } from "../../shared/json-schema";
import {
  bodySchema,
  convert,
  doc30,
  doc31,
  type Loose,
  model,
  refusal,
  withBody,
} from "./test-convert";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("models from components.schemas", () => {
  it("makes each schema a model, in document order, and references to them model references", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Pet: {
              type: "object",
              properties: { owner: { $ref: "#/components/schemas/Owner" } },
            },
            Owner: { type: "object", properties: { name: { type: "string" } } },
          },
        },
      }),
    );
    expect(converted.document.models.map((item) => item.name)).toEqual([
      "Pet",
      "Owner",
    ]);
    expect(model(converted, "Pet").schema).toEqual({
      type: "object",
      properties: { owner: { $ref: "#/components/schemas/Owner" } },
    });
    expect(converted.document.models[0]?.schema).toMatchObject({
      properties: { owner: { $ref: expect.stringMatching(/^model:/) } },
    });
  });

  it("takes a model's description out of its schema when it fits, as the export puts it back", () => {
    const long = "x".repeat(2001);
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Pet: { description: "  A pet.\n", type: "object" },
            Essay: { type: "string", description: long },
            Odd: { type: "string", description: 5 },
          },
        },
      }),
    );
    expect(model(converted, "Pet")).toMatchObject({
      description: "A pet.",
      schema: { type: "object" },
    });
    expect(model(converted, "Essay")).toMatchObject({
      description: "",
      schema: { type: "string", description: long },
    });
    expect(model(converted, "Odd").schema).toEqual({
      type: "string",
      description: 5,
    });
  });

  it("renames names the app can't take, telling which, and references follow", () => {
    const long = `Very${"Long".repeat(20)}Name`;
    const converted = convert(
      doc31({
        components: {
          schemas: {
            "Page«User»": { type: "object" },
            User: { type: "object" },
            user: { type: "object" },
            [long]: { type: "object" },
            List: {
              type: "array",
              items: {
                anyOf: [
                  { $ref: "#/components/schemas/Page«User»" },
                  { $ref: "#/components/schemas/user" },
                  { $ref: `#/components/schemas/${long}` },
                ],
              },
            },
          },
        },
      }),
    );
    const names = converted.document.models.map((item) => item.name);
    expect(names).toEqual([
      "Page-User-",
      "User",
      "user-2",
      long.slice(0, 64),
      "List",
    ]);
    expect(model(converted, "List").schema.items.anyOf).toEqual([
      { $ref: "#/components/schemas/Page-User-" },
      { $ref: "#/components/schemas/user-2" },
      { $ref: `#/components/schemas/${long.slice(0, 64)}` },
    ]);
    expect(converted.notices).toContainEqual({
      path: "/components/schemas",
      message: expect.stringMatching(
        /3 models were renamed.*Page«User» → Page-User-.*user → user-2/s,
      ),
    });
  });

  it("points discriminator mappings at renamed models, and writes out the ones renaming would change", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            "Cat Pet": { type: "object" },
            Dog: { type: "object" },
            Pet: {
              oneOf: [
                { $ref: "#/components/schemas/Cat Pet" },
                { $ref: "#/components/schemas/Dog" },
              ],
              discriminator: { propertyName: "kind" },
            },
            Mapped: {
              oneOf: [{ $ref: "#/components/schemas/Cat Pet" }],
              discriminator: {
                propertyName: "kind",
                mapping: { cat: "#/components/schemas/Cat Pet", dog: "Dog" },
              },
            },
          },
        },
      }),
    );
    expect(model(converted, "Pet").schema.discriminator).toEqual({
      propertyName: "kind",
      mapping: { "Cat Pet": "#/components/schemas/Cat-Pet" },
    });
    expect(model(converted, "Mapped").schema.discriminator).toEqual({
      propertyName: "kind",
      mapping: { cat: "#/components/schemas/Cat-Pet", dog: "Dog" },
    });
  });

  it("keeps __proto__ and other prototype names as names, without touching a prototype", () => {
    const schemas = JSON.parse(
      '{"__proto__": {"type": "object", "properties": {"__proto__": {"type": "string"}, "constructor": {"type": "integer"}}, "default": {"__proto__": {"polluted": true}}}}',
    );
    const converted = convert(doc31({ components: { schemas } }));
    expect(converted.document.models.map((item) => item.name)).toEqual([
      "__proto__",
    ]);
    const schema = converted.document.models[0]?.schema as Loose;
    expect(Object.keys(schema.properties)).toEqual([
      "__proto__",
      "constructor",
    ]);
    expect(
      Object.getOwnPropertyDescriptor(schema.properties, "__proto__")?.value,
    ).toEqual({ type: "string" });
    expect(Object.hasOwn(schema.default, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(schema.properties)).toBe(Object.prototype);
    expect(({} as Loose).polluted).toBeUndefined();
    expect(({} as Loose).type).toBeUndefined();
  });

  it("makes boolean schemas objects where the app needs one, and keeps them inside schemas", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Anything: true,
            Nothing: false,
            Closed: { type: "array", items: false },
          },
        },
      }),
    );
    expect(model(converted, "Anything").schema).toEqual({});
    expect(model(converted, "Nothing").schema).toEqual({ not: {} });
    expect(model(converted, "Closed").schema).toEqual({
      type: "array",
      items: false,
    });
  });
});

describe("references", () => {
  it("copies what a pointer into the document refers to, decoding ~0, ~1, and percent escapes", () => {
    const converted = convert(
      doc31({
        paths: {
          "/pets/{id}": {
            get: {
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                },
              ],
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: { "a~b": { type: "integer", minimum: 1 } },
                      },
                    },
                  },
                },
              },
            },
          },
          ...withBody({
            $ref: "#/paths/~1pets~1%7Bid%7D/get/responses/200/content/application~1json/schema/properties/a~0b",
          }),
        },
      }),
    );
    expect(bodySchema(converted)).toEqual({ type: "integer", minimum: 1 });
  });

  it("refuses references to other files and URLs, listing them, and never fetches them", () => {
    const fetching = vi.spyOn(globalThis, "fetch");
    const message = refusal(
      doc31({
        components: {
          schemas: {
            A: { $ref: "./pet.yaml#/Pet" },
            B: { $ref: "https://schemas.example/pet.json" },
            C: { $ref: "file:///etc/passwd" },
          },
        },
      }),
    );
    expect(message).toMatch(/refers to other files.*bundle/is);
    expect(message).toMatch(
      /\/components\/schemas\/A\/\$ref: .*\.\/pet\.yaml#\/Pet/,
    );
    expect(message).toMatch(
      /\/components\/schemas\/B\/\$ref: .*https:\/\/schemas\.example\/pet\.json/,
    );
    expect(message).toMatch(
      /\/components\/schemas\/C\/\$ref: .*file:\/\/\/etc\/passwd/,
    );
    expect(fetching).not.toHaveBeenCalled();
  });

  it("refuses references that point at nothing, prototype names included", () => {
    for (const ref of [
      "#/components/schemas/Missing",
      "#/components/schemas/constructor",
      "#/__proto__/polluted",
      "#/components/schemas/Pet/properties/name/0",
    ]) {
      expect(
        refusal(
          doc31({
            components: {
              schemas: {
                Pet: {
                  type: "object",
                  properties: { name: { type: "string" } },
                },
                Ref: { $ref: ref },
              },
            },
          }),
        ),
        ref,
      ).toMatch(/\/components\/schemas\/Ref\/\$ref.*points at nothing/s);
    }
  });

  it("refuses malformed pointers with their place, instead of throwing", () => {
    for (const ref of [
      "#/components/schemas/%E0%A4%A",
      "#/components/schemas/a~2",
      "#/components/%zz",
    ]) {
      expect(
        refusal(doc31({ components: { schemas: { Ref: { $ref: ref } } } })),
        ref,
      ).toMatch(
        /\/components\/schemas\/Ref\/\$ref.*isn't a valid JSON Pointer/s,
      );
    }
  });

  it("keeps a $ref inside examples, defaults, and other data as data", () => {
    const data = { $ref: "https://schemas.example/registry/thing" };
    const converted = convert(
      doc31({
        paths: withBody({
          type: "object",
          examples: [data],
          default: data,
          enum: [data],
          const: data,
        }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      type: "object",
      examples: [data],
      default: data,
      enum: [data],
      const: data,
    });
  });

  it("converts references where the app looks for them, inside discriminator, xml, and externalDocs too", () => {
    // Found by the fuzz test: copied as data, a $ref there was left raw,
    // and the project file rules refused the whole document.
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Pet: { type: "object" },
            Odd: {
              type: "object",
              externalDocs: { $ref: "#/components/schemas/Pet" },
              xml: { name: "odd", extra: { $ref: "#/components/schemas/Pet" } },
              discriminator: {
                propertyName: "kind",
                "x-default": { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
      }),
    );
    expect(model(converted, "Odd").schema).toEqual({
      type: "object",
      externalDocs: { $ref: "#/components/schemas/Pet" },
      xml: { name: "odd", extra: { $ref: "#/components/schemas/Pet" } },
      discriminator: {
        propertyName: "kind",
        "x-default": { $ref: "#/components/schemas/Pet" },
      },
    });
  });

  it("makes a schema that refers to itself through a pointer into a model", () => {
    const converted = convert(
      doc31({
        paths: {
          "/tree": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: {
                          children: {
                            type: "array",
                            items: {
                              $ref: "#/paths/~1tree/get/responses/200/content/application~1json/schema",
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    const names = converted.document.models.map((item) => item.name);
    expect(names).toEqual(["tree.get.200.application-json"]);
    expect(model(converted, "tree.get.200.application-json").schema).toEqual({
      type: "object",
      properties: {
        children: {
          type: "array",
          items: { $ref: "#/components/schemas/tree.get.200.application-json" },
        },
      },
    });
    // The place the schema is written refers to the model too.
    const tree = converted.document.endpoints[0]?.responses[0]?.body?.schema;
    expect(tree).toEqual({
      $ref:
        converted.document.models[0] &&
        `model:${converted.document.models[0].id}`,
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(
        /refers to itself.*tree\.get\.200\.application-json/s,
      ),
    );
  });

  it("resolves references by $id and by the document's $self", () => {
    const converted = convert({
      openapi: "3.2.0",
      $self: "https://api.example/openapi.yaml",
      info: { title: "Shop", version: "1" },
      components: {
        schemas: {
          User: { $id: "https://api.example/schemas/user", type: "object" },
          Order: {
            $id: "https://api.example/schemas/order",
            type: "object",
            properties: {
              by: { $ref: "user" },
              also: { $ref: "https://api.example/schemas/user" },
              self: {
                $ref: "https://api.example/openapi.yaml#/components/schemas/User",
              },
            },
          },
        },
      },
    });
    expect(model(converted, "Order").schema.properties).toEqual({
      by: { $ref: "#/components/schemas/User" },
      also: { $ref: "#/components/schemas/User" },
      self: { $ref: "#/components/schemas/User" },
    });
  });

  it("names $id when a URL matches none, since the document may only lack one", () => {
    expect(
      refusal(
        doc31({
          components: {
            schemas: { A: { $ref: "https://api.example/schemas/missing" } },
          },
        }),
      ),
    ).toMatch(/\$id/);
  });

  it("keeps #/$defs references that a schema makes to itself, as the app stores them", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Slot: {
              $defs: { time: { type: "string" } },
              properties: { from: { $ref: "#/$defs/time" } },
            },
          },
        },
      }),
    );
    expect(model(converted, "Slot").schema.properties.from).toEqual({
      $ref: "#/$defs/time",
    });
  });

  it("resolves a long chain of references once", () => {
    const parameters: Record<string, unknown> = {
      p0: { name: "q", in: "query", schema: { type: "string" } },
    };
    for (let index = 1; index < 10_000; index++) {
      parameters[`p${index}`] = {
        $ref: `#/components/parameters/p${index - 1}`,
      };
    }
    const paths: Record<string, unknown> = {};
    for (let index = 0; index < 1000; index++) {
      paths[`/things${index}`] = {
        get: {
          parameters: [{ $ref: "#/components/parameters/p9999" }],
          responses: { "200": { description: "OK" } },
        },
      };
    }
    const started = performance.now();
    const converted = convert(doc31({ paths, components: { parameters } }));
    expect(performance.now() - started).toBeLessThan(3000);
    expect(converted.document.endpoints).toHaveLength(1000);
  });

  it("refuses references that come back to themselves outside schemas", () => {
    expect(
      refusal(
        doc31({
          paths: {
            "/a": {
              get: {
                parameters: [{ $ref: "#/components/parameters/A" }],
                responses: { "200": { description: "OK" } },
              },
            },
          },
          components: {
            parameters: {
              A: { $ref: "#/components/parameters/B" },
              B: { $ref: "#/components/parameters/A" },
            },
          },
        }),
      ),
    ).toMatch(/\/components\/parameters\/[AB].*comes back to itself/s);
  });

  it("stops copies that grow past the value budget (a small file that expands exponentially)", () => {
    // Each level refers twice to the level below through pointers, which are
    // copied, not referenced: 2^40 copies of the bottom one.
    const levels: Record<string, unknown> = { L0: { type: "string" } };
    for (let level = 1; level <= 40; level++) {
      const below = {
        $ref: `#/components/schemas/Levels/properties/L${level - 1}`,
      };
      levels[`L${level}`] = {
        type: "object",
        properties: { x: below, y: below },
      };
    }
    const started = performance.now();
    expect(
      refusal(
        doc31({
          components: {
            schemas: { Levels: { type: "object", properties: levels } },
          },
        }),
      ),
    ).toMatch(/more than 1,000,000 values/);
    expect(performance.now() - started).toBeLessThan(5000);
  });

  it("counts what copies add against the value budget, exactly", () => {
    // Each copy of x is its object, its enum, and 998 values: 1,000.
    const document = (copies: number) =>
      doc31({
        components: {
          schemas: {
            Big: {
              type: "object",
              properties: {
                x: { enum: Array.from({ length: 998 }, (_, i) => i) },
              },
            },
          },
        },
        paths: withBody({
          type: "array",
          prefixItems: Array.from({ length: copies }, () => ({
            $ref: "#/components/schemas/Big/properties/x",
          })),
        }),
      });
    expect(bodySchema(convert(document(990))).prefixItems).toHaveLength(990);
    expect(refusal(document(1000))).toMatch(/more than 1,000,000 values/);
  });

  it("refuses a schema that copying references makes deeper than the app saves", () => {
    const wrap = (levels: number, inner: unknown): Loose =>
      levels === 0 ? inner : { type: "array", items: wrap(levels - 1, inner) };
    // Each is shallow enough alone; copied into the other, past the limit.
    expect(
      refusal(
        doc31({
          components: { schemas: { Deep: wrap(200, { type: "string" }) } },
          paths: withBody(
            wrap(60, { $ref: "#/components/schemas/Deep/items" }),
          ),
        }),
      ),
    ).toMatch(new RegExp(`nested more than ${MAX_NESTING} levels`));
  });
});

describe("OpenAPI 3.0 schemas, converted to JSON Schema 2020-12", () => {
  function only(schema: unknown) {
    return doc30({ paths: withBody(schema) });
  }

  it("turns nullable with a type into a null type, and leaves enum as 3.0.3 reads it", () => {
    const converted = convert(
      only({
        type: "object",
        properties: {
          a: { type: "string", nullable: true },
          b: { type: "string", nullable: true, enum: ["x", "y"] },
          c: { type: "string", nullable: false },
        },
      }),
    );
    expect(bodySchema(converted).properties).toEqual({
      a: { type: ["string", "null"] },
      b: { type: ["string", "null"], enum: ["x", "y"] },
      c: { type: "string" },
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/enum.*without null.*doesn't allow null/s),
    );
  });

  it("drops nullable without a type, which 3.0.3 says has no effect, and says how to allow null", () => {
    const converted = convert(
      doc30({
        components: { schemas: { Address: { type: "object" } } },
        paths: withBody({
          allOf: [{ $ref: "#/components/schemas/Address" }],
          nullable: true,
        }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      allOf: [{ $ref: "#/components/schemas/Address" }],
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/nullable.*without type.*no effect.*type: "null"/s),
    );
  });

  it("turns boolean exclusive bounds into numbers, and drops them without a bound", () => {
    const converted = convert(
      only({
        type: "object",
        properties: {
          a: { type: "number", minimum: 0, exclusiveMinimum: true },
          b: { type: "number", maximum: 100, exclusiveMaximum: false },
          c: { type: "number", exclusiveMinimum: true },
        },
      }),
    );
    expect(bodySchema(converted).properties).toEqual({
      a: { type: "number", exclusiveMinimum: 0 },
      b: { type: "number", maximum: 100 },
      c: { type: "number" },
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/exclusiveMinimum: true without minimum/),
    );
  });

  it("turns example into examples", () => {
    expect(
      bodySchema(convert(only({ type: "string", example: "Rex" }))),
    ).toEqual({ type: "string", examples: ["Rex"] });
  });

  it("keeps only annotations beside a $ref, since 3.0 ignores its siblings", () => {
    const converted = convert(
      doc30({
        components: { schemas: { Pet: { type: "object" } } },
        paths: withBody({
          $ref: "#/components/schemas/Pet",
          description: "The pet",
          readOnly: true,
          maxLength: 3,
          example: { id: 1 },
        }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      $ref: "#/components/schemas/Pet",
      description: "The pet",
      readOnly: true,
      examples: [{ id: 1 }],
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/beside a \$ref.*maxLength/s),
    );
  });

  it("keeps keywords 3.0 doesn't have, as JSON Schema 2020-12 reads them, and says so", () => {
    const converted = convert(only({ type: "string", const: "a" }));
    expect(bodySchema(converted)).toEqual({ type: "string", const: "a" });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/OpenAPI 3\.0 doesn't have.*const/s),
    );
  });

  it("drops $schema, which 3.0 schemas don't have", () => {
    const converted = convert(
      only({
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "string",
      }),
    );
    expect(bodySchema(converted)).toEqual({ type: "string" });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/\$schema/),
    );
  });
});

describe("OpenAPI 3.1 schemas", () => {
  it("are taken as they are, $ref siblings included", () => {
    const converted = convert(
      doc31({
        components: { schemas: { Pet: { type: "object" } } },
        paths: withBody({
          $ref: "#/components/schemas/Pet",
          description: "The pet",
          maxProperties: 3,
          type: ["object", "null"],
        }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      $ref: "#/components/schemas/Pet",
      description: "The pet",
      maxProperties: 3,
      type: ["object", "null"],
    });
  });

  it("keep a $schema naming 2020-12 or OpenAPI's dialect, and say the Export tab lists other dialects", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            A: {
              $schema: "https://json-schema.org/draft/2020-12/schema",
              type: "string",
            },
            B: {
              $schema: "https://spec.openapis.org/oas/3.1/dialect/base",
              type: "string",
            },
            C: {
              $schema: "http://json-schema.org/draft-07/schema#",
              type: "string",
            },
          },
        },
      }),
    );
    expect(model(converted, "A").schema).toEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "string",
    });
    expect(model(converted, "B").schema).toEqual({
      $schema: "https://spec.openapis.org/oas/3.1/dialect/base",
      type: "string",
    });
    expect(model(converted, "C").schema).toEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "string",
    });
    expect(
      converted.messages.filter((message) => message.includes("$schema")),
    ).toEqual([
      expect.stringMatching(
        /1 schema says it's draft-07, not JSON Schema 2020-12.*Export tab lists it/s,
      ),
    ]);
  });

  it("keep nullable, which isn't a 3.1 keyword, and say it has no effect", () => {
    const converted = convert(
      doc31({ paths: withBody({ type: "string", nullable: true }) }),
    );
    expect(bodySchema(converted)).toEqual({ type: "string", nullable: true });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/nullable isn't a keyword of OpenAPI 3\.1/),
    );
  });
});

describe("schemas that aren't quite what they should be", () => {
  it("keep a $ref and an allOf beside it, the copy first, in either order", () => {
    const target = {
      type: "integer",
      minimum: 1,
    };
    for (const schema of [
      {
        $ref: "#/components/schemas/A/properties/id",
        allOf: [{ maximum: 10 }],
      },
      {
        allOf: [{ maximum: 10 }],
        $ref: "#/components/schemas/A/properties/id",
      },
    ]) {
      const converted = convert(
        doc31({
          components: {
            schemas: { A: { properties: { id: target } } },
          },
          paths: withBody(schema),
        }),
      );
      expect(bodySchema(converted)).toEqual({
        allOf: [{ type: "integer", minimum: 1 }, { maximum: 10 }],
      });
    }
    // An allOf that isn't a list is kept, inside, for the Export tab to name.
    const converted = convert(
      doc31({
        components: { schemas: { A: { properties: { id: target } } } },
        paths: withBody({
          $ref: "#/components/schemas/A/properties/id",
          allOf: { maximum: 10 },
        }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      allOf: [{ type: "integer", minimum: 1 }, { allOf: { maximum: 10 } }],
    });
  });

  it("say so when a 3.1 schema has OpenAPI 3.0's boolean bounds, which become 3.1's", () => {
    const converted = convert(
      doc31({
        paths: withBody({ type: "number", minimum: 0, exclusiveMinimum: true }),
      }),
    );
    expect(bodySchema(converted)).toEqual({
      type: "number",
      exclusiveMinimum: 0,
    });
    expect(converted.messages.join("\n")).toMatch(
      /1 schema had a true or false bound as OpenAPI 3\.0 writes them \(exclusiveMinimum: true with minimum: 0 → exclusiveMinimum: 0\); OpenAPI 3\.1 gives the bound itself as its value, so it was rewritten that way/,
    );
  });

  it("keep a $schema that isn't a URI in 3.1, for the Export tab to list, and drop any $schema in 3.0", () => {
    const converted = convert(
      doc31({
        components: { schemas: { A: { $schema: 5, type: "object" } } },
      }),
    );
    expect(model(converted, "A").schema).toEqual({
      $schema: 5,
      type: "object",
    });
    expect(converted.messages.join("\n")).toMatch(
      /1 schema has a \$schema that isn't a URI \(5\): the Export tab lists it until \$schema is removed/,
    );
    const old = convert(
      doc30({
        components: { schemas: { A: { $schema: { x: 1 }, type: "object" } } },
      }),
    );
    expect(model(old, "A").schema).toEqual({ type: "object" });
    expect(old.messages.join("\n")).toMatch(
      /\$schema was left out of 1 schema/,
    );
  });

  it("read discriminator references with percent escapes, and refuse broken ones rather than fail", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            "My Pet": { type: "object" },
            Pets: {
              oneOf: [{ $ref: "#/components/schemas/My%20Pet" }],
              discriminator: {
                propertyName: "kind",
                mapping: { pet: "#/components/schemas/My%20Pet" },
              },
            },
          },
        },
      }),
    );
    expect(model(converted, "Pets").schema.discriminator).toEqual({
      propertyName: "kind",
      mapping: { pet: "#/components/schemas/My-Pet" },
    });
    expect(
      refusal(
        doc31({
          components: {
            schemas: {
              Pets: {
                discriminator: { propertyName: "k" },
                oneOf: [{ $ref: "#/components/schemas/%" }],
              },
            },
          },
        }),
      ),
    ).toMatch(
      /\/components\/schemas\/Pets\/oneOf\/0\/\$ref: #\/components\/schemas\/% isn't a valid JSON Pointer/,
    );
  });
});

describe("references in schemas that aren't quite schemas", () => {
  it("are converted where the app finds them: in a list where a schema should be, and in maps by name, never in data", () => {
    const converted = convert(
      doc31({
        components: {
          schemas: {
            Book: { type: "object" },
            Odd: {
              type: "object",
              properties: { list: [{ $ref: "#/components/schemas/Book" }] },
              "x-meta": {
                examples: [{ $ref: "#/components/schemas/Book" }],
                properties: {
                  examples: { $ref: "#/components/schemas/Book" },
                },
              },
            },
          },
        },
      }),
    );
    const book = converted.document.models.find((item) => item.name === "Book");
    const odd = converted.document.models.find((item) => item.name === "Odd");
    expect(odd?.schema).toEqual({
      type: "object",
      properties: { list: [{ $ref: `model:${book?.id}` }] },
      "x-meta": {
        examples: [{ $ref: "#/components/schemas/Book" }],
        properties: { examples: { $ref: `model:${book?.id}` } },
      },
    });
  });
});

describe("notices of parts copied in more than once", () => {
  it("count each place once, however often it's copied", () => {
    const body = (schema: unknown) => ({
      get: {
        responses: {
          "200": {
            description: "OK",
            content: { "application/json": { schema } },
          },
          "400": { $ref: "#/components/responses/Bad" },
        },
      },
    });
    const converted = convert(
      doc31({
        components: {
          schemas: {
            A: {
              type: "object",
              properties: { x: { type: "string", nullable: true } },
            },
          },
          responses: { Bad: { description: "Bad", odd: true } },
        },
        paths: {
          "/a": body({ $ref: "#/components/schemas/A/properties/x" }),
          "/b": body({ $ref: "#/components/schemas/A/properties/x" }),
        },
      }),
    );
    const messages = converted.messages.join("\n");
    expect(messages).toMatch(/no effect in 1 schema;/);
    expect(messages).toMatch(
      /Fields the app doesn't keep from a response were left out \(1 place: odd\)/,
    );
  });
});
