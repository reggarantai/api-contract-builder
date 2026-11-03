import fs from "node:fs";
import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { makePng } from "../test/images";
import {
  createEndpoint,
  createPage,
  createProject,
  projectTab,
  uniqueName,
} from "./helpers";

/** A project with a page that calls an endpoint and has a mockup. */
async function setUp(request: APIRequestContext) {
  const project = await createProject(request, uniqueName("Move"));
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/items",
  });
  const page = await createPage(request, project.id, "Items");
  await request.patch(`/api/projects/${project.id}/pages/${page.id}`, {
    data: {
      endpoints: [
        { id: "l1", endpointId: endpoint.id, trigger: "on_load", note: "" },
      ],
    },
  });
  const uploaded = await request.post(
    `/api/projects/${project.id}/pages/${page.id}/mockups`,
    {
      multipart: {
        files: {
          name: "list.png",
          mimeType: "image/png",
          buffer: makePng(12, 8),
        },
      },
    },
  );
  expect(uploaded.status()).toBe(201);
  return { project, page };
}

async function projectFile(request: APIRequestContext, projectId: string) {
  const response = await request.get(
    `/api/projects/${projectId}/export/project`,
  );
  expect(response.status()).toBe(200);
  return response.body();
}

function chooseFile(page: Page, name: string, buffer: Buffer | Uint8Array) {
  return page.getByLabel("Import project").setInputFiles({
    name,
    mimeType: name.endsWith(".zip")
      ? "application/zip"
      : "application/octet-stream",
    buffer: Buffer.from(buffer),
  });
}

test("downloads the project file from the Export tab", async ({
  page,
  request,
}) => {
  const { project, page: itemsPage } = await setUp(request);
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Export").click();

  const section = page.getByRole("region", { name: "Project file" });
  await expect(section).toContainText(
    "Everything in this project, mockups included",
  );
  await expect(section).toContainText(/About \d+ KB/);

  const started = page.waitForEvent("download");
  await section.getByRole("link", { name: "Download project file" }).click();
  const download = await started;
  expect(download.suggestedFilename()).toBe(`${project.slug}.project.zip`);
  const files = unzipSync(
    new Uint8Array(fs.readFileSync(await download.path())),
  );
  const document = JSON.parse(
    strFromU8(files[`${project.slug}/project.json`] ?? new Uint8Array()),
  );
  expect(document).toMatchObject({
    format: "api-contract-builder/project",
    formatVersion: 1,
    project: { name: project.name },
  });
  expect(
    Object.keys(files).filter((name) =>
      name.startsWith(`${project.slug}/mockups/`),
    ),
  ).toHaveLength(1);

  // A page's scope doesn't apply: the file is always the whole project.
  await page.goto(`/projects/${project.id}/export?page=${itemsPage.id}`);
  await expect(section).toContainText("Always the whole project");
});

test("says why the project file can't be sized up", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  const reason =
    "Something here nests deeper than the app can follow. Schemas and examples may nest at most 256 levels.";
  await page.route("**/export/project/report", (route) =>
    route.fulfill({ status: 422, json: { error: reason } }),
  );
  await page.goto(`/projects/${project.id}/export`);

  const section = page.getByRole("region", { name: "Project file" });
  await expect(section).toContainText(reason);
});

test("imports a project file from the Projects page", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  const file = await projectFile(request, project.id);

  await page.goto("/");
  await chooseFile(page, `${project.slug}.project.zip`, file);

  // The project is already here, so the import is a copy with its own slug.
  await expect(page.getByText(`Imported ${project.name}`)).toBeVisible();
  await expect(page.getByText("the import is a separate copy")).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  expect(page.url()).not.toContain(project.id);
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();

  await projectTab(page, "Pages").click();
  await page
    .getByRole("list", { name: "Pages" })
    .getByRole("link", { name: "Items" })
    .click();
  const image = page
    .getByRole("button", { name: "Open list.png" })
    .locator("img");
  await expect(image).toBeVisible();
  expect(
    await image.evaluate(
      (element) => (element as HTMLImageElement).naturalWidth,
    ),
  ).toBe(12);

  // Projects with the same name show their slugs, so they can be told apart.
  await page.goto("/");
  const cards = page.getByRole("link").filter({ hasText: project.name });
  await expect(cards).toHaveCount(2);
  await expect(cards.filter({ hasText: `${project.slug}-2` })).toHaveCount(1);
});

