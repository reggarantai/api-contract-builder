import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import {
  createEndpoint,
  createErrorType,
  createModel,
  createPage,
  createProject,
  settingsSection,
  uniqueName,
} from "./helpers";

const NO_HEADERS = { type: "object", properties: {} };

// Every editor keeps what the user typed when the item changes elsewhere,
// and asks before saving over a save made since in another tab or window.

/** Two tabs on the same editor. */
async function twoTabs(context: BrowserContext, url: string) {
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(url);
  await b.goto(url);
  return { a, b };
}

/** Waits until the tab fetches `apiUrl` again, as it does when it becomes visible. */
async function refetch(tab: Page, apiUrl: string) {
  let fetched = 0;
  tab.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === apiUrl
    ) {
      fetched++;
    }
  });
  await expect
    .poll(async () => {
      await tab.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      return fetched;
    })
    .toBeGreaterThan(0);
}

const save = (scope: Page | Locator) =>
  scope.getByRole("button", { name: "Save", exact: true });

async function expectConflict(tab: Page, what: string) {
  const dialog = tab.getByRole("alertdialog");
  await expect(dialog).toContainText(
    `This ${what} changed since you started editing`,
  );
  return dialog;
}

test("keeps unsaved endpoint changes, and asks before saving over another tab's", async ({
  context,
  request,
}) => {
  const project = await createProject(request, uniqueName("Endpoint tabs"));
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/items",
  });
  const apiUrl = `/api/projects/${project.id}/endpoints/${endpoint.id}`;
  const { a, b } = await twoTabs(
    context,
    `/projects/${project.id}/endpoints/${endpoint.id}`,
  );
  const summary = (tab: Page) => tab.locator("#endpoint-editor-summary");

  await summary(a).fill("Typed in tab A");
  await summary(b).fill("Saved in tab B");
  await save(b).click();
  await expect(b.getByText("Endpoint saved")).toBeVisible();
  await refetch(a, apiUrl);
  await expect(summary(a)).toHaveValue("Typed in tab A");

  await save(a).click();
  const dialog = await expectConflict(a, "endpoint");
  await dialog.getByRole("button", { name: "Load the saved version" }).click();
  await expect(dialog).toBeHidden();
  await expect(summary(a)).toHaveValue("Saved in tab B");
  await expect(save(a)).toBeDisabled();
});

test("asks before saving a model over another tab's, and can save anyway", async ({
  context,
  request,
}) => {
  const project = await createProject(request, uniqueName("Model tabs"));
  const model = await createModel(request, project.id, { name: "Item" });
  const { a, b } = await twoTabs(
    context,
    `/projects/${project.id}/models/${model.id}`,
  );
  const description = (tab: Page) => tab.locator("#model-editor-description");

  await description(a).fill("From tab A");
  await description(b).fill("From tab B");
  await save(b).click();
  await expect(b.getByText("Model saved")).toBeVisible();
  await save(a).click();
  const dialog = await expectConflict(a, "model");
  await dialog.getByRole("button", { name: "Save mine anyway" }).click();
  await expect(a.getByText("Model saved")).toBeVisible();
  await expect(dialog).toBeHidden();

  const saved = await request.get(
    `/api/projects/${project.id}/models/${model.id}`,
  );
  expect(((await saved.json()) as { description: string }).description).toBe(
    "From tab A",
  );
  await expect(save(a)).toBeDisabled();
});

test("asks before saving an error type over another tab's", async ({
  context,
  request,
}) => {
  const project = await createProject(request, uniqueName("Error tabs"));
  const errorType = await createErrorType(request, project.id, {
    name: "not-found",
    status: "404",
    title: "Not found",
  });
  const { a, b } = await twoTabs(
    context,
    `/projects/${project.id}/error-types/${errorType.id}`,
  );
  const title = (tab: Page) => tab.locator("#error-type-editor-title");

  await title(a).fill("Not found, from tab A");
  await title(b).fill("Not found, from tab B");
  await save(b).click();
  await expect(b.getByText("Error type saved")).toBeVisible();
  await save(a).click();
  const dialog = await expectConflict(a, "error type");
  await dialog.getByRole("button", { name: "Load the saved version" }).click();
  await expect(dialog).toBeHidden();

  await expect(title(a)).toHaveValue("Not found, from tab B");
});

