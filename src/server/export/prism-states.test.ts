import prismHttp from "@stoplight/prism-http";
import { createServer } from "@stoplight/prism-http-server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Endpoint,
  endpointResponseFieldsSchema,
} from "../../shared/endpoints";
import { errorTypeSchema } from "../../shared/error-types";
import { isJsonObject, type JsonSchema } from "../../shared/json-schema";
import { resolveCause } from "../../shared/page-states";
import { pageSchema } from "../../shared/pages";
import { type Project, projectSchema } from "../../shared/projects";
import { buildSample, createTestApp } from "../test-utils";

// The Prefer headers shown for page states go through Prism's own HTTP
// server, so its header parsing and response negotiation are what's tested.

/** Prism logs every request; tests don't need to see that. */
const silentLogger: unknown = new Proxy(
  {},
  { get: (_target, key) => (key === "child" ? () => silentLogger : () => {}) },
);

const SOME_UUID = "1e3a5c7e-9b2d-4f6a-8c0e-3b5d7f9a1c2e";

async function startPrism(doc: unknown) {
  const operations = await prismHttp.getHttpOperationsFromSpec(
    doc as Record<string, unknown>,
  );
  const server = createServer(operations, {
    components: { logger: silentLogger as never },
    cors: false,
    config: {
      mock: { dynamic: false },
      validateRequest: true,
      validateResponse: true,
      checkSecurity: true,
      errors: false,
      upstreamProxy: undefined,
      isProxy: false,
    },
  });
  return { server, address: await server.listen(0, "127.0.0.1") };
}

function propertiesOf(schema: JsonSchema) {
  return isJsonObject(schema.properties) ? schema.properties : {};
}

function exampleOf(schema: unknown) {
  if (!isJsonObject(schema)) {
    return "x";
  }
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return String(schema.examples[0]);
  }
  return schema.format === "uuid" ? SOME_UUID : "x";
}

/** A request Prism accepts, so it answers with what `Prefer` asks for. */
function validRequest(project: Project, endpoint: Endpoint) {
  const path = endpoint.path.replace(/\{([^}]+)\}/g, (_match, name: string) =>
    exampleOf(propertiesOf(endpoint.parameters.path)[name]),
  );
  const headers: Record<string, string> = {};
  const required = endpoint.parameters.header.required;
  for (const [name, schema] of Object.entries(
    propertiesOf(endpoint.parameters.header),
  )) {
    if (Array.isArray(required) && required.includes(name)) {
      headers[name] = exampleOf(schema);
    }
  }
  const schemeIds =
    endpoint.security.type === "schemes"
      ? endpoint.security.schemeIds
      : endpoint.security.type === "default" && project.defaultSecuritySchemeId
        ? [project.defaultSecuritySchemeId]
        : [];
  const scheme = project.securitySchemes.find((item) =>
    schemeIds.includes(item.id),
  );
  if (scheme?.type === "bearer") {
    headers.authorization = "Bearer x";
  } else if (scheme?.type === "basic") {
    headers.authorization = "Basic eDp4";
  } else if (scheme?.type === "apiKey" && scheme.in === "header") {
    headers[scheme.name] = "x";
  } else if (scheme?.type === "apiKey" && scheme.in === "cookie") {
    headers.cookie = `${scheme.name}=x`;
  }
  const body = endpoint.requestBody;
  if (body) {
    headers["content-type"] = body.contentType;
  }
  return {
    path,
    init: {
      method: endpoint.method,
      headers,
      body: body ? JSON.stringify(body.examples[0]?.value) : undefined,
    },
  };
}

/**
 * Sends every state cause of a project's pages to Prism with the headers the
 * state shows, and lists those that don't come back as the state names them.
 */
async function checkStates(
  t: ReturnType<typeof createTestApp>,
  projectId: string,
) {
  const base = `/api/projects/${projectId}`;
  const get = async (url: string) => (await t.request("GET", url)).json();
  const project = projectSchema.parse(await get(base));
  const doc = await get(`${base}/export/openapi?format=json`);
  const errorTypesById = new Map(
    errorTypeSchema
      .array()
      .parse(await get(`${base}/error-types`))
      .map((errorType) => [errorType.id, errorType]),
  );
  const endpointsById = new Map<string, Endpoint>();
  for (const { id } of (await get(`${base}/endpoints`)) as { id: string }[]) {
    endpointsById.set(
      id,
      endpointResponseFieldsSchema.parse(await get(`${base}/endpoints/${id}`)),
    );
  }
  const pages = [];
  for (const { id } of (await get(`${base}/pages`)) as { id: string }[]) {
    pages.push(pageSchema.parse(await get(`${base}/pages/${id}`)));
  }

  const { server, address } = await startPrism(doc);
  const failures: string[] = [];
  let checked = 0;
  try {
    for (const page of pages) {
      for (const state of page.states) {
        for (const cause of state.causes) {
          if (cause.type === "request") {
            continue;
          }
          const label = `${page.name} › ${state.name}`;
          const resolved = resolveCause(
            cause,
            page.endpoints,
            endpointsById,
            errorTypesById,
          );
          if ("error" in resolved) {
            failures.push(`${label}: ${resolved.error}`);
            continue;
          }
          if (!resolved.mock) {
            failures.push(`${label}: no Prism headers`);
            continue;
          }
          const { path, init } = validRequest(project, resolved.endpoint);
          const response = await fetch(`${address}${path}`, {
            ...init,
            headers: {
              ...init.headers,
              prefer: resolved.mock.prefer,
              ...(resolved.mock.accept ? { accept: resolved.mock.accept } : {}),
            },
          });
          const text = await response.text();
          const code = Number(/code=(\d{3})/.exec(resolved.mock.prefer)?.[1]);
          const firstExample = resolved.response?.body?.examples[0];
          const expected =
            resolved.example?.value ?? firstExample?.value ?? undefined;
          const isJson = /json/.test(
            response.headers.get("content-type") ?? "",
          );
          const actual =
            text === "" ? undefined : isJson ? JSON.parse(text) : text;
          if (
            response.status !== code ||
            JSON.stringify(actual) !== JSON.stringify(expected)
          ) {
            failures.push(
              `${label}: ${resolved.mock.prefer} answered ${response.status} ${text.slice(0, 120)}`,
            );
          }
          checked++;
        }
      }
    }
  } finally {
    await server.close();
  }
  return { failures, checked };
}

