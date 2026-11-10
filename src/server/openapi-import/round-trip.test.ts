import { afterEach, describe, expect, it } from "vitest";
import { projectImportResultSchema } from "../../shared/project-file";
import { buildSample, createTestApp } from "../test-utils";

// The sample, exported as OpenAPI by this app, imported into an empty
// instance, and exported again: the same bytes. What the project itself
// loses on the way, which OpenAPI doesn't hold, is locked below.

// biome-ignore lint/suspicious/noExplicitAny: tests read API answers loosely.
type Loose = any;

type TestApp = ReturnType<typeof createTestApp>;
const apps: TestApp[] = [];
function app() {
  const created = createTestApp();
  apps.push(created);
  return created;
}
afterEach(() => {
  for (const created of apps.splice(0)) {
    created.close();
  }
});

async function text(t: TestApp, url: string) {
  const response = await t.request("GET", url);
  expect(response.status, url).toBe(200);
  return response.text();
}

async function importText(t: TestApp, body: string, contentType: string) {
  const response = await t.app.request("/api/projects/import", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
  });
  const json = (await response.json()) as Loose;
  expect(response.status, JSON.stringify(json).slice(0, 2000)).toBe(201);
  return projectImportResultSchema.parse(json);
}

async function projectFile(t: TestApp, projectId: string): Promise<Loose> {
  const response = await t.request(
    "GET",
    `/api/projects/${projectId}/export/project`,
  );
  expect(response.status).toBe(200);
  const { unzipSync, strFromU8 } = await import("fflate");
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  const name =
    Object.keys(files).find((file) => file.endsWith("/project.json")) ?? "";
  return JSON.parse(strFromU8(files[name] ?? new Uint8Array()));
}

