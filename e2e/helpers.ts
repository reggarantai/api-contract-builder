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
