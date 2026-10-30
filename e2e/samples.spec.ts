import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { unzipSync } from "fflate";
import { projectTab } from "./helpers";

test("creates the sample project from the empty state", async ({ page }) => {
  // Other tests share the database, so pretend there are no projects yet.
  await page.route("**/api/projects", (route) =>
    route.request().method() === "GET"
      ? route.fulfill({ json: [] })
      : route.continue(),
  );
  await page.goto("/");

  await expect(page.getByText("No projects yet")).toBeVisible();
  await page.getByRole("button", { name: "Create sample project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  await expect(
    page.getByRole("heading", { name: "Inventory App" }),
  ).toBeVisible();
  await projectTab(page, "Pages").click();
  await expect(
    page.getByRole("list", { name: "Pages" }).getByRole("link"),
  ).toHaveText(["Login", "Registration", "Stock list", "Create schedule"]);
});

test("offers the sample next to existing projects too", async ({
  page,
  request,
}) => {
  await request.post("/api/samples");
  await page.goto("/");

  await page.getByRole("button", { name: "Create sample project" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  await expect(page.getByText("Created the sample project")).toBeVisible();
});

test("the sample exports right away", async ({ page, request }) => {
  const created = await request.post("/api/samples");
  const project = (await created.json()) as { id: string; slug: string };
  await page.goto(`/projects/${project.id}/export`);

  await expect(page.getByText("Valid OpenAPI 3.1")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Warnings" }).getByRole("listitem"),
  ).toHaveCount(2);

  const started = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Markdown" }).click();
  const zip = await started;
  const files = Object.keys(
    unzipSync(new Uint8Array(fs.readFileSync(await zip.path()))),
  );
  expect(files).toEqual(
    expect.arrayContaining([
      `${project.slug}/pages/login.md`,
      `${project.slug}/pages/registration.md`,
      `${project.slug}/pages/stock-list.md`,
      `${project.slug}/pages/create-schedule.md`,
      `${project.slug}/images/login/01-login-form.png`,
      `${project.slug}/${project.slug}.openapi.yaml`,
    ]),
  );
});