describe("the sample, through OpenAPI and back", () => {
  it("exports the same OpenAPI document after the import, as YAML and as JSON", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    for (const [format, type] of [
      ["yaml", "application/yaml"],
      ["json", "application/json"],
    ] as const) {
      const original = await text(
        source,
        `/api/projects/${projectId}/export/openapi?format=${format}`,
      );
      const target = app();
      const { project } = await importText(target, original, type);
      const again = await text(
        target,
        `/api/projects/${project.id}/export/openapi?format=${format}`,
      );
      expect(again, format).toBe(original);
    }
  });

  it("exports the same document for one page's export", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    const pages = (await (
      await source.request("GET", `/api/projects/${projectId}/pages`)
    ).json()) as Loose[];
    for (const page of pages) {
      const original = await text(
        source,
        `/api/projects/${projectId}/export/openapi?page=${page.id}`,
      );
      const target = app();
      const { project } = await importText(
        target,
        original,
        "application/yaml",
      );
      expect(
        await text(target, `/api/projects/${project.id}/export/openapi`),
        page.name,
      ).toBe(original);
    }
  });

  it("says nothing was lost but what the export merged, and nothing else", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    const original = await text(
      source,
      `/api/projects/${projectId}/export/openapi`,
    );
    const { notices } = await importText(app(), original, "application/yaml");
    expect(notices).toEqual([]);
  });

  it("brings back the project, less what OpenAPI doesn't hold", async () => {
    const source = app();
    const { projectId } = await buildSample(source);
    const target = app();
    const { project } = await importText(
      target,
      await text(source, `/api/projects/${projectId}/export/openapi`),
      "application/yaml",
    );
    const before = await projectFile(source, projectId);
    const after = await projectFile(target, project.id);

    // IDs differ (all are new); everything is compared by name.
    const comparable = (file: Loose) => {
      const models = new Map(
        file.models.map((model: Loose) => [model.id, model.name]),
      );
      const errorTypes = new Map(
        file.errorTypes.map((item: Loose) => [item.id, item.name]),
      );
      const endpoints = new Map(
        file.endpoints.map((item: Loose) => [
          item.id,
          `${item.method} ${item.path}`,
        ]),
      );
      const schemes = new Map(
        file.project.securitySchemes.map((scheme: Loose) => [
          scheme.id,
          scheme.key,
        ]),
      );
      const named = (value: unknown) =>
        JSON.parse(
          JSON.stringify(value).replace(
            /"model:([0-9A-Z]{26})"/g,
            (_whole, id) => JSON.stringify(`model:${models.get(id)}`),
          ),
        );
      const response = (item: Loose) => ({
        ...item,
        id: undefined,
        headers: named(item.headers),
        body: item.body && {
          ...item.body,
          schema: named(item.body.schema),
          examples: item.body.examples.map((example: Loose) => ({
            ...example,
            id: undefined,
          })),
        },
        errors: item.errors.map((usage: Loose) => ({
          errorType: errorTypes.get(usage.errorTypeId),
          examples: usage.examples.map((example: Loose) => ({
            ...example,
            id: undefined,
          })),
        })),
      });
      return {
        project: {
          ...file.project,
          id: undefined,
          servers: file.project.servers.map((server: Loose) => ({
            ...server,
            id: undefined,
          })),
          securitySchemes: file.project.securitySchemes.map(
            (scheme: Loose) => ({ ...scheme, id: undefined }),
          ),
          defaultSecuritySchemeId: schemes.get(
            file.project.defaultSecuritySchemeId,
          ),
        },
        models: file.models
          .map((model: Loose) => ({
            ...model,
            id: undefined,
            schema: named(model.schema),
          }))
          .sort((a: Loose, b: Loose) => (a.name < b.name ? -1 : 1)),
        errorTypes: file.errorTypes
          .map((item: Loose) => ({
            ...item,
            id: undefined,
            headers: named(item.headers),
            body: { ...item.body, schema: named(item.body.schema) },
          }))
          .sort((a: Loose, b: Loose) => (a.name < b.name ? -1 : 1)),
        endpoints: file.endpoints
          .map((item: Loose) => ({
            ...item,
            id: undefined,
            security:
              item.security.type === "schemes"
                ? {
                    type: "schemes",
                    schemeIds: item.security.schemeIds.map((id: string) =>
                      schemes.get(id),
                    ),
                  }
                : item.security,
            parameters: named(item.parameters),
            requestBody: item.requestBody && {
              ...item.requestBody,
              schema: named(item.requestBody.schema),
              examples: item.requestBody.examples.map((example: Loose) => ({
                ...example,
                id: undefined,
              })),
            },
            responses: item.responses.map(response),
          }))
          .sort((a: Loose, b: Loose) =>
            `${a.path} ${a.method}` < `${b.path} ${b.method}` ? -1 : 1,
          ),
        pages: file.pages.map((page: Loose) => ({
          ...page,
          id: undefined,
          endpoints: page.endpoints
            .map((link: Loose) => ({
              endpoint: endpoints.get(link.endpointId),
              trigger: link.trigger,
              note: link.note,
            }))
            .sort((a: Loose, b: Loose) =>
              `${a.endpoint} ${a.trigger}` < `${b.endpoint} ${b.trigger}`
                ? -1
                : 1,
            ),
        })),
      };
    };
    const was = comparable(before);
    const is = comparable(after);

    // Pages keep their names, slugs, descriptions, and links (in another
    // order: OpenAPI lists links per endpoint, not per page).
    expect(is.pages).toEqual(
      was.pages.map((page: Loose) => ({
        ...page,
        acceptanceCriteria: "",
        mockups: [],
        states: [],
      })),
    );
    expect(
      was.pages.some(
        (page: Loose) =>
          page.acceptanceCriteria !== "" &&
          page.mockups.length > 0 &&
          page.states.length > 0,
      ),
    ).toBe(true);

    expect(is.project).toEqual(was.project);
    expect(is.models).toEqual(was.models);

    // Error types keep everything but the headers the export merged into
    // responses where it can't tell whose they are: those stay on the
    // responses, which come out the same.
    const headerNames = (item: Loose) => Object.keys(item.headers.properties);
    expect(
      Object.fromEntries(
        was.errorTypes
          .map((item: Loose, index: number) => [
            item.name,
            headerNames(item),
            headerNames(is.errorTypes[index]),
          ])
          .filter(([, a, b]: Loose) => JSON.stringify(a) !== JSON.stringify(b))
          .map(([name, a, b]: Loose) => [name, { was: a, is: b }]),
      ),
    ).toEqual({
      "session-expired": { was: ["Set-Cookie"], is: [] },
      "token-expired": { was: ["WWW-Authenticate"], is: [] },
      "too-many-attempts": { was: ["Retry-After"], is: [] },
      unauthenticated: { was: ["WWW-Authenticate"], is: [] },
    });
    const withoutHeaders = (items: Loose[]) =>
      items.map((item) => ({ ...item, headers: undefined }));
    expect(withoutHeaders(is.errorTypes)).toEqual(
      withoutHeaders(was.errorTypes),
    );
    const requestInProgress = is.errorTypes.find(
      (item: Loose) => item.name === "request-in-progress",
    );
    expect(requestInProgress.headers.required ?? []).toEqual([]);

    // Endpoints are the same, except the headers those error types send,
    // which their responses now have of their own.
    const stripErrorHeaders = (items: Loose[]) =>
      items.map((item) => ({
        ...item,
        responses: item.responses.map((response: Loose) => ({
          ...response,
          headers: undefined,
        })),
      }));
    expect(stripErrorHeaders(is.endpoints)).toEqual(
      stripErrorHeaders(was.endpoints),
    );
  });
});
