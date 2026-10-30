import fs from "node:fs";
import { type Download, expect, type Page, test } from "@playwright/test";
import {
  createEndpoint,
  createModel,
  createPage,
  createProject,
  projectTab,
  uniqueName,
} from "./helpers";

async function contentOf(download: Download) {
  return fs.readFileSync(await download.path(), "utf8");
}

async function download(page: Page, name: string) {
  const started = page.waitForEvent("download");
  await page.getByRole("link", { name }).click();
  return started;
}

/** A project with one endpoint on a page and one on no page. */
async function setUp(request: Parameters<typeof createProject>[0]) {
  const project = await createProject(request, uniqueName("Export"));
  const login = await createEndpoint(request, project.id, {
    method: "POST",
    path: "/auth/login",
    summary: "Sign in",
  });
  const health = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/health",
  });
  const loginPage = await createPage(request, project.id, "Login");
  await request.patch(`/api/projects/${project.id}/pages/${loginPage.id}`, {
    data: {
      endpoints: [
        { id: "l1", endpointId: login.id, trigger: "on_submit", note: "" },
      ],
    },
  });
  return { project, login, health, loginPage };
}

test("downloads the project as OpenAPI YAML and JSON", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Export").click();

  await expect(page.getByText("Valid OpenAPI 3.1")).toBeVisible();

  const yaml = await download(page, "Download YAML");
  expect(yaml.suggestedFilename()).toBe(`${project.slug}.openapi.yaml`);
  const yamlText = await contentOf(yaml);
  expect(yamlText).toContain("openapi: 3.1.0");
  expect(yamlText).toContain("/auth/login:");

  const json = await download(page, "Download JSON");
  expect(json.suggestedFilename()).toBe(`${project.slug}.openapi.json`);
  expect(JSON.parse(await contentOf(json))).toMatchObject({
    openapi: "3.1.0",
    info: { title: project.name },
  });
});

test("lists warnings with links to fix them", async ({ page, request }) => {
  const { project, health } = await setUp(request);
  await page.goto(`/projects/${project.id}/export`);

  const warnings = page.getByRole("region", { name: "Warnings" });
  await expect(warnings.getByRole("listitem")).toHaveText([
    /POST \/auth\/login: the request body has no example/,
    /POST \/auth\/login: the 201 response has no example/,
    /GET \/health: the 200 response has no example/,
    /GET \/health isn't used by any page/,
  ]);

  await warnings
    .getByRole("listitem")
    .filter({ hasText: "isn't used by any page" })
    .getByRole("link", { name: "Open" })
    .click();
  await expect(page).toHaveURL(
    `/projects/${project.id}/endpoints/${health.id}`,
  );
});

test("exports a single page", async ({ page, request }) => {
  const { project, loginPage } = await setUp(request);
  await page.goto(`/projects/${project.id}/pages/${loginPage.id}`);

  await page.getByRole("link", { name: "Export OpenAPI" }).click();
  await expect(page).toHaveURL(
    `/projects/${project.id}/export?page=${loginPage.id}`,
  );
  await expect(page.getByRole("combobox", { name: "Scope" })).toHaveText(
    "Login",
  );

  const yaml = await download(page, "Download YAML");
  expect(yaml.suggestedFilename()).toBe(`${project.slug}.login.openapi.yaml`);
  const text = await contentOf(yaml);
  expect(text).toContain("/auth/login:");
  expect(text).not.toContain("/health:");

  await page.getByRole("combobox", { name: "Scope" }).click();
  await page.getByRole("option", { name: "Whole project" }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/export`);
});

test("blocks downloads while the contract isn't valid", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  await createModel(request, project.id, {
    name: "Broken",
    schema: { type: "strng" },
  });
  await page.goto(`/projects/${project.id}/export`);

  const errors = page.getByRole("region", { name: "Errors" });
  await expect(errors).toContainText(
    "Model Broken: /type must be equal to one of the allowed values",
  );
  await expect(page.getByRole("link", { name: "Download YAML" })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", { name: "Download YAML" }),
  ).toBeDisabled();
});
