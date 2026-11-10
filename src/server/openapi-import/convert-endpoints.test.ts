import { describe, expect, it, vi } from "vitest";
import {
  compareEndpoints,
  type HttpMethod,
  suggestOperationId,
} from "../../shared/endpoints";
import { buildOpenApi } from "../export/openapi";
import { convertOpenApi } from "./convert";
import {
  convert,
  doc30,
  doc31,
  endpoint,
  exportInputOf,
  type Loose,
  readable,
  refusal,
  withBody,
} from "./test-convert";

/**
 * Which operation IDs to empty, as the import first worked it out: empty
 * every one that looks derived, then keep the first that the export gives
 * another, and again until none does. It's quadratic, so the import does
 * it in one pass. Where every operation has an ID, that's the same; where
 * one without passes over another's, this kept what it emptied too early
 * for good, and the pass keeps fewer.
 */
function fixpoint(
  endpoints: {
    id: string;
    method: HttpMethod;
    path: string;
    operationId: string;
  }[],
) {
  const sorted = [...endpoints].sort(compareEndpoints);
  const derivable = new Set(
    sorted
      .filter((item) => {
        const base = suggestOperationId(item.method, item.path);
        return (
          item.operationId.startsWith(base) &&
          /^(?:|[2-9]|[1-9][0-9]+)$/.test(item.operationId.slice(base.length))
        );
      })
      .map((item) => item.id),
  );
  for (let changed = true; changed; ) {
    changed = false;
    const used = new Set(
      sorted
        .filter((item) => item.operationId !== "" && !derivable.has(item.id))
        .map((item) => item.operationId),
    );
    for (const item of sorted) {
      if (item.operationId !== "" && !derivable.has(item.id)) continue;
      const base = suggestOperationId(item.method, item.path);
      let id = base;
      for (let n = 2; used.has(id); n++) id = `${base}${n}`;
      used.add(id);
      if (derivable.has(item.id) && id !== item.operationId) {
        derivable.delete(item.id);
        changed = true;
        break;
      }
    }
  }
  return Object.fromEntries(
    endpoints.map((item) => [
      `${item.method} ${item.path}`,
      derivable.has(item.id) ? "" : item.operationId,
    ]),
  );
}

/** mulberry32, for documents that are the same on every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** One operation at GET /things (or `method path`). */
function one(
  operation: Loose,
  { path = "/things", method = "get", parts = {} as Loose } = {},
) {
  return doc31({ paths: { [path]: { [method]: operation } }, ...parts });
}

const ok = { "200": { description: "OK" } };

describe("versions", () => {
  it("reads OpenAPI 3.0, 3.1, and 3.2", () => {
    for (const openapi of ["3.0.0", "3.0.4", "3.1.0", "3.1.1", "3.2.0"]) {
      expect(
        convert({ openapi, info: { title: "A", version: "1" } }).document
          .project.name,
        openapi,
      ).toBe("A");
    }
  });

  it("refuses Swagger 2.0, saying how to convert it", () => {
    expect(
      refusal({ swagger: "2.0", info: { title: "A", version: "1" } }),
    ).toMatch(/Swagger 2\.0 document.*Convert it to OpenAPI 3 first/);
  });

  it("refuses other versions, a version that isn't text, and documents that aren't OpenAPI", () => {
    expect(refusal({ openapi: "4.0.0", info: {} })).toMatch(
      /OpenAPI 4\.0\.0.*reads OpenAPI 3\.0, 3\.1, and 3\.2/,
    );
    expect(refusal({ openapi: "3.1", info: {} })).toMatch(/reads OpenAPI 3\.0/);
    expect(refusal({ openapi: 3.1, info: {} })).toMatch(/version as text/);
    expect(refusal({ asyncapi: "3.0.0" })).toMatch(/no openapi field/);
    expect(refusal({ format: "api-contract-builder/project" })).toMatch(
      /project\.json.*\.project\.zip/,
    );
    expect(refusal([1, 2])).toMatch(
      /isn't a project file \(\.project\.zip\) or an OpenAPI document \(JSON or YAML\)/,
    );
    expect(refusal("not a zip")).toMatch(/isn't a project file/);
  });
});

describe("the project", () => {
  it("takes its name, version, and description from info", () => {
    const { document } = convert(
      doc31({
        info: {
          title: "  Pet Store ",
          version: "2.0.1",
          description: "Pets.\n",
        },
      }),
    );
    expect(document.project).toMatchObject({
      name: "Pet Store",
      slug: "pet-store",
      apiVersion: "2.0.1",
      description: "Pets.",
      defaultSecuritySchemeId: null,
    });
  });

  it("takes a YAML number as the text it's written as", () => {
    const info = { title: 2026, version: 1 };
    const texts = new Map<string, string>([
      ["title", "2026"],
      ["version", "1.0"],
    ]);
    const converted = convert({ openapi: "3.1.0", info }, (container, key) =>
      container === info ? texts.get(String(key)) : undefined,
    );
    expect(converted.document.project).toMatchObject({
      name: "2026",
      apiVersion: "1.0",
    });
  });

  it("names a project with no title, gives a slug to a title without letters, and shortens long texts", () => {
    expect(
      convert({ openapi: "3.1.0", info: { version: "1" } }).document.project
        .name,
    ).toBe("Imported API");
    const unicode = convert(
      doc31({ info: { title: "用户服务", version: "1" } }),
    );
    expect(unicode.document.project).toMatchObject({
      name: "用户服务",
      slug: "project",
    });
    const long = convert(
      doc31({
        info: {
          title: "T".repeat(150),
          version: "1",
          description: "d".repeat(3000),
        },
      }),
    );
    expect(long.document.project.name).toHaveLength(100);
    expect(long.document.project.description).toHaveLength(2000);
    expect(long.messages).toContainEqual(
      expect.stringMatching(/shortened.*info\.title.*info\.description/s),
    );
  });

  it("reports parts of info it can't keep", () => {
    const { messages } = convert(
      doc31({
        info: {
          title: "A",
          version: "1",
          summary: "s",
          contact: { name: "c" },
          license: { name: "MIT" },
        },
      }),
    );
    expect(messages).toContainEqual(
      expect.stringMatching(
        /these parts of info.*summary, contact, and license/,
      ),
    );
  });
});

describe("servers", () => {
  it("splits this app's 'Name — description', and names others by their description or host", () => {
    const { document } = convert(
      doc31({
        servers: [
          {
            url: "https://api.example/v1",
            description: "Staging — Reset every night.",
          },
          { url: "https://eu.api.example", description: "Production" },
          {
            url: "https://other.example",
            description:
              "A server whose description is far too long to be a name",
          },
          { url: "/v1" },
        ],
      }),
    );
    expect(
      document.project.servers.map(({ name, url, description }) => ({
        name,
        url,
        description,
      })),
    ).toEqual([
      {
        name: "Staging",
        url: "https://api.example/v1",
        description: "Reset every night.",
      },
      { name: "Production", url: "https://eu.api.example", description: "" },
      {
        name: "other.example",
        url: "https://other.example",
        description: "A server whose description is far too long to be a name",
      },
      { name: "Server 4", url: "/v1", description: "" },
    ]);
  });

  it("takes a 3.2 server's name", () => {
    const { document } = convert({
      openapi: "3.2.0",
      info: { title: "A", version: "1" },
      servers: [
        {
          name: "Production",
          url: "https://api.example",
          description: "Main region",
        },
      ],
    });
    expect(document.project.servers[0]).toMatchObject({
      name: "Production",
      description: "Main region",
    });
  });

  it("fills URL variables in with their defaults, and leaves out URLs the app can't take", () => {
    const converted = convert(
      doc31({
        servers: [
          {
            url: "https://{region}.api.example/{version}",
            variables: {
              region: { default: "eu", enum: ["eu", "us"] },
              version: { default: "v2" },
            },
          },
          { url: "relative/path" },
        ],
      }),
    );
    expect(
      converted.document.project.servers.map((server) => server.url),
    ).toEqual(["https://eu.api.example/v2"]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/defaults.*region: us/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/absolute http\(s\) URL.*relative\/path/s),
    );
  });
});

