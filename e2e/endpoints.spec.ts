import { expect, type Locator, type Page, test } from "@playwright/test";
import {
  createEndpoint,
  createModel,
  createProject,
  getEndpoint,
  projectTab,
  uniqueName,
} from "./helpers";

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

function pageOf(scope: Locator | Page): Page {
  return "goto" in scope ? scope : scope.page();
}

async function choose(scope: Locator | Page, combobox: string, option: string) {
  await scope.getByRole("combobox", { name: combobox, exact: true }).click();
  await pageOf(scope)
    .getByRole("option", { name: option, exact: true })
    .click();
}

async function addField(scope: Locator, owner: string, name: string) {
  await scope.getByRole("button", { name: `Add field to ${owner}` }).click();
  await scope.page().keyboard.type(name);
  await scope.page().keyboard.press("Enter");
}

/** Saves and waits for the server, not just a toast (earlier ones may still show). */
async function save(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/endpoints/"),
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Endpoint saved").first()).toBeVisible();
}

test("creates an endpoint and keeps path parameters in sync with the path", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Endpoints"));
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Endpoints").click();

  await expect(page.getByText("No endpoints yet")).toBeVisible();
  await page.getByRole("button", { name: "Create an endpoint" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("combobox", { name: "Method" })).toHaveText(
    "GET",
  );
  await dialog.getByRole("textbox", { name: "Path" }).fill("/stocks/{id}");
  await dialog
    .getByRole("textbox", { name: "Summary" })
    .fill("Get a stock item");
  await dialog.getByRole("button", { name: "Create endpoint" }).click();
  await expect(page).toHaveURL(/\/endpoints\/[0-9A-Z]{26}$/);

  const pathParams = section(page, "Path parameters");
  await expect(
    pathParams.getByRole("combobox", { name: "Type of id" }),
  ).toBeVisible();

  await page
    .getByRole("textbox", { name: "Path", exact: true })
    .fill("/stocks/{stockId}/batches/{batch}");
  await expect(
    pathParams.getByRole("combobox", { name: "Type of id" }),
  ).toHaveCount(0);
  await choose(pathParams, "Type of stockId", "Integer");
  await expect(
    pathParams.getByRole("combobox", { name: "Type of batch" }),
  ).toBeVisible();
  await expect(
    pathParams.getByRole("button", { name: /Add field/ }),
  ).toHaveCount(0);

  await save(page);
  const endpointId = page.url().split("/").at(-1) ?? "";
  expect(await getEndpoint(request, project.id, endpointId)).toMatchObject({
    path: "/stocks/{stockId}/batches/{batch}",
    summary: "Get a stock item",
    parameters: {
      path: {
        type: "object",
        properties: { stockId: { type: "integer" }, batch: { type: "string" } },
        required: ["stockId", "batch"],
      },
    },
  });
});

test("describes parameters, the request body, and responses", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Bodies"));
  const stock = await createModel(request, project.id, {
    name: "Stock",
    schema: {
      type: "object",
      properties: { sku: { type: "string" }, quantity: { type: "integer" } },
    },
  });
  const endpoint = await createEndpoint(request, project.id, {
    method: "POST",
    path: "/stocks",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  const query = section(page, "Query parameters");
  await addField(query, "query parameters", "dryRun");
  await choose(query, "Type of dryRun", "Boolean");

  const body = section(page, "Request body");
  await choose(body, "Root type", "Stock");
  await body.getByRole("button", { name: "Add example" }).click();
  await body.getByRole("textbox", { name: "Example name" }).fill("new-stock");
  await body.getByRole("button", { name: "Generate from schema" }).click();
  await expect(
    body.getByRole("textbox", { name: "Example value" }),
  ).toHaveValue(/"sku": "string"/);

  const created = section(page, "Response 201");
  await expect(
    created.getByRole("textbox", { name: "Description" }),
  ).toHaveValue("Created");
  await choose(created, "Root type", "Stock");
  await addField(created, "response 201 headers", "Location");
  await created.getByRole("checkbox", { name: "Location is required" }).check();
  await created
    .getByRole("textbox", { name: "Description of Location" })
    .fill("Where the new item lives");

  await page.getByRole("button", { name: "Add response" }).click();
  await page.getByRole("menuitem", { name: "409 Conflict" }).click();
  const conflict = section(page, "Response 409");
  await conflict.getByRole("checkbox", { name: "Has a body" }).uncheck();

  await save(page);
  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    parameters: {
      query: { type: "object", properties: { dryRun: { type: "boolean" } } },
    },
    requestBody: {
      contentType: "application/json",
      required: true,
      schema: { $ref: `model:${stock.id}` },
      examples: [{ name: "new-stock", value: { sku: "string", quantity: 0 } }],
    },
    responses: [
      {
        status: "201",
        description: "Created",
        headers: {
          type: "object",
          properties: {
            Location: {
              type: "string",
              description: "Where the new item lives",
            },
          },
          required: ["Location"],
        },
        body: { schema: { $ref: `model:${stock.id}` } },
      },
      {
        status: "409",
        description: "Conflict",
        headers: { type: "object", properties: {} },
        body: null,
      },
    ],
  });
});

