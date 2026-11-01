import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { makePng } from "../test/images";
import {
  createEndpoint,
  createErrorType,
  createPage,
  createProject,
  uniqueName,
} from "./helpers";

const NO_HEADERS = { type: "object", properties: {} };

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

function waitForApi(page: Page, method: string, urlPart: string) {
  return page.waitForResponse(
    (response) =>
      response.request().method() === method &&
      response.url().includes(urlPart),
  );
}

/**
 * A Stock list page that lists items and deletes them, with an `empty` list
 * example and a 409 error type, and two mockups.
 */
async function stockList(request: APIRequestContext) {
  const project = await createProject(request, uniqueName("States"));
  const stock = await createErrorType(request, project.id, {
    name: "item-has-stock",
    status: "409",
    title: "Item still in stock",
  });
  const list = await createEndpoint(
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
  const remove = await createEndpoint(
    request,
    project.id,
    { method: "DELETE", path: "/items/{id}" },
    {
      responses: [
        {
          id: "r204",
          status: "204",
          description: "No Content",
          headers: NO_HEADERS,
          body: null,
          errors: [],
        },
        {
          id: "r409",
          status: "409",
          description: "Conflict",
          headers: NO_HEADERS,
          body: null,
          errors: [{ errorTypeId: stock.id, examples: [] }],
        },
      ],
    },
  );
  const page = await createPage(request, project.id, "Stock list");
  const pageUrl = `/api/projects/${project.id}/pages/${page.id}`;
  const linked = await request.patch(pageUrl, {
    data: {
      endpoints: [
        { id: "l1", endpointId: list.id, trigger: "on_load", note: "" },
        { id: "l2", endpointId: remove.id, trigger: "on_action", note: "" },
      ],
    },
  });
  expect(linked.status()).toBe(200);
  const mockupIds: Record<string, string> = {};
  for (const name of ["empty.png", "list.png"]) {
    const uploaded = await request.post(`${pageUrl}/mockups`, {
      multipart: {
        files: { name, mimeType: "image/png", buffer: makePng(4, 3) },
      },
    });
    expect(uploaded.status()).toBe(201);
    const [mockup] = (await uploaded.json()) as { id: string }[];
    mockupIds[name] = mockup?.id ?? "";
  }
  const noItems = {
    id: "s1",
    kind: "empty",
    name: "No items",
    description: "",
    causes: [
      { type: "response", linkId: "l1", responseId: "r200", exampleId: "x2" },
    ],
    mockupIds: [mockupIds["empty.png"]],
  };
  const cantDelete = {
    id: "s2",
    kind: "error",
    name: "Can't delete",
    description: "",
    causes: [
      { type: "error", linkId: "l2", errorTypeId: stock.id, exampleId: null },
    ],
    mockupIds: [],
  };
  return {
    project,
    page,
    list,
    mockupIds,
    states: { noItems, cantDelete },
    async setStates(states: unknown[]) {
      const response = await request.patch(pageUrl, { data: { states } });
      expect(response.status()).toBe(200);
    },
    async getStates() {
      const response = await request.get(pageUrl);
      return ((await response.json()) as { states: unknown[] }).states;
    },
  };
}

test("describes a page's states, with mockups and the responses that lead to them", async ({
  page,
  request,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const fixture = await stockList(request);
  await page.goto(
    `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`,
  );
  const states = region(page, "States");

  await states.getByRole("button", { name: "Add state" }).click();
  const loading = states.getByRole("group", { name: "State 1" });
  await choose(page, loading, "Kind", "Loading");
  await loading.getByRole("textbox", { name: "Name" }).fill("Loading items");
  await loading.getByRole("button", { name: "Add cause" }).click();
  await choose(page, loading, "Cause 1", "GET /items — while it runs");

  await states.getByRole("button", { name: "Add state" }).click();
  const empty = states.getByRole("group", { name: "State 2" });
  await choose(page, empty, "Kind", "Empty");
  await empty.getByRole("textbox", { name: "Name" }).fill("No items");
  await empty
    .getByRole("group", { name: "Description" })
    .getByRole("textbox")
    .fill("Offers to clear the filters.");
  await empty.getByRole("button", { name: "Add cause" }).click();
  await choose(page, empty, "Cause 1", "GET /items — 200 OK, example empty");
  await empty.getByRole("checkbox", { name: "empty.png" }).check();

  await states.getByRole("button", { name: "Add state" }).click();
  const error = states.getByRole("group", { name: "State 3" });
  await choose(page, error, "Kind", "Error");
  await error.getByRole("textbox", { name: "Name" }).fill("Can't delete");
  await error.getByRole("button", { name: "Add cause" }).click();
  await choose(
    page,
    error,
    "Cause 1",
    "DELETE /items/{id} — 409 item-has-stock",
  );

  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Page saved")).toBeVisible();
  expect(await fixture.getStates()).toMatchObject([
    {
      kind: "loading",
      name: "Loading items",
      causes: [{ type: "request", linkId: "l1" }],
      mockupIds: [],
    },
    {
      kind: "empty",
      name: "No items",
      description: "Offers to clear the filters.",
      causes: [
        { type: "response", linkId: "l1", responseId: "r200", exampleId: "x2" },
      ],
      mockupIds: [fixture.mockupIds["empty.png"]],
    },
    { kind: "error", name: "Can't delete" },
  ]);

  await page.getByRole("link", { name: "View page" }).click();
  await expect(page.getByRole("link", { name: "Edit page" })).toBeVisible();
  const view = region(page, "States");
  await expect(region(page, "Loading items")).toContainText("Waits for");
  await expect(region(page, "Loading items")).toContainText(
    "Prism answers right away: slow the network down in the browser's developer tools to see this state.",
  );
  await expect(region(page, "Loading items")).toContainText("GET");
  const noItems = view.getByRole("region", { name: "No items" });
  await expect(noItems).toContainText("Empty");
  await expect(noItems).toContainText("Offers to clear the filters.");
  await expect(noItems).toContainText("200 OK, example empty");
  await expect(noItems).toContainText("Prefer: code=200, example=empty");
  await expect(
    noItems.getByRole("button", { name: "Open empty.png" }),
  ).toBeVisible();
  const cantDelete = view.getByRole("region", { name: "Can't delete" });
  await expect(cantDelete).toContainText(
    "Prefer: code=409, example=item-has-stock",
  );
  await expect(cantDelete).toContainText("Accept: application/problem+json");

  await noItems.getByRole("button", { name: "Copy Prism headers" }).click();
  await expect(page.getByText("Copied the Prism headers")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    "Prefer: code=200, example=empty",
  );

  // Mockups no state shows stay in a section of their own.
  await expect(
    region(page, "Other mockups").getByRole("button", {
      name: "Open list.png",
    }),
  ).toBeVisible();
  await expect(region(page, "Mockups")).toHaveCount(0);
});

test("asks before an endpoint change takes away what a state comes from", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await fixture.setStates([fixture.states.noItems, fixture.states.cantDelete]);
  await page.goto(
    `/projects/${fixture.project.id}/endpoints/${fixture.list.id}`,
  );
  const ok = region(page, "Responses").getByRole("region", {
    name: "Response 200",
  });

  await ok.getByRole("button", { name: "Remove example" }).nth(1).click();
  await page.getByRole("button", { name: "Save" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("Stock list › No items");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  expect(await fixture.getStates()).toEqual([
    fixture.states.noItems,
    fixture.states.cantDelete,
  ]);

  await page.getByRole("button", { name: "Save" }).click();
  const saved = waitForApi(page, "PATCH", "detachStates=true");
  await dialog
    .getByRole("button", { name: "Remove from states and save" })
    .click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Endpoint saved")).toBeVisible();
  expect(await fixture.getStates()).toEqual([
    { ...fixture.states.noItems, causes: [] },
    fixture.states.cantDelete,
  ]);
});

test("keeps unsaved state changes when a mockup is deleted", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await fixture.setStates([
    {
      ...fixture.states.noItems,
      mockupIds: [
        fixture.mockupIds["empty.png"],
        fixture.mockupIds["list.png"],
      ],
    },
  ]);
  await page.goto(
    `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`,
  );
  const state = region(page, "States").getByRole("group", { name: "State 1" });

  await state.getByRole("textbox", { name: "Name" }).fill("Nothing found");
  await region(page, "Mockups")
    .getByRole("button", { name: "Delete empty.png" })
    .click();
  const deleted = waitForApi(page, "DELETE", "/mockups/");
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Delete mockup" })
    .click();
  expect((await deleted).status()).toBe(204);
  // Coming back to the tab fetches the page again once it's stale (TanStack
  // Query listens for visibilitychange); the edit must survive that too.
  let refetches = 0;
  page.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      response.url().endsWith(`/pages/${fixture.page.id}`)
    ) {
      refetches++;
    }
  });
  await expect
    .poll(async () => {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      return refetches;
    })
    .toBeGreaterThan(0);

  await expect(state.getByRole("textbox", { name: "Name" })).toHaveValue(
    "Nothing found",
  );
  await expect(state.getByRole("checkbox")).toHaveCount(1);
  await expect(state.getByRole("checkbox", { name: "list.png" })).toBeChecked();
  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  expect(await fixture.getStates()).toEqual([
    {
      ...fixture.states.noItems,
      name: "Nothing found",
      mockupIds: [fixture.mockupIds["list.png"]],
    },
  ]);
});