describe("security", () => {
  const schemes = {
    components: {
      securitySchemes: {
        bearer: {
          type: "http",
          scheme: "Bearer",
          bearerFormat: "JWT",
          description: "A token",
        },
        basic: { type: "http", scheme: "basic" },
        key: { type: "apiKey", in: "header", name: "X-Key" },
        cookie: { type: "apiKey", in: "cookie", name: "sid" },
        oauth: {
          type: "oauth2",
          flows: {
            clientCredentials: {
              tokenUrl: "https://auth.example/token",
              scopes: { read: "Read" },
            },
          },
        },
        digest: { type: "http", scheme: "digest" },
        mtls: { type: "mutualTLS" },
      },
    },
  };

  it("keeps bearer, basic, and API key schemes, makes OAuth 2.0 bearer, and reports the others", () => {
    const converted = convert(doc31(schemes));
    expect(converted.document.project.securitySchemes).toEqual([
      {
        id: "bearer",
        key: "bearer",
        type: "bearer",
        bearerFormat: "JWT",
        description: "A token",
      },
      { id: "basic", key: "basic", type: "basic", description: "" },
      {
        id: "key",
        key: "key",
        type: "apiKey",
        in: "header",
        name: "X-Key",
        description: "",
      },
      {
        id: "cookie",
        key: "cookie",
        type: "apiKey",
        in: "cookie",
        name: "sid",
        description: "",
      },
      {
        id: "oauth",
        key: "oauth",
        type: "bearer",
        bearerFormat: "",
        description:
          "OAuth 2.0\nclientCredentials: tokenUrl https://auth.example/token; scopes read",
      },
    ]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/no counterpart.*digest.*mtls/s),
    );
  });

  it("makes a single top-level requirement the default, and maps each operation's", () => {
    const converted = convert(
      doc31({
        ...schemes,
        security: [{ bearer: [] }],
        paths: {
          "/a": {
            get: { responses: ok },
            post: { security: [], responses: ok },
            put: { security: [{ key: [] }, { basic: [] }], responses: ok },
            patch: { security: [{ oauth: ["read"] }], responses: ok },
            delete: { security: [{ key: [], basic: [] }], responses: ok },
            head: { security: [{}, { bearer: [] }], responses: ok },
            options: { security: [{ mtls: [] }], responses: ok },
          },
        },
      }),
    );
    expect(converted.document.project.defaultSecuritySchemeId).toBe("bearer");
    const security = (label: string) => endpoint(converted, label).security;
    expect(security("GET /a")).toEqual({ type: "default" });
    expect(security("POST /a")).toEqual({ type: "none" });
    expect(security("PUT /a")).toEqual({
      type: "schemes",
      schemeIds: ["key", "basic"],
    });
    expect(security("PATCH /a")).toEqual({
      type: "schemes",
      schemeIds: ["oauth"],
    });
    expect(security("DELETE /a")).toEqual({
      type: "schemes",
      schemeIds: ["key"],
    });
    expect(security("HEAD /a")).toEqual({
      type: "schemes",
      schemeIds: ["bearer"],
    });
    expect(security("OPTIONS /a")).toEqual({ type: "none" });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/Scopes aren't kept.*oauth: read/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/several schemes together.*key and basic/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/optional/),
    );
  });

  it("gives every operation the requirement when the top level has several alternatives", () => {
    const converted = convert(
      doc31({
        ...schemes,
        security: [{ bearer: [] }, { key: [] }],
        paths: { "/a": { get: { responses: ok } } },
      }),
    );
    expect(converted.document.project.defaultSecuritySchemeId).toBeNull();
    expect(endpoint(converted, "GET /a").security).toEqual({
      type: "schemes",
      schemeIds: ["bearer", "key"],
    });
  });
});