describe("page states with Prism's mock server", () => {
  let t: ReturnType<typeof createTestApp>;

  beforeAll(() => {
    t = createTestApp();
  });

  afterAll(() => {
    t.close();
  });

  it("answers every state of the sample as the state names it", async () => {
    const sample = await buildSample(t);

    const { failures, checked } = await checkStates(t, sample.projectId);

    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(30);
  });

  it("reaches errors in range and default responses, and other content types", async () => {
    const base = `/api/projects/${
      projectSchema.parse(
        await (
          await t.request("POST", "/api/projects", { name: "Reports" })
        ).json(),
      ).id
    }`;
    const send = async (method: string, url: string, body?: unknown) => {
      const response = await t.request(method, `${base}${url}`, body);
      expect(response.status, `${method} ${url}`).toBeLessThan(300);
      return (await response.json()) as { id: string };
    };
    const problem = (name: string, status: number) => ({
      name,
      status: String(status),
      title: name,
      body: {
        contentType: "application/problem+json",
        schema: { type: "object" },
        example: { type: `https://api.example.com/problems/${name}`, status },
      },
    });
    const missing = await send("POST", "/error-types", problem("missing", 404));
    const busy = await send("POST", "/error-types", problem("busy", 409));
    const down = await send("POST", "/error-types", problem("down", 503));
    const noHeaders = { type: "object", properties: {} };
    const reports = await send("POST", "/endpoints", {
      method: "GET",
      path: "/reports",
    });
    await send("PATCH", `/endpoints/${reports.id}`, {
      responses: [
        {
          id: "csv",
          status: "200",
          description: "OK",
          headers: noHeaders,
          body: {
            contentType: "text/csv",
            schema: { type: "string" },
            examples: [
              { id: "rows", name: "rows", summary: "", value: "sku\nBOX-1\n" },
            ],
          },
          errors: [],
        },
        {
          id: "client",
          status: "4XX",
          description: "Client error",
          headers: noHeaders,
          body: null,
          errors: [
            { errorTypeId: missing.id, examples: [] },
            { errorTypeId: busy.id, examples: [] },
          ],
        },
        {
          id: "server",
          status: "5XX",
          description: "Server error",
          headers: noHeaders,
          body: null,
          errors: [{ errorTypeId: down.id, examples: [] }],
        },
        {
          id: "other",
          status: "default",
          description: "Unexpected",
          headers: noHeaders,
          body: {
            contentType: "application/json",
            schema: { type: "object" },
            examples: [
              { id: "odd", name: "odd", summary: "", value: { odd: true } },
            ],
          },
          errors: [],
        },
      ],
    });
    const page = await send("POST", "/pages", { name: "Reports" });
    const error = (errorTypeId: string) => ({
      type: "error",
      linkId: "l1",
      errorTypeId,
      exampleId: null,
    });
    await send("PATCH", `/pages/${page.id}`, {
      endpoints: [
        { id: "l1", endpointId: reports.id, trigger: "on_load", note: "" },
      ],
      states: [
        {
          id: "s1",
          kind: "success",
          name: "Report",
          description: "",
          causes: [
            {
              type: "response",
              linkId: "l1",
              responseId: "csv",
              exampleId: "rows",
            },
          ],
          mockupIds: [],
        },
        {
          id: "s2",
          kind: "error",
          name: "Problems",
          description: "",
          causes: [error(busy.id), error(missing.id), error(down.id)],
          mockupIds: [],
        },
        {
          id: "s3",
          kind: "error",
          name: "Something else",
          description: "",
          causes: [
            {
              type: "response",
              linkId: "l1",
              responseId: "other",
              exampleId: "odd",
            },
          ],
          mockupIds: [],
        },
      ],
    });

    const { failures, checked } = await checkStates(
      t,
      base.replace("/api/projects/", ""),
    );

    expect(failures).toEqual([]);
    expect(checked).toBe(5);
  });
});
