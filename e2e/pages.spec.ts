import { expect, type Page, test } from "@playwright/test";
import { makePng } from "../test/images";
import {
  createEndpoint,
  createPage,
  createProject,
  getPage,
  projectTab,
  uniqueName,
} from "./helpers";

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function choose(
  page: Page,
  scope: ReturnType<Page["locator"]>,
  combobox: string,
  option: string,
) {
  await scope.getByRole("combobox", { name: combobox, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

const png = (name: string) => ({
  name,
  mimeType: "image/png",
  buffer: makePng(4, 3),
});

/** Waits for a request to finish, so the test can check the server afterwards. */
function waitForApi(page: Page, method: string, urlPart: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().includes(urlPart),
  );
}

test("creates a page and writes its description and acceptance criteria", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Pages"));
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Pages").click();

  await expect(page.getByText("No pages yet")).toBeVisible();
  await page.getByRole("button", { name: "Create a page" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Login");
  await page.getByRole("button", { name: "Create page" }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9A-Z]{26}\/edit$/);

  const description = page.getByRole("group", { name: "Description" });
  await description
    .getByRole("textbox")
    .fill("## Sign in\n\nUsers sign in with **email** and password.");
  await description.getByRole("tab", { name: "Preview" }).click();
  await expect(
    description.getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();

  await page
    .getByRole("group", { name: "Acceptance criteria" })
    .getByRole("textbox")
    .fill(
      "- [x] A wrong password shows an error\n- [ ] The email is remembered",
    );

  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Page saved")).toBeVisible();

  await page.getByRole("link", { name: "View page" }).click();
  await expect(page).toHaveURL(/\/pages\/[0-9A-Z]{26}$/);
  await expect(
    page.getByRole("heading", { name: "Login", level: 2 }),
  ).toBeVisible();
  await expect(
    region(page, "Description").getByRole("heading", { name: "Sign in" }),
  ).toBeVisible();
  await expect(region(page, "Description").locator("strong")).toHaveText(
    "email",
  );
  const criteria = region(page, "Acceptance criteria").getByRole("checkbox");
  await expect(criteria).toHaveCount(2);
  await expect(criteria.first()).toBeChecked();
});

test("uploads, captions, orders, and deletes mockups", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Mockups"));
  const login = await createPage(request, project.id, "Login");
  await page.goto(`/projects/${project.id}/pages/${login.id}/edit`);
  const mockups = region(page, "Mockups");

  const uploaded = waitForApi(page, "POST", "/mockups");
  await mockups
    .getByLabel("Upload mockups")
    .setInputFiles([png("form.png"), png("error.png")]);
  expect((await uploaded).status()).toBe(201);
  await expect(mockups.getByRole("img")).toHaveCount(2);

  // Captions save when the field loses focus.
  const captioned = waitForApi(page, "PATCH", "/mockups/");
  await mockups
    .getByRole("textbox", { name: "Caption for error.png" })
    .fill("Wrong password");
  await mockups.getByRole("textbox", { name: "Caption for error.png" }).blur();
  expect((await captioned).status()).toBe(200);

  const reordered = waitForApi(page, "PUT", "/mockups/order");
  await mockups.getByRole("button", { name: "Move error.png left" }).click();
  expect((await reordered).status()).toBe(200);

  await mockups.getByLabel("Upload mockups").setInputFiles({
    name: "notes.png",
    mimeType: "image/png",
    buffer: Buffer.from("just text"),
  });
  await expect(
    page.getByText("notes.png isn't a PNG, JPEG, GIF, or WebP image"),
  ).toBeVisible();

  // Files can also be dropped onto the upload area.
  const dropped = waitForApi(page, "POST", "/mockups");
  const transfer = await page.evaluateHandle(
    (bytes) => {
      const data = new DataTransfer();
      data.items.add(
        new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }),
      );
      return data;
    },
    [...makePng(4, 3)],
  );
  await mockups
    .getByText("Drop images here")
    .dispatchEvent("drop", { dataTransfer: transfer });
  expect((await dropped).status()).toBe(201);
  await expect(mockups.getByRole("img")).toHaveCount(3);

  await mockups.getByRole("button", { name: "Delete form.png" }).click();
  const deleted = waitForApi(page, "DELETE", "/mockups/");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete mockup" })
    .click();
  expect((await deleted).status()).toBe(204);
  await expect(mockups.getByRole("img")).toHaveCount(2);

  expect((await getPage(request, project.id, login.id)).mockups).toMatchObject([
    { originalName: "error.png", caption: "Wrong password" },
    { originalName: "dropped.png", caption: "" },
  ]);

  // The read-only view shows them in a lightbox.
  await page.getByRole("link", { name: "View page" }).click();
  await expect(page.getByRole("link", { name: "Edit page" })).toBeVisible();
  await region(page, "Mockups")
    .getByRole("button", { name: "Open Wrong password" })
    .click();
  const lightbox = page.getByRole("dialog");
  await expect(
    lightbox.getByRole("img", { name: "Wrong password" }),
  ).toBeVisible();
  await lightbox.getByRole("button", { name: "Next mockup" }).click();
  await expect(
    lightbox.getByRole("img", { name: "dropped.png" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(lightbox).toHaveCount(0);
});

test("links endpoints with triggers, including a new one", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Links"));
  const login = await createEndpoint(request, project.id, {
    method: "POST",
    path: "/auth/login",
    summary: "Sign in",
  });
  await createEndpoint(request, project.id, {
    method: "GET",
    path: "/me",
    summary: "Current user",
  });
  const loginPage = await createPage(request, project.id, "Login");
  await page.goto(`/projects/${project.id}/pages/${loginPage.id}/edit`);
  const endpoints = region(page, "Endpoints");

  await endpoints.getByRole("button", { name: "Add endpoint" }).click();
  const first = endpoints.getByRole("group", { name: "Endpoint 1" });
  await choose(page, first, "Endpoint", "POST /auth/login — Sign in");
  await choose(page, first, "Trigger", "On form submit");
  await first.getByRole("textbox", { name: "Note" }).fill("Show errors inline");

  await endpoints.getByRole("button", { name: "New endpoint" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Path" }).fill("/session");
  await dialog.getByRole("textbox", { name: "Summary" }).fill("Check session");
  await dialog.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page).toHaveURL(
    `/projects/${project.id}/pages/${loginPage.id}/edit`,
  );
  const second = endpoints.getByRole("group", { name: "Endpoint 2" });
  await expect(second.getByRole("combobox", { name: "Endpoint" })).toHaveText(
    "GET /session — Check session",
  );
  await expect(second.getByRole("combobox", { name: "Trigger" })).toHaveText(
    "When the page loads",
  );

  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  expect(
    (await getPage(request, project.id, loginPage.id)).endpoints,
  ).toMatchObject([
    { endpointId: login.id, trigger: "on_submit", note: "Show errors inline" },
    { trigger: "on_load", note: "" },
  ]);

  await page.getByRole("link", { name: "View page" }).click();
  // The editor has an "Endpoints" region too, and the URL changes before the
  // view renders; wait for something only the view has.
  await expect(page).toHaveURL(`/projects/${project.id}/pages/${loginPage.id}`);
  await expect(page.getByRole("link", { name: "Edit page" })).toBeVisible();
  const used = region(page, "Endpoints");
  await expect(used.getByText("/auth/login")).toBeVisible();
  await expect(used.getByText("On form submit")).toBeVisible();
  await expect(used.getByText("Show errors inline")).toBeVisible();

  await projectTab(page, "Endpoints").click();
  await page.getByRole("combobox", { name: "Page filter" }).click();
  await page.getByRole("option", { name: "Login", exact: true }).click();
  const rows = page.getByRole("list", { name: "Endpoints" }).getByRole("link");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "/me" })).toHaveCount(0);
});