describe("endpoints", () => {
  it("makes one endpoint per operation, with its texts, status, and notes", () => {
    const converted = convert(
      one({
        operationId: "listThings",
        summary: "List things",
        description: "All of them.",
        deprecated: true,
        "x-status": "agreed",
        "x-notes-fe": "Cache it.",
        "x-notes-be": "Page it.",
        responses: ok,
      }),
    );
    expect(endpoint(converted, "GET /things")).toMatchObject({
      operationId: "listThings",
      summary: "List things",
      description: "All of them.",
      deprecated: true,
      status: "agreed",
      notesFe: "Cache it.",
      notesBe: "Page it.",
      security: { type: "default" },
      requestBody: null,
    });
  });

  it("changes operation IDs the app can't take, keeping them unique", () => {
    const converted = convert(
      doc31({
        paths: {
          "/a": {
            get: { operationId: "repos/get-content", responses: ok },
            post: { operationId: "repos_get_content", responses: ok },
          },
          "/b": {
            get: { operationId: "2fa", responses: ok },
            post: { operationId: "x".repeat(120), responses: ok },
          },
        },
      }),
    );
    expect(
      converted.document.endpoints.map((item) => item.operationId),
    ).toEqual([
      "repos_get_content",
      "repos_get_content_2",
      "_2fa",
      "x".repeat(100),
    ]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(
        /operation IDs were changed.*repos\/get-content → repos_get_content/s,
      ),
    );
  });

  it("leaves out operations the app has no method for, paths it can't take, and repeated paths", () => {
    const converted = convert(
      doc31({
        paths: {
          "/a": { trace: { responses: ok }, get: { responses: ok } },
          "/a b": { get: { responses: ok } },
          "/items/{id}": {
            get: {
              parameters: [{ name: "id", in: "path", required: true }],
              responses: ok,
            },
          },
          "/items/{itemId}": {
            get: {
              parameters: [{ name: "itemId", in: "path", required: true }],
              responses: ok,
            },
          },
        },
      }),
    );
    expect(
      converted.document.endpoints.map((item) => `${item.method} ${item.path}`),
    ).toEqual(["GET /a", "GET /items/{id}"]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/no operation like this.*TRACE \/a/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/path the app can't take.*\/a b/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(
        /differs from another only in parameter names.*\/items\/\{itemId\}/s,
      ),
    );
  });

  it("leaves out operation IDs the export derives the same way, so they follow later path changes", () => {
    const converted = convert(
      doc31({
        paths: {
          "/stock-items/{itemId}": {
            get: { operationId: "getStockItemsByItemId", responses: ok },
            patch: { operationId: "updateItem", responses: ok },
          },
          // Both suggest getAB; the export numbers the second.
          "/a-b": { get: { operationId: "getAB", responses: ok } },
          "/a_b": { get: { operationId: "getAB2", responses: ok } },
          // Swapped: deriving /c-d would change it, so it stays, and then
          // /c_d derives its own.
          "/c-d": { get: { operationId: "getCD2", responses: ok } },
          "/c_d": { get: { operationId: "getCD", responses: ok } },
          "/none": { get: { responses: ok } },
        },
      }),
    );
    expect(
      Object.fromEntries(
        converted.document.endpoints.map((item) => [
          `${item.method} ${item.path}`,
          item.operationId,
        ]),
      ),
    ).toEqual({
      "GET /stock-items/{itemId}": "",
      "PATCH /stock-items/{itemId}": "updateItem",
      "GET /a-b": "",
      "GET /a_b": "",
      "GET /c-d": "getCD2",
      "GET /c_d": "",
      "GET /none": "",
    });
  });

  it("empties the operation IDs that emptying all and keeping the first that changes, again and again, empties, and the export gives every one back", () => {
    // Paths whose suggested IDs are alike, or one another's with a number.
    const paths = ["/a", "/a-", "/a.", "/a_", "/a1", "/a12", "/b", "/b-"];
    const methods: HttpMethod[] = ["GET", "POST"];
    let compared = 0;
    for (let seed = 1; seed <= 4_000; seed++) {
      const next = random(seed);
      const pick = <T>(items: T[]) =>
        items[Math.floor(next() * items.length)] as T;
      const taken = new Set<string>();
      const items: {
        id: string;
        method: HttpMethod;
        path: string;
        operationId: string;
      }[] = [];
      for (const path of paths) {
        for (const method of methods) {
          if (next() < 0.4) continue;
          const base = suggestOperationId(method, path);
          const other = suggestOperationId(pick(methods), pick(paths));
          let operationId = pick([
            ...(seed % 2 === 0 ? ["", ""] : []),
            base,
            `${base}2`,
            `${base}3`,
            `${other}`,
            `${other}2`,
            `${base}12`,
          ]);
          if (taken.has(operationId)) operationId = "";
          if (operationId !== "") taken.add(operationId);
          items.push({ id: `e${items.length}`, method, path, operationId });
        }
      }
      const doc = doc31({
        paths: Object.fromEntries(
          paths.map((path) => [
            path,
            Object.fromEntries(
              items
                .filter((item) => item.path === path)
                .map((item) => [
                  item.method.toLowerCase(),
                  {
                    ...(item.operationId
                      ? { operationId: item.operationId }
                      : {}),
                    responses: ok,
                  },
                ]),
            ),
          ]),
        ),
      });
      const converted = convert(doc);
      const emptied = Object.fromEntries(
        converted.document.endpoints.map((item) => [
          `${item.method} ${item.path}`,
          item.operationId,
        ]),
      );
      if (items.every((item) => item.operationId !== "")) {
        compared++;
        expect(emptied, `seed ${seed}`).toEqual(fixpoint(items));
      }
      // Every ID the document gives comes back from the export.
      const exported = buildOpenApi(exportInputOf(converted.document), {});
      for (const item of items) {
        if (item.operationId === "") continue;
        expect(
          exported.paths[item.path]?.[
            item.method.toLowerCase() as "get" | "post"
          ]?.operationId,
          `seed ${seed}: ${item.method} ${item.path}`,
        ).toBe(item.operationId);
      }
    }
    expect(compared).toBeGreaterThan(200);
  });

  it("drops a body from GET and HEAD, and fills in a response the app needs", () => {
    const converted = convert(
      one({
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
      }),
    );
    const found = endpoint(converted, "GET /things");
    expect(found.requestBody).toBeNull();
    expect(found.responses).toEqual([
      {
        id: "r-default",
        status: "default",
        description: "Response",
        headers: { type: "object", properties: {} },
        body: null,
        errors: [],
      },
    ]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/can't have a body/),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/got a default response/),
    );
  });
});