test("lets each settings section save on its own, and asks when another tab saved the same one", async ({
  context,
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Settings tabs"));
  await page.goto(`/projects/${project.id}/settings`);
  const general = settingsSection(page, "General");
  const servers = settingsSection(page, "Servers");

  // Saving another section in the same tab doesn't conflict with this one.
  await page.locator("#settings-description").fill("Typed in General");
  await servers.getByRole("button", { name: "Add server" }).click();
  await page.locator("#server-0-name").fill("Production");
  await page.locator("#server-0-url").fill("https://api.example.com/v1");
  await save(servers).click();
  await expect(page.getByText("Servers saved")).toBeVisible();
  await expect(page.locator("#settings-description")).toHaveValue(
    "Typed in General",
  );
  await save(general).click();
  await expect(page.getByText("General settings saved")).toBeVisible();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);

  // Another tab saving the same section does.
  const other = await context.newPage();
  await other.goto(`/projects/${project.id}/settings`);
  await page.locator("#settings-description").fill("From this tab");
  await other.locator("#settings-description").fill("From the other tab");
  await save(settingsSection(other, "General")).click();
  await expect(other.getByText("General settings saved")).toBeVisible();
  await save(general).click();
  const dialog = await expectConflict(page, "project");
  await dialog.getByRole("button", { name: "Load the saved version" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#settings-description")).toHaveValue(
    "From the other tab",
  );
});

/** An endpoint whose `empty` example a page state comes from. */
async function endpointWithState(request: APIRequestContext) {
  const project = await createProject(request, uniqueName("States tabs"));
  const endpoint = await createEndpoint(
    request,
    project.id,
    { method: "GET", path: "/items" },
    {
      responses: [
        {
          id: "r200",
          status: "200",
          description: "OK",
          headers: NO_HEADERS,
          body: {
            contentType: "application/json",
            schema: { type: "object" },
            examples: [
              {
                id: "x1",
                name: "first-page",
                summary: "",
                value: { data: [1] },
              },
              { id: "x2", name: "empty", summary: "", value: { data: [] } },
            ],
          },
          errors: [],
        },
      ],
    },
  );
  const page = await createPage(request, project.id, "Items");
  const pageUrl = `/api/projects/${project.id}/pages/${page.id}`;
  const linked = await request.patch(pageUrl, {
    data: {
      endpoints: [
        { id: "l1", endpointId: endpoint.id, trigger: "on_load", note: "" },
      ],
      states: [
        {
          id: "s1",
          kind: "empty",
          name: "No items",
          description: "",
          causes: [
            {
              type: "response",
              linkId: "l1",
              responseId: "r200",
              exampleId: "x2",
            },
          ],
          mockupIds: [],
        },
      ],
    },
  });
  expect(linked.status()).toBe(200);
  return {
    url: `/projects/${project.id}/endpoints/${endpoint.id}`,
    async saved() {
      const response = await request.get(
        `/api/projects/${project.id}/endpoints/${endpoint.id}`,
      );
      return (await response.json()) as {
        summary: string;
        responses: { body: { examples: { name: string }[] } }[];
      };
    },
    async stateCauses() {
      const response = await request.get(pageUrl);
      return ((await response.json()) as { states: { causes: unknown[] }[] })
        .states[0]?.causes;
    },
  };
}

const removeEmptyExample = (tab: Page) =>
  tab
    .getByRole("region", { name: "Response 200" })
    .getByRole("button", { name: "Remove example" })
    .nth(1)
    .click();

const statesDialog = (tab: Page) =>
  tab.getByRole("alertdialog", {
    name: "Page states use what you're removing",
  });

test("closes the states dialog when its save meets a conflict, so nothing dropped gets saved", async ({
  context,
  request,
}) => {
  const fixture = await endpointWithState(request);
  const { a, b } = await twoTabs(context, fixture.url);
  const summary = (tab: Page) => tab.locator("#endpoint-editor-summary");

  await summary(a).fill("Mine");
  await removeEmptyExample(a);
  await save(a).click();
  await expect(statesDialog(a)).toBeVisible();
  await summary(b).fill("From elsewhere");
  await save(b).click();
  await expect(b.getByText("Endpoint saved")).toBeVisible();

  await statesDialog(a)
    .getByRole("button", { name: "Remove from states and save" })
    .click();
  const conflict = a.getByRole("alertdialog", {
    name: "This endpoint changed since you started editing",
  });
  await expect(conflict).toBeVisible();
  await expect(statesDialog(a)).toHaveCount(0);
  await conflict
    .getByRole("button", { name: "Load the saved version" })
    .click();

  await expect(a.getByRole("alertdialog")).toHaveCount(0);
  await expect(summary(a)).toHaveValue("From elsewhere");
  const saved = await fixture.saved();
  expect(saved.summary).toBe("From elsewhere");
  expect(saved.responses[0]?.body.examples).toHaveLength(2);
  expect(await fixture.stateCauses()).toHaveLength(1);
});

test("remembers saving over another tab's when that save then needs the states removed", async ({
  context,
  request,
}) => {
  const fixture = await endpointWithState(request);
  const { a, b } = await twoTabs(context, fixture.url);
  await b.locator("#endpoint-editor-summary").fill("From elsewhere");
  await save(b).click();
  await expect(b.getByText("Endpoint saved")).toBeVisible();

  await removeEmptyExample(a);
  await save(a).click();
  await a
    .getByRole("alertdialog", {
      name: "This endpoint changed since you started editing",
    })
    .getByRole("button", { name: "Save mine anyway" })
    .click();
  await statesDialog(a)
    .getByRole("button", { name: "Remove from states and save" })
    .click();

  await expect(a.getByText("Endpoint saved")).toBeVisible();
  await expect(a.getByRole("alertdialog")).toHaveCount(0);
  const saved = await fixture.saved();
  expect(saved.responses[0]?.body.examples.map((item) => item.name)).toEqual([
    "first-page",
  ]);
  expect(await fixture.stateCauses()).toEqual([]);
});

test("remembers saving over another tab's when that save is then refused for a field", async ({
  context,
  request,
}) => {
  const project = await createProject(request, uniqueName("Refused tabs"));
  const model = await createModel(request, project.id, { name: "Item" });
  await createModel(request, project.id, { name: "Other" });
  const { a, b } = await twoTabs(
    context,
    `/projects/${project.id}/models/${model.id}`,
  );
  await b.locator("#model-editor-description").fill("From tab B");
  await save(b).click();
  await expect(b.getByText("Model saved")).toBeVisible();

  await a.locator("#model-editor-name").fill("Other");
  await a.locator("#model-editor-description").fill("From tab A");
  await save(a).click();
  const conflict = a.getByRole("alertdialog", {
    name: "This model changed since you started editing",
  });
  await conflict.getByRole("button", { name: "Save mine anyway" }).click();
  await expect(a.getByText("Already used by another model")).toBeVisible();
  await a.locator("#model-editor-name").fill("ItemTwo");
  await save(a).click();

  await expect(a.getByText("Model saved")).toBeVisible();
  await expect(conflict).toHaveCount(0);
  const saved = await request.get(
    `/api/projects/${project.id}/models/${model.id}`,
  );
  expect(await saved.json()).toMatchObject({
    name: "ItemTwo",
    description: "From tab A",
  });
});

test("locks the form while it saves, and gives the focus back", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Locked"));
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/items",
  });
  // A slow save, so there's time to type while it runs.
  await page.route(
    `**/api/projects/${project.id}/endpoints/${endpoint.id}`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      await route.continue();
    },
  );
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);
  const summary = page.locator("#endpoint-editor-summary");

  await summary.fill("First");
  await summary.press("Enter");
  await page.keyboard.type(" and more");
  // Still saving: what was typed went nowhere, rather than into the form.
  expect(await page.getByText("Endpoint saved").count()).toBe(0);
  expect(await summary.inputValue()).toBe("First");

  await expect(page.getByText("Endpoint saved")).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary).toHaveValue("First");
  await expect(save(page)).toBeDisabled();
});