test("reorders pages", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Order"));
  for (const name of ["A", "B", "C"]) {
    await createPage(request, project.id, name);
  }
  await page.goto(`/projects/${project.id}/pages`);
  const list = page.getByRole("list", { name: "Pages" });

  await list.getByRole("button", { name: "Move C up" }).click();
  await list.getByRole("button", { name: "Move C up" }).click();

  await expect(list.getByRole("listitem")).toHaveText([/^C/, /^A/, /^B/]);
  await page.reload();
  await expect(list.getByRole("listitem")).toHaveText([/^C/, /^A/, /^B/]);
});

test("deletes a page", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Delete"));
  const doomed = await createPage(request, project.id, "Doomed");
  await page.goto(`/projects/${project.id}/pages/${doomed.id}/edit`);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete page" })
    .click();

  await expect(page).toHaveURL(`/projects/${project.id}/pages`);
  await expect(page.getByText("Deleted Doomed")).toBeVisible();
  await expect(page.getByText("No pages yet")).toBeVisible();
});

test("leaves right after saving without asking about unsaved changes", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Leave"));
  const draft = await createPage(request, project.id, "Draft");
  const endpoints = [];
  for (const path of ["/a", "/b", "/c", "/d"]) {
    endpoints.push(
      await createEndpoint(request, project.id, { method: "GET", path }),
    );
  }
  // Links make re-rendering after a save slower, widening the gap it races with.
  await request.patch(`/api/projects/${project.id}/pages/${draft.id}`, {
    data: {
      endpoints: endpoints.map((endpoint, index) => ({
        id: `l${index}`,
        endpointId: endpoint.id,
        trigger: "on_load",
        note: "",
      })),
    },
  });
  await page.goto(`/projects/${project.id}/pages/${draft.id}/edit`);
  const prompts: string[] = [];
  page.on("dialog", (dialog) => {
    prompts.push(dialog.message());
    void dialog.dismiss();
  });

  await page.getByLabel("Name").fill("Checkout");
  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  await saved;
  await page.getByRole("link", { name: "View page" }).click();

  await expect(page).toHaveURL(`/projects/${project.id}/pages/${draft.id}`);
  expect(prompts).toEqual([]);
});