describe("parameters", () => {
  it("makes one property per parameter, path ones in template order, with descriptions and examples in the schema", () => {
    const converted = convert(
      doc31({
        components: {
          parameters: {
            Page: {
              name: "page",
              in: "query",
              schema: { type: "integer", minimum: 1 },
              example: 2,
            },
          },
        },
        paths: {
          "/shops/{shop}/items/{item}": {
            parameters: [
              {
                name: "item",
                in: "path",
                required: true,
                schema: { type: "integer" },
              },
              {
                name: "shop",
                in: "path",
                required: true,
                description: "The shop",
                schema: { type: "string" },
              },
              { name: "q", in: "query", schema: { type: "string" } },
            ],
            get: {
              parameters: [
                { $ref: "#/components/parameters/Page" },
                {
                  name: "q",
                  in: "query",
                  required: true,
                  deprecated: true,
                  schema: { type: "string", maxLength: 20 },
                },
                {
                  name: "X-Trace",
                  in: "header",
                  schema: { type: "string" },
                  examples: { one: { value: "abc" } },
                },
              ],
              responses: ok,
            },
          },
        },
      }),
    );
    const { parameters } = endpoint(
      converted,
      "GET /shops/{shop}/items/{item}",
    );
    expect(parameters.path).toEqual({
      type: "object",
      properties: {
        shop: { type: "string", description: "The shop" },
        item: { type: "integer" },
      },
      required: ["shop", "item"],
    });
    expect(parameters.query).toEqual({
      type: "object",
      properties: {
        q: { type: "string", maxLength: 20, deprecated: true },
        page: { type: "integer", minimum: 1, examples: [2] },
      },
      required: ["q"],
    });
    expect(parameters.header).toEqual({
      type: "object",
      properties: { "X-Trace": { type: "string", examples: ["abc"] } },
    });
  });

  it("reports what parameters lose: cookies, ignored headers, serialization, and missing or extra path parameters", () => {
    const converted = convert(
      one(
        {
          parameters: [
            { name: "sid", in: "cookie", schema: { type: "string" } },
            { name: "Authorization", in: "header", schema: { type: "string" } },
            {
              name: "ids",
              in: "query",
              style: "form",
              explode: false,
              schema: { type: "array", items: { type: "string" } },
            },
            {
              name: "extra",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: ok,
        },
        { path: "/things/{id}" },
      ),
    );
    const found = endpoint(converted, "GET /things/{id}");
    expect(found.parameters.path).toEqual({
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    });
    expect(Object.keys(found.parameters.query.properties as object)).toEqual([
      "ids",
    ]);
    for (const pattern of [
      /Cookie parameters.*sid/s,
      /Authorization.*OpenAPI ignores/s,
      /serialization.*ids/s,
      /no definition.*\{id\}/s,
      /not in its path.*extra/s,
    ]) {
      expect(converted.messages).toContainEqual(expect.stringMatching(pattern));
    }
  });

  it("keeps the first of two header parameters whose names differ only in case", () => {
    const converted = convert(
      one({
        parameters: [
          { name: "X-Id", in: "header", schema: { type: "string" } },
          { name: "x-id", in: "header", schema: { type: "integer" } },
        ],
        responses: ok,
      }),
    );
    expect(
      Object.keys(
        endpoint(converted, "GET /things").parameters.header
          .properties as object,
      ),
    ).toEqual(["X-Id"]);
  });

  it("takes the schema of a parameter described by a media type", () => {
    const converted = convert(
      one({
        parameters: [
          {
            name: "filter",
            in: "query",
            content: { "application/json": { schema: { type: "object" } } },
          },
        ],
        responses: ok,
      }),
    );
    expect(
      endpoint(converted, "GET /things").parameters.query.properties,
    ).toEqual({ filter: { type: "object" } });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/media type keeps only its schema.*filter/s),
    );
  });

  it("turns boolean parameter schemas into objects, so false doesn't become anything", () => {
    const converted = convert(
      one({
        parameters: [
          { name: "never", in: "query", schema: false },
          { name: "any", in: "query", schema: true },
        ],
        responses: ok,
      }),
    );
    expect(
      endpoint(converted, "GET /things").parameters.query.properties,
    ).toEqual({ never: { not: {} }, any: {} });
  });
});