test("removes the request body when switching to GET", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Methods"));
  const endpoint = await createEndpoint(request, project.id, {
    method: "POST",
    path: "/search",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  await expect(section(page, "Request body")).toBeVisible();
  await choose(page, "Method", "GET");
  await expect(section(page, "Request body")).toHaveCount(0);
  await save(page);

  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    method: "GET",
    requestBody: null,
  });
});

test("shows a path conflict from the server on the path field", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Conflicts"));
  await createEndpoint(request, project.id, { method: "GET", path: "/stocks" });
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/stocks/{id}",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  await page
    .getByRole("textbox", { name: "Path", exact: true })
    .fill("/stocks");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(page.getByText("GET /stocks already exists")).toBeVisible();
});

test("sets authentication per endpoint", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Auth"), {
    securitySchemes: [
      {
        id: "bearer",
        key: "bearerAuth",
        type: "bearer",
        bearerFormat: "JWT",
        description: "",
      },
      {
        id: "key",
        key: "apiKeyAuth",
        type: "apiKey",
        in: "header",
        name: "X-API-Key",
        description: "",
      },
    ],
    defaultSecuritySchemeId: "bearer",
  });
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/health",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  await expect(
    page.getByRole("combobox", { name: "Authentication" }),
  ).toHaveText("Project default (bearerAuth)");
  await choose(page, "Authentication", "None (public)");
  await save(page);
  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    security: { type: "none" },
  });

  await choose(page, "Authentication", "apiKeyAuth");
  // The toast from the first save must not cover the Save button.
  await page
    .getByRole("button", { name: "Save" })
    .click({ trial: true, timeout: 1000 });
  await save(page);
  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    security: { type: "schemes", schemeIds: ["key"] },
  });
});

test("filters the endpoint list", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Filters"));
  await createEndpoint(
    request,
    project.id,
    { method: "GET", path: "/stocks", summary: "List stock" },
    { status: "agreed" },
  );
  await createEndpoint(request, project.id, {
    method: "POST",
    path: "/stocks",
    summary: "Add stock",
  });
  await createEndpoint(
    request,
    project.id,
    { method: "DELETE", path: "/stocks/{id}", summary: "Remove stock" },
    { status: "review" },
  );
  await page.goto(`/projects/${project.id}/endpoints`);

  const rows = page.getByRole("list", { name: "Endpoints" }).getByRole("link");
  await expect(rows).toHaveCount(3);

  await choose(page, "Method filter", "POST");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Add stock");

  await choose(page, "Method filter", "All methods");
  await choose(page, "Status filter", "Agreed");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("List stock");

  await choose(page, "Status filter", "All statuses");
  await page.getByRole("searchbox", { name: "Search endpoints" }).fill("{id}");
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("Remove stock");
});

test("deletes an endpoint", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Delete"));
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/old",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete endpoint" }).click();

  await expect(page).toHaveURL(`/projects/${project.id}/endpoints`);
  await expect(page.getByText("Deleted GET /old")).toBeVisible();
  await expect(page.getByText("No endpoints yet")).toBeVisible();
});