test("shows on a state what no longer fits, before saving", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await fixture.setStates([fixture.states.noItems, fixture.states.cantDelete]);
  await page.goto(
    `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`,
  );
  const states = region(page, "States");
  let patches = 0;
  page.on("request", (sent) => {
    if (sent.method() === "PATCH") {
      patches++;
    }
  });

  await region(page, "Endpoints")
    .getByRole("button", { name: "Remove Endpoint 2" })
    .click();
  await choose(
    page,
    states.getByRole("group", { name: "State 1" }),
    "Kind",
    "Idle",
  );
  await page.getByRole("button", { name: "Save" }).click();

  await expect(states.getByRole("group", { name: "State 1" })).toContainText(
    "An idle state comes before any call, so nothing leads to it",
  );
  await expect(states.getByRole("group", { name: "State 2" })).toContainText(
    "This page doesn't make this call anymore",
  );
  expect(patches).toBe(0);

  // Fixing them clears the messages right away.
  await choose(
    page,
    states.getByRole("group", { name: "State 1" }),
    "Kind",
    "Empty",
  );
  await states
    .getByRole("group", { name: "State 2" })
    .getByRole("button", { name: "Remove cause 1" })
    .click();
  await expect(states).not.toContainText("An idle state comes before any call");
  await expect(states).not.toContainText("doesn't make this call anymore");
});