describe("bodies and examples", () => {
  it("keeps one media type, JSON first, and named examples with their summaries", () => {
    const converted = convert(
      one(
        {
          requestBody: {
            required: true,
            description: "The thing",
            content: {
              "application/xml": { schema: { type: "object" } },
              "application/vnd.thing+json": { schema: { type: "object" } },
              "application/json; charset=utf-8": {
                schema: { type: "object" },
                examples: {
                  small: { summary: "A small one", value: { size: 1 } },
                  "a big one": { value: { size: 100 }, description: "Big" },
                  remote: { externalValue: "https://example.com/thing.json" },
                  empty: { summary: "No value" },
                },
              },
            },
          },
          responses: ok,
        },
        { method: "post" },
      ),
    );
    expect(endpoint(converted, "POST /things").requestBody).toEqual({
      contentType: "application/json; charset=utf-8",
      schema: { type: "object" },
      examples: [
        { id: "x1", name: "small", summary: "A small one", value: { size: 1 } },
        { id: "x2", name: "a-big-one", summary: "", value: { size: 100 } },
      ],
      required: true,
      description: "The thing",
    });
    for (const pattern of [
      /one media type.*application\/xml, application\/vnd\.thing\+json/s,
      /renamed.*a big one → a-big-one/s,
      /no description.*a big one/s,
      /left out.*remote.*another file.*empty.*no value/s,
    ]) {
      expect(converted.messages).toContainEqual(expect.stringMatching(pattern));
    }
  });

  it("makes a single example one named example, and keeps 20", () => {
    const examples = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [`e${i}`, { value: i }]),
    );
    const converted = convert(
      doc31({
        paths: {
          "/one": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: { "application/json": { example: { a: 1 } } },
                },
              },
            },
          },
          "/many": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  content: { "application/json": { examples } },
                },
              },
            },
          },
        },
      }),
    );
    expect(
      endpoint(converted, "GET /one").responses[0]?.body?.examples,
    ).toEqual([{ id: "x1", name: "example", summary: "", value: { a: 1 } }]);
    expect(
      endpoint(converted, "GET /many").responses[0]?.body?.examples,
    ).toHaveLength(20);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/keeps 20 examples.*5 more/s),
    );
  });

  it("takes a 3.2 example's dataValue", () => {
    const converted = convert({
      openapi: "3.2.0",
      info: { title: "A", version: "1" },
      paths: {
        "/a": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    examples: {
                      one: { dataValue: [1], serializedValue: "[1]" },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(endpoint(converted, "GET /a").responses[0]?.body?.examples).toEqual([
      { id: "x1", name: "one", summary: "", value: [1] },
    ]);
  });
});

describe("responses", () => {
  it("keeps statuses, ranges, and default, with descriptions, headers, and a body", () => {
    const converted = convert(
      doc31({
        components: {
          headers: {
            Limit: {
              description: "Requests left",
              required: true,
              schema: { type: "integer" },
            },
          },
        },
        paths: {
          "/a": {
            get: {
              responses: {
                "200": {
                  description: "OK",
                  headers: {
                    "X-Limit": { $ref: "#/components/headers/Limit" },
                    "x-limit": { schema: { type: "string" } },
                    "Content-Type": { schema: { type: "string" } },
                  },
                  content: {
                    "application/json": { schema: { type: "array" } },
                  },
                },
                "4xx": { description: "Client error" },
                default: { description: "Other" },
              },
            },
          },
        },
      }),
    );
    expect(endpoint(converted, "GET /a").responses).toEqual([
      {
        id: "r-200",
        status: "200",
        description: "OK",
        headers: {
          type: "object",
          properties: {
            "X-Limit": { type: "integer", description: "Requests left" },
          },
          required: ["X-Limit"],
        },
        body: {
          contentType: "application/json",
          schema: { type: "array" },
          examples: [],
        },
        errors: [],
      },
      {
        id: "r-4XX",
        status: "4XX",
        description: "Client error",
        headers: { type: "object", properties: {} },
        body: null,
        errors: [],
      },
      {
        id: "r-default",
        status: "default",
        description: "Other",
        headers: { type: "object", properties: {} },
        body: null,
        errors: [],
      },
    ]);
    for (const pattern of [
      /capitals.*4xx → 4XX/s,
      /ignore case.*x-limit/s,
      /Content-Type response headers/,
    ]) {
      expect(converted.messages).toContainEqual(expect.stringMatching(pattern));
    }
  });

  it("gives a response without a description one from its status, for every status", () => {
    const responses = Object.fromEntries(
      ["101", "200", "203", "304", "418", "451", "2XX", "5XX", "default"].map(
        (status) => [status, { description: "" }],
      ),
    );
    responses["204"] = { description: null } as Loose;
    responses["404"] = {} as Loose;
    const converted = convert(one({ responses }));
    expect(
      Object.fromEntries(
        endpoint(converted, "GET /things").responses.map((response) => [
          response.status,
          response.description,
        ]),
      ),
    ).toEqual({
      "101": "Informational",
      "200": "OK",
      "203": "Success",
      "304": "Redirection",
      "418": "Client error",
      "451": "Client error",
      "2XX": "Success",
      "5XX": "Server error",
      default: "Unexpected error",
      "204": "No Content",
      "404": "Not Found",
    });
  });

  it("leaves out statuses the app can't take, and reports links", () => {
    const converted = convert(
      one({
        responses: {
          "200": { description: "OK", links: { next: { operationId: "x" } } },
          "600": { description: "?" },
          "2xx": { description: "a" },
          "2XX": { description: "b" },
        },
      }),
    );
    expect(
      endpoint(converted, "GET /things").responses.map(
        (response) => response.status,
      ),
    ).toEqual(["200", "2XX"]);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/status the app doesn't take.*600/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/given twice/),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/Links aren't kept/),
    );
  });
});