test("shows why a file can't be imported", async ({ page }) => {
  await page.goto("/");

  await chooseFile(page, "notes.txt", strToU8("not a zip"));
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText(
    "Couldn't import notes.txt",
  );
  await expect(dialog).toContainText("This file isn't a zip file.");
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(dialog).toBeHidden();

  const document = {
    format: "api-contract-builder/project",
    formatVersion: 1,
    project: {
      id: "p",
      name: uniqueName("Broken"),
      slug: "Not A Slug",
      description: "",
      apiVersion: "1.0.0",
      servers: [],
      securitySchemes: [],
      defaultSecuritySchemeId: null,
    },
    models: [{ id: "m", name: "Bad name", description: "", schema: {} }],
    errorTypes: [],
    endpoints: [],
    pages: [],
  };
  await chooseFile(
    page,
    "broken.project.zip",
    zipSync({ "broken/project.json": strToU8(JSON.stringify(document)) }),
  );
  await expect(dialog.getByRole("heading")).toHaveText(
    "Couldn't import broken.project.zip",
  );
  await expect(dialog).toContainText("it has 2 problems");
  await expect(dialog.getByRole("listitem")).toHaveText([
    /Use lowercase letters.*project\.slug/,
    /Model Bad name: Use letters.*models\.0\.name/,
  ]);
});

test("refuses a file larger than the instance imports before sending it", async ({
  page,
}) => {
  await page.route("**/api/health", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), maxImportBytes: 100 },
    });
  });
  let sent = false;
  await page.route("**/api/projects/import", (route) => {
    sent = true;
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("banner").getByText(/^v\d/)).toBeVisible();

  await chooseFile(page, "big.project.zip", new Uint8Array(500));

  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "This file is 500 bytes; this instance imports up to 100 bytes (MAX_IMPORT_MB).",
  );
  expect(sent).toBe(false);
});

/** Holds the import request until `release` is called. */
async function holdImports(page: Page) {
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/import", async (route) => {
    await held;
    await route.continue();
  });
  return () => release();
}

test("stays busy while a file imports, even after leaving and coming back", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  const file = await projectFile(request, project.id);
  const release = await holdImports(page);
  await page.goto("/");

  await chooseFile(page, "move.project.zip", file);
  await expect(page.getByRole("button", { name: "Importing…" })).toBeDisabled();
  await page.getByRole("link").filter({ hasText: project.name }).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  // Rendered, so the Projects page is really gone.
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  await page.getByRole("link", { name: "API Contract Builder" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "Projects" })).toBeVisible();
  // A new button on the page shows the import that's still running.
  await expect(
    page.getByRole("button", { name: "Import project" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Importing…" })).toBeDisabled();

  release();
  // Having left once, nobody is taken anywhere: the toast offers the project.
  await expect(page.getByText(`Imported ${project.name}`)).toBeVisible();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("button", { name: "Import project" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  expect(page.url()).not.toContain(project.id);
});

test("offers to open an import that finished after you moved on", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  const file = await projectFile(request, project.id);
  const release = await holdImports(page);
  await page.goto("/");

  await chooseFile(page, "move.project.zip", file);
  await page.getByRole("link").filter({ hasText: project.name }).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  // Rendered, so the Projects page is really gone.
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  release();

  await expect(page.getByText(`Imported ${project.name}`)).toBeVisible();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  await page.getByRole("button", { name: "Open" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  expect(page.url()).not.toContain(project.id);
});

test("says an import failed even after you moved on", async ({
  page,
  request,
}) => {
  const { project } = await setUp(request);
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/projects/import", async (route) => {
    await held;
    await route.fulfill({
      status: 400,
      json: {
        error: "This project file can't be imported: it has 1 problem.",
        issues: [
          { path: "models.0.name", message: "Model Bad name: Use letters" },
        ],
      },
    });
  });
  await page.goto("/");

  await chooseFile(
    page,
    "broken.project.zip",
    zipSync({ "a.txt": strToU8("x") }),
  );
  await page.getByRole("link").filter({ hasText: project.name }).click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
  // Rendered, so the Projects page is really gone.
  await expect(page.getByRole("heading", { name: project.name })).toBeVisible();
  release();

  await expect(
    page.getByText("Couldn't import broken.project.zip"),
  ).toBeVisible();
  await expect(
    page.getByText("This project file can't be imported: it has 1 problem."),
  ).toBeVisible();
  await expect(page).toHaveURL(`/projects/${project.id}`);
});