test("asks before a save replaces what was saved somewhere else", async ({
  context,
  request,
}) => {
  const fixture = await stockList(request);
  const url = `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`;
  const a = await context.newPage();
  const b = await context.newPage();
  await a.goto(url);
  await b.goto(url);
  const description = (tab: Page) =>
    tab
      .getByRole("group", { name: "Description" })
      .first()
      .getByRole("textbox");
  const criteria = (tab: Page) =>
    tab
      .getByRole("group", { name: "Acceptance criteria" })
      .getByRole("textbox");
  const saved = async () =>
    (await (
      await request.get(
        `/api/projects/${fixture.project.id}/pages/${fixture.page.id}`,
      )
    ).json()) as { description: string; acceptanceCriteria: string };

  await description(a).fill("From tab A");
  await criteria(b).fill("- [ ] From tab B");
  await b.getByRole("button", { name: "Save", exact: true }).click();
  await expect(b.getByText("Page saved")).toBeVisible();
  await a.getByRole("button", { name: "Save", exact: true }).click();
  const dialog = a.getByRole("alertdialog");
  await expect(dialog).toContainText(
    "This page changed since you started editing",
  );
  expect(await saved()).toMatchObject({
    description: "",
    acceptanceCriteria: "- [ ] From tab B",
  });

  await dialog.getByRole("button", { name: "Load the saved version" }).click();
  await expect(dialog).toBeHidden();
  await expect(criteria(a)).toHaveValue("- [ ] From tab B");
  await expect(description(a)).toHaveValue("");
  await expect(
    a.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();

  // Again, and this time keep tab A's version.
  await description(a).fill("From tab A");
  await criteria(b).fill("- [ ] From tab B, again");
  await b.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(async () => (await saved()).acceptanceCriteria)
    .toBe("- [ ] From tab B, again");
  await a.getByRole("button", { name: "Save", exact: true }).click();
  await dialog.getByRole("button", { name: "Save mine anyway" }).click();
  await expect(a.getByText("Page saved")).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(await saved()).toMatchObject({
    description: "From tab A",
    acceptanceCriteria: "- [ ] From tab B",
  });
  await expect(
    a.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
});

test("takes the version saved elsewhere when changes are discarded", async ({
  context,
  request,
}) => {
  const fixture = await stockList(request);
  const url = `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`;
  const pageUrl = `/api/projects/${fixture.project.id}/pages/${fixture.page.id}`;
  const a = await context.newPage();
  await a.goto(url);
  const description = a
    .getByRole("group", { name: "Description" })
    .first()
    .getByRole("textbox");
  await description.fill("Typed in tab A");
  // Saved elsewhere; tab A fetches the page again when it's visible.
  await request.patch(pageUrl, { data: { description: "Saved elsewhere" } });
  let refetches = 0;
  a.on("response", (response) => {
    if (
      response.request().method() === "GET" &&
      response.url().endsWith(pageUrl)
    ) {
      refetches++;
    }
  });
  await expect
    .poll(async () => {
      await a.evaluate(() =>
        window.dispatchEvent(new Event("visibilitychange")),
      );
      return refetches;
    })
    .toBeGreaterThan(0);

  await a.getByRole("button", { name: "Discard changes" }).click();
  await expect(description).toHaveValue("Saved elsewhere");
  await description.fill("Edited after discarding");
  const saved = waitForApi(a, "PATCH", "/pages/");
  await a.getByRole("button", { name: "Save", exact: true }).click();

  expect((await saved).status()).toBe(200);
  await expect(a.getByRole("alertdialog")).toHaveCount(0);
});

test("is saved after a change the server trims away", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await request.patch(
    `/api/projects/${fixture.project.id}/pages/${fixture.page.id}`,
    { data: { description: "All items" } },
  );
  await page.goto(
    `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`,
  );

  await page
    .getByRole("group", { name: "Description" })
    .getByRole("textbox")
    .fill("All items ");
  const saved = waitForApi(page, "PATCH", "/pages/");
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);

  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
});

test("says when the Prism headers can't be copied", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await fixture.setStates([fixture.states.noItems]);
  await page.goto(`/projects/${fixture.project.id}/pages/${fixture.page.id}`);
  // Browsers only offer the clipboard on https or localhost.
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
    }),
  );

  await region(page, "No items")
    .getByRole("button", { name: "Copy Prism headers" })
    .click();

  await expect(
    page.getByText("Couldn't copy; select the text instead"),
  ).toBeVisible();
});

test("keeps to the number of states a page can have", async ({
  page,
  request,
}) => {
  const fixture = await stockList(request);
  await fixture.setStates(
    Array.from({ length: 30 }, (_, index) => ({
      id: `s${index}`,
      kind: "idle",
      name: `State ${index}`,
      description: "",
      causes: [],
      mockupIds: [],
    })),
  );
  await page.goto(
    `/projects/${fixture.project.id}/pages/${fixture.page.id}/edit`,
  );

  const states = region(page, "States");
  await expect(
    states.getByRole("button", { name: "Add state" }),
  ).toBeDisabled();
  await expect(states).toContainText("A page has at most 30 states.");
});