describe("references to other components", () => {
  it("copies parameters, request bodies, responses, headers, and examples where they're used, with 3.1 overrides", () => {
    const converted = convert(
      doc31({
        components: {
          requestBodies: {
            Thing: {
              content: { "application/json": { schema: { type: "object" } } },
            },
          },
          responses: {
            Gone: {
              description: "Gone for good",
              content: { "text/plain": { schema: { type: "string" } } },
            },
          },
          examples: { sample: { summary: "A sample", value: { a: 1 } } },
        },
        paths: {
          "/a": {
            post: {
              requestBody: {
                $ref: "#/components/requestBodies/Thing",
                description: "Overridden",
              },
              responses: {
                "200": {
                  description: "OK",
                  content: {
                    "application/json": {
                      examples: {
                        sample: {
                          $ref: "#/components/examples/sample",
                          summary: "Mine",
                        },
                      },
                    },
                  },
                },
                "410": { $ref: "#/components/responses/Gone" },
              },
            },
          },
        },
      }),
    );
    const found = endpoint(converted, "POST /a");
    expect(found.requestBody).toMatchObject({
      description: "Overridden",
      schema: { type: "object" },
    });
    expect(found.responses[0]?.body?.examples).toEqual([
      { id: "x1", name: "sample", summary: "Mine", value: { a: 1 } },
    ]);
    expect(found.responses[1]).toMatchObject({
      description: "Gone for good",
      body: { contentType: "text/plain" },
    });
  });

  it("ignores a 3.0 reference's siblings, saying so", () => {
    const converted = convert(
      doc30({
        components: {
          parameters: {
            P: { name: "p", in: "query", schema: { type: "string" } },
          },
        },
        paths: {
          "/a": {
            get: {
              parameters: [
                { $ref: "#/components/parameters/P", description: "Ignored" },
              ],
              responses: ok,
            },
          },
        },
      }),
    );
    expect(endpoint(converted, "GET /a").parameters.query.properties).toEqual({
      p: { type: "string" },
    });
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/beside a \$ref.*description/s),
    );
  });

  it("reports components no operation uses", () => {
    const converted = convert(
      doc31({
        components: {
          parameters: { Unused: { name: "u", in: "query" } },
          responses: { Spare: { description: "x" } },
        },
      }),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/components\.parameters.*Unused/s),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(/components\.responses.*Spare/s),
    );
  });
});

describe("what OpenAPI has and a project doesn't", () => {
  it("reports callbacks, webhooks, extensions, unknown fields, and other operation parts", () => {
    const converted = convert(
      doc31({
        webhooks: { created: { post: { responses: ok } } },
        "x-logo": { url: "x" },
        surprise: true,
        paths: {
          "/a": {
            get: {
              callbacks: { done: {} },
              externalDocs: { url: "https://docs.example" },
              "x-codegen": "a",
              unknown: 1,
              responses: ok,
            },
          },
        },
      }),
    );
    for (const pattern of [
      /Webhooks aren't kept: created/,
      /x-logo/,
      /surprise/,
      /Callbacks/,
      /External docs/,
      /x-codegen/,
      /unknown/,
    ]) {
      expect(converted.messages, String(pattern)).toContainEqual(
        expect.stringMatching(pattern),
      );
    }
  });

  it("groups notices, so a thousand operations make one line per kind", () => {
    const paths = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [
        `/t${i}`,
        { get: { operationId: `t/${i}`, "x-vendor": i, responses: ok } },
      ]),
    );
    const converted = convert(doc31({ paths }));
    expect(converted.notices.length).toBeLessThan(5);
    expect(converted.messages).toContainEqual(
      expect.stringMatching(
        /1,000 operation IDs were changed.*t\/0 → t_0.*997 more/s,
      ),
    );
    expect(converted.messages).toContainEqual(
      expect.stringMatching(
        /^Extensions aren't kept \(1,000 places: x-vendor\)$/,
      ),
    );
  });

  it("refuses known fields of the wrong type, with their place", () => {
    const result = convertOpenApi(
      doc31({
        paths: {
          "/a": { get: { deprecated: "yes", parameters: "p", responses: ok } },
        },
      }),
      {},
    );
    expect(result).toMatchObject({
      error: expect.stringMatching(/can't be imported: it has 2 problems/),
      issues: [
        {
          path: "/paths/~1a/get/deprecated",
          message: "Expected true or false",
        },
        {
          path: "/paths/~1a/get/parameters",
          message: "Expected a list of parameters",
        },
      ],
    });
  });
});

describe("what the converter makes", () => {
  it("always passes the project file rules, so only reading the document can refuse it", () => {
    // convert() checks this for every document in these tests; here, a mix of
    // what breaks the rules most often in generated documents.
    const converted = convert(
      doc30({
        info: { title: "", version: "" },
        components: {
          schemas: {
            "Page«User»": { type: "object" },
            "a b": { type: "string" },
          },
          examples: { E: { summary: "" } },
        },
        paths: {
          "/a": {
            get: {
              operationId: "a-b",
              responses: {
                "200": { description: "" },
                "4XX": {},
                default: { description: null },
              },
            },
          },
        },
      }),
    );
    expect(converted.document.models.map((item) => item.name)).toEqual([
      "Page-User-",
      "a-b",
    ]);
    expect(readable(converted.document, { $ref: "model:m1" })).toEqual({
      $ref: "#/components/schemas/Page-User-",
    });
  });
});

