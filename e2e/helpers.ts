import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

/** Tests share one database, so every test works with its own names. */
export function uniqueName(prefix: string) {
  return `${prefix} ${Math.random().toString(36).slice(2, 8)}`;
}

export type CreatedProject = { id: string; name: string; slug: string };

export async function createProject(
  request: APIRequestContext,
  name: string,
  settings?: Record<string, unknown>,
): Promise<CreatedProject> {
  const created = await request.post("/api/projects", { data: { name } });
  expect(created.status()).toBe(201);
  const project = (await created.json()) as CreatedProject;

  if (settings) {
    const updated = await request.patch(`/api/projects/${project.id}`, {
      data: settings,
    });
    expect(updated.status()).toBe(200);
  }
  return project;
}

/** A settings form, found by its card title. */
export function settingsSection(page: Page, title: string): Locator {
  return page.locator("form", {
    has: page.getByText(title, { exact: true }),
  });
}

export function projectTab(page: Page, name: string): Locator {
  return page
    .getByRole("navigation", { name: "Project" })
    .getByRole("link", { name });
}

export type CreatedModel = { id: string; name: string };

export async function createModel(
  request: APIRequestContext,
  projectId: string,
  body: { name: string; schema?: Record<string, unknown> },
): Promise<CreatedModel> {
  const response = await request.post(`/api/projects/${projectId}/models`, {
    data: body,
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as CreatedModel;
}

export async function getModelSchema(
  request: APIRequestContext,
  projectId: string,
  modelId: string,
) {
  const response = await request.get(
    `/api/projects/${projectId}/models/${modelId}`,
  );
  expect(response.status()).toBe(200);
  return ((await response.json()) as { schema: unknown }).schema;
}

export type CreatedEndpoint = { id: string; method: string; path: string };

export async function createEndpoint(
  request: APIRequestContext,
  projectId: string,
  body: { method: string; path: string; summary?: string },
  changes?: Record<string, unknown>,
): Promise<CreatedEndpoint> {
  const url = `/api/projects/${projectId}/endpoints`;
  const created = await request.post(url, { data: body });
  expect(created.status()).toBe(201);
  const endpoint = (await created.json()) as CreatedEndpoint;
  if (changes) {
    const updated = await request.patch(`${url}/${endpoint.id}`, {
      data: changes,
    });
    expect(updated.status()).toBe(200);
  }
  return endpoint;
}

export async function getEndpoint(
  request: APIRequestContext,
  projectId: string,
  endpointId: string,
) {
  const response = await request.get(
    `/api/projects/${projectId}/endpoints/${endpointId}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as Record<string, unknown>;
}

export type CreatedPage = { id: string; name: string; slug: string };

export async function createPage(
  request: APIRequestContext,
  projectId: string,
  name: string,
): Promise<CreatedPage> {
  const response = await request.post(`/api/projects/${projectId}/pages`, {
    data: { name },
  });
  expect(response.status()).toBe(201);
  return (await response.json()) as CreatedPage;
}

export async function getPage(
  request: APIRequestContext,
  projectId: string,
  pageId: string,
) {
  const response = await request.get(
    `/api/projects/${projectId}/pages/${pageId}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    description: string;
    acceptanceCriteria: string;
    endpoints: { endpointId: string; trigger: string; note: string }[];
    mockups: { originalName: string; caption: string }[];
  };
}
