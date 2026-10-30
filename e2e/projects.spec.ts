import { expect, test } from "@playwright/test";
import {
  createProject,
  projectTab,
  settingsSection,
  uniqueName,
} from "./helpers";

const bearerScheme = {
  id: "bearer",
  key: "bearerAuth",
  type: "bearer",
  bearerFormat: "JWT",
  description: "",
};
const apiKeyScheme = {
  id: "api-key",
  key: "apiKeyAuth",
  type: "apiKey",
  in: "header",
  name: "X-API-Key",
  description: "",
};

test("shows an empty state when there are no projects", async ({ page }) => {
  await page.route("**/api/projects", (route) => route.fulfill({ json: [] }));
  await page.goto("/");

  await expect(page.getByText("No projects yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "New project" })).toBeVisible();
});

test("creates a project", async ({ page }) => {
  const name = uniqueName("Inventory");
  await page.goto("/");

  await page.getByRole("button", { name: "New project" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill(name);
  await expect(dialog.getByLabel("Slug")).toHaveAttribute(
    "placeholder",
    name.toLowerCase().replace(" ", "-"),
  );
  await dialog.getByLabel("Description").fill("Stock and warehouse API");
  await dialog.getByRole("button", { name: "Create project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByText("Stock and warehouse API")).toBeVisible();
});

test("validates and saves servers", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Servers"));
  await page.goto(`/projects/${project.id}/settings`);
  const servers = settingsSection(page, "Servers");

  await servers.getByRole("button", { name: "Add server" }).click();
  await page.locator("#server-0-name").fill("Production");
  await page.locator("#server-0-url").fill("https://api.example.com/v1");
  await servers.getByRole("button", { name: "Add server" }).click();
  await page.locator("#server-1-name").fill("Staging");
  await page.locator("#server-1-url").fill("ftp://staging.example.com");
  await servers.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByText("Use an absolute http(s) URL or a path starting with /"),
  ).toBeVisible();

  await page.locator("#server-1-url").fill("https://staging.example.com/v1");
  await servers.getByRole("button", { name: "Move up" }).nth(1).click();
  await servers.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Servers saved")).toBeVisible();
  await expect(servers.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.reload();
  await expect(page.locator("#server-0-name")).toHaveValue("Staging");
  await expect(page.locator("#server-1-url")).toHaveValue(
    "https://api.example.com/v1",
  );
});

test("edits authentication schemes", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Auth"));
  await page.goto(`/projects/${project.id}/settings`);
  const auth = settingsSection(page, "Authentication");

  await auth.getByRole("button", { name: "Add scheme" }).click();
  await expect(page.locator("#scheme-0-key")).toHaveValue("bearerAuth");
  await page.locator("#scheme-0-format").fill("JWT");
  await auth.getByRole("button", { name: "Add scheme" }).click();
  await expect(page.locator("#scheme-1-key")).toHaveValue("bearerAuth2");

  // Switching type replaces a suggested key with the new type's suggestion.
  await page.locator("#scheme-1-type").click();
  await page.getByRole("option", { name: "API key" }).click();
  await expect(page.locator("#scheme-1-key")).toHaveValue("apiKeyAuth");
  await expect(page.locator("#scheme-1-name")).toHaveValue("X-API-Key");

  await page.locator("#default-scheme").click();
  await page.getByRole("option", { name: "bearerAuth" }).click();
  await auth.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Authentication saved")).toBeVisible();

  await page.locator("#scheme-1-key").fill("bearerAuth");
  await auth.getByRole("button", { name: "Save" }).click();
  await expect(auth.getByText("Key must be unique")).toBeVisible();
  await auth.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.locator("#scheme-1-key")).toHaveValue("apiKeyAuth");
  await expect(auth.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.reload();
  await expect(page.locator("#scheme-0-format")).toHaveValue("JWT");
  await expect(page.locator("#scheme-1-name")).toHaveValue("X-API-Key");
});

test("shows servers and authentication on the overview", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Overview"), {
    servers: [
      {
        id: "s1",
        name: "Production",
        url: "https://api.example.com/v1",
        description: "",
      },
    ],
    securitySchemes: [bearerScheme, apiKeyScheme],
    defaultSecuritySchemeId: "bearer",
  });

  await page.goto(`/projects/${project.id}`);

  await expect(page.getByText("https://api.example.com/v1")).toBeVisible();
  await expect(page.getByText("Authorization: Bearer JWT")).toBeVisible();
  await expect(page.getByText("X-API-Key header")).toBeVisible();
});

test("renders the description as Markdown, and its first paragraph on the card", async ({
  page,
  request,
}) => {
  const name = uniqueName("Described");
  const project = await createProject(request, name, {
    description:
      "Stock tracking for the warehouse.\n\n- **Errors** are problem details\n- Times are UTC",
  });

  await page.goto(`/projects/${project.id}`);

  const description = page.getByRole("region", { name: "Description" });
  await expect(description.getByRole("listitem")).toHaveText([
    "Errors are problem details",
    "Times are UTC",
  ]);
  await expect(description.locator("strong")).toHaveText("Errors");

  await page.goto("/");
  const card = page.getByRole("link", { name: new RegExp(name) });
  await expect(card).toContainText("Stock tracking for the warehouse.");
  await expect(card).not.toContainText("Errors");
});

test("shows a slug conflict from the server on the field", async ({
  page,
  request,
}) => {
  const taken = await createProject(request, uniqueName("Taken"));
  const project = await createProject(request, uniqueName("Other"));
  await page.goto(`/projects/${project.id}/settings`);
  const general = settingsSection(page, "General");

  await page.locator("#settings-slug").fill(taken.slug);
  await general.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("Already used by another project")).toBeVisible();
});

test("switches projects from the header", async ({ page, request }) => {
  const first = await createProject(request, uniqueName("First"));
  const second = await createProject(request, uniqueName("Second"));
  await page.goto(`/projects/${second.id}`);

  await page.getByRole("button", { name: second.name }).click();
  await page.getByRole("menuitem", { name: first.name }).click();

  await expect(page).toHaveURL(`/projects/${first.id}`);
  await expect(page.getByRole("heading", { name: first.name })).toBeVisible();
  await expect(projectTab(page, "Overview")).toBeVisible();
});

test("deletes a project after typing its name", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Doomed"));
  await page.goto(`/projects/${project.id}/settings`);

  await page.getByRole("button", { name: "Delete project" }).click();
  const dialog = page.getByRole("alertdialog");
  const confirm = dialog.getByRole("button", { name: "Delete project" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/to confirm/).fill(project.name);
  await confirm.click();

  await expect(page).toHaveURL("/");
  await expect(page.getByText(`Deleted ${project.name}`)).toBeVisible();
  await expect(page.getByRole("link", { name: project.name })).toHaveCount(0);
});

test("shows not found for unknown projects", async ({ page }) => {
  await page.goto("/projects/does-not-exist");

  await expect(
    page.getByText("This page or project doesn't exist"),
  ).toBeVisible();
});