describe("values that aren't what they should be", () => {
  // Valid JSON and YAML, but String() on it throws.
  const odd = { toString: 1 };

  it("are described in messages, never turned to text with String()", () => {
    expect(
      refusal({ swagger: odd, info: { title: "A", version: "1" } }),
    ).toMatch(/This is a Swagger document\./);
    const converted = convert(
      doc31({
        jsonSchemaDialect: odd,
        servers: [
          {
            url: "https://{region}.example.com",
            variables: { region: { default: "eu", enum: ["eu", odd, 5] } },
          },
        ],
        components: {
          securitySchemes: {
            weird: { type: odd },
            token: { type: "http", scheme: "bearer" },
          },
        },
        paths: {
          "/things": {
            get: { security: [{ token: [odd, "read"] }], responses: ok },
          },
        },
      }),
    );
    const messages = converted.messages.join("\n");
    expect(messages).toMatch(/not its jsonSchemaDialect an object/);
    expect(messages).toMatch(/region: an object, 5/);
    expect(messages).toMatch(/weird \(an object\)/);
    expect(messages).toMatch(/token: an object read/);
  });

  it("turn a mistake in the app into a refusal that asks for a report, rather than a failure", () => {
    const failing = doc31({});
    Object.defineProperty(failing, "info", {
      enumerable: true,
      get() {
        throw new TypeError("an unexpected mistake");
      },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(refusal(failing)).toMatch(
      /couldn't convert this document\. This is a problem in the app: please report it/,
    );
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("security, more closely", () => {
  it("reports requirements naming schemes the document doesn't define, which leave an operation public", () => {
    const converted = convert(
      one({ security: [{ oauth: ["read"] }], responses: ok }),
    );
    expect(endpoint(converted, "GET /things").security).toEqual({
      type: "none",
    });
    expect(converted.messages.join("\n")).toMatch(
      /Security requirements name schemes that components\.securitySchemes doesn't define, so they're left out \(1 requirement: oauth \(\/paths\/~1things\/get\/security\)\); an operation with no other alternative is public/,
    );
  });

  it("says which scheme a requirement for several together keeps, a left-out one among them too", () => {
    const converted = convert(
      one(
        { security: [{ mutual: [], key: [] }], responses: ok },
        {
          parts: {
            components: {
              securitySchemes: {
                mutual: { type: "mutualTLS" },
                key: { type: "apiKey", in: "header", name: "X-Key" },
              },
            },
          },
        },
      ),
    );
    expect(endpoint(converted, "GET /things").security).toEqual({
      type: "schemes",
      schemeIds: ["key"],
    });
    expect(converted.messages.join("\n")).toMatch(
      /1 requirement for several schemes together records only the first it has: mutual and key → key/,
    );
  });

  it("says a bearer format was shortened, and a server name too", () => {
    const converted = convert(
      doc31({
        servers: [{ url: "https://a.example", description: "S".repeat(60) }],
        components: {
          securitySchemes: {
            token: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "F".repeat(60),
            },
          },
        },
      }),
    );
    const messages = converted.messages.join("\n");
    expect(messages).toMatch(/a bearer format \(50 characters\)/);
    expect(converted.document.project.securitySchemes[0]).toMatchObject({
      bearerFormat: `${"F".repeat(49)}…`,
    });
    // A long description names nothing, so the host does.
    expect(converted.document.project.servers[0]?.name).toBe("a.example");
    const named = convert(
      doc31({
        openapi: "3.2.0",
        servers: [{ url: "https://a.example", name: "N".repeat(60) }],
      }),
    );
    expect(named.messages.join("\n")).toMatch(
      /a server name \(50 characters\)/,
    );
  });
});

describe("the project, more closely", () => {
  it("says a number given as info.version is taken as the number reads", () => {
    const converted = convert({
      openapi: "3.1.0",
      info: { title: "A", version: 1.5 },
    });
    expect(converted.document.project.apiVersion).toBe("1.5");
    expect(converted.messages).toContain(
      'info.version should be text, like "1.0.0"; the number is taken as 1.5',
    );
  });

  it("takes a jsonSchemaDialect of JSON Schema 2020-12 without a notice", () => {
    for (const dialect of [
      "https://json-schema.org/draft/2020-12/schema",
      "https://spec.openapis.org/oas/3.1/dialect/base",
    ]) {
      expect(
        convert(doc31({ jsonSchemaDialect: dialect })).messages.join("\n"),
      ).not.toMatch(/jsonSchemaDialect/);
    }
    expect(
      convert(
        doc31({ jsonSchemaDialect: "http://json-schema.org/draft-07/schema#" }),
      ).messages.join("\n"),
    ).toMatch(/not its jsonSchemaDialect http:\/\/json-schema\.org\/draft-07/);
  });

  it("says callbacks and links aren't kept, used or not, rather than that nothing uses them", () => {
    const converted = convert(
      one(
        {
          callbacks: { done: { $ref: "#/components/callbacks/Done" } },
          responses: {
            "200": {
              description: "OK",
              links: { next: { $ref: "#/components/links/Next" } },
            },
          },
        },
        {
          parts: {
            components: {
              callbacks: { Done: {} },
              links: { Next: { operationId: "x" } },
            },
          },
        },
      ),
    );
    const messages = converted.messages.join("\n");
    expect(messages).toMatch(
      /Callbacks aren't kept, so components\.callbacks isn't imported: Done/,
    );
    expect(messages).toMatch(
      /Links aren't kept, so components\.links isn't imported: Next/,
    );
    expect(messages).not.toMatch(
      /components\.(callbacks|links) that no operation uses/,
    );
  });
});

describe("OpenAPI 3.2 media types", () => {
  it("follows references to components.mediaTypes, for bodies and for parameters", () => {
    const converted = convert({
      openapi: "3.2.0",
      info: { title: "A", version: "1" },
      components: {
        mediaTypes: {
          PetJson: {
            schema: {
              type: "object",
              properties: { name: { type: "string" } },
            },
            examples: { rex: { value: { name: "Rex" } } },
          },
          Filter: { schema: { type: "string" } },
        },
      },
      paths: {
        "/pets": {
          get: {
            parameters: [
              {
                name: "filter",
                in: "query",
                content: {
                  "application/json": {
                    $ref: "#/components/mediaTypes/Filter",
                  },
                },
              },
            ],
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    $ref: "#/components/mediaTypes/PetJson",
                  },
                },
              },
            },
          },
        },
      },
    });
    const found = endpoint(converted, "GET /pets");
    expect(found.responses[0]?.body).toMatchObject({
      schema: { type: "object", properties: { name: { type: "string" } } },
      examples: [{ name: "rex", value: { name: "Rex" } }],
    });
    expect(found.parameters.query.properties).toEqual({
      filter: { type: "string" },
    });
    const messages = converted.messages.join("\n");
    expect(messages).not.toMatch(
      /components\.mediaTypes that no operation uses/,
    );
    expect(messages).not.toMatch(/\$ref isn't something the app keeps/);
  });
});

describe("examples of parameters and headers", () => {
  it("say which they leave out, keep a null dataValue, and take a list as the schema's examples", () => {
    const converted = convert(
      one({
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            examples: {
              remote: { externalValue: "https://example.com/q.txt" },
              empty: { summary: "Nothing" },
              none: { dataValue: null },
            },
          },
        ],
        responses: ok,
      }),
    );
    expect(
      endpoint(converted, "GET /things").parameters.query.properties,
    ).toEqual({
      q: { type: "string", examples: [null] },
    });
    expect(converted.messages.join("\n")).toMatch(
      /2 examples were left out, since the app keeps example values: remote \(q, GET \/things: its value is in another file, which the app never reads\) and empty \(q, GET \/things: it has no value\)/,
    );
    // A list, as JSON Schema writes examples: its values, with a notice.
    const listed = convert(
      one({
        parameters: [
          {
            name: "q",
            in: "query",
            schema: { type: "string" },
            examples: ["a", "b"],
          },
          {
            name: "r",
            in: "query",
            schema: { type: "string" },
            examples: {
              a: 5,
              b: { value: "x", description: "Why", "x-note": 1 },
            },
          },
        ],
        responses: ok,
      }),
    );
    expect(endpoint(listed, "GET /things").parameters.query.properties).toEqual(
      {
        q: { type: "string", examples: ["a", "b"] },
        r: { type: "string", examples: ["x"] },
      },
    );
    const messages = listed.messages.join("\n");
    expect(messages).toMatch(
      /1 parameter or header gave examples as a list, as JSON Schema writes them, rather than named example objects: the values are its schema's examples \(q \(GET \/things\)\)/,
    );
    expect(messages).toMatch(
      /1 example that isn't an example object was left out: a \(r, GET \/things\)/,
    );
    expect(messages).toMatch(
      /their names, summaries, and descriptions aren't kept/,
    );
    expect(messages).toMatch(/Extensions aren't kept \(1 place: x-note\)/);
  });

  it("keep a body example whose dataValue is null", () => {
    const converted = convert({
      openapi: "3.2.0",
      info: { title: "A", version: "1" },
      paths: {
        "/things": {
          get: {
            responses: {
              "200": {
                description: "OK",
                content: {
                  "application/json": {
                    examples: { none: { dataValue: null, value: 5 } },
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(
      endpoint(converted, "GET /things").responses[0]?.body?.examples,
    ).toMatchObject([{ name: "none", value: null }]);
  });
});

describe("path items by reference", () => {
  it("take a 3.1 reference's summary and description, and say other fields beside it aren't kept", () => {
    const converted = convert(
      doc31({
        components: {
          pathItems: {
            P: {
              summary: "Shared",
              get: { responses: ok },
            },
          },
        },
        paths: {
          "/things": {
            $ref: "#/components/pathItems/P",
            summary: "Things",
            description: "All the things.",
            post: { responses: ok },
          },
        },
      }),
    );
    expect(endpoint(converted, "GET /things")).toMatchObject({
      summary: "Things",
      description: "All the things.",
    });
    expect(converted.messages.join("\n")).toMatch(
      /Fields beside a path item's \$ref aren't kept, since OpenAPI leaves how they combine with what it refers to undefined \(1 path: post\)/,
    );
  });
});

describe("notices, more precisely", () => {
  it("says what a Swagger document without a version text is", () => {
    expect(
      refusal({ swagger: { toString: 1 }, info: { title: "A", version: "1" } }),
    ).toMatch(/^This is a Swagger document\. Convert it to OpenAPI 3 first/);
    expect(
      refusal({ swagger: "2.0", info: { title: "A", version: "1" } }),
    ).toMatch(/^This is a Swagger 2\.0 document\./);
  });

  it("says operations needing only a scheme past the 20th are public", () => {
    const schemes = Object.fromEntries(
      Array.from({ length: 21 }, (_, index) => [
        `s${index}`,
        { type: "http", scheme: "bearer" },
      ]),
    );
    const converted = convert(
      one(
        { security: [{ s20: [] }], responses: ok },
        { parts: { components: { securitySchemes: schemes } } },
      ),
    );
    expect(endpoint(converted, "GET /things").security).toEqual({
      type: "none",
    });
    expect(converted.messages.join("\n")).toMatch(
      /The app keeps 20 security schemes, so 1 more was left out, and the operations that need only them are public in the project/,
    );
  });

  it("names a 3.1 bound as it's rewritten", () => {
    const converted = convert(
      doc31({
        paths: withBody({
          type: "number",
          maximum: 9,
          exclusiveMaximum: true,
        }),
      }),
    );
    expect(converted.messages.join("\n")).toMatch(
      /\(exclusiveMaximum: true with maximum: 9 → exclusiveMaximum: 9\)/,
    );
  });
});
