import { expect, type Page, test } from "@playwright/test";
import {
  createEndpoint,
  createErrorType,
  createModel,
  createProject,
  getEndpoint,
  projectTab,
  uniqueName,
} from "./helpers";

function section(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

/** Saves the endpoint and waits for the server. */
async function saveEndpoint(page: Page) {
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "PATCH" &&
      response.url().includes("/endpoints/"),
  );
  await page.getByRole("button", { name: "Save" }).click();
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Endpoint saved").first()).toBeVisible();
}

test("defines an error type once and answers with it from endpoints", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Error types"));
  const problem = await createModel(request, project.id, {
    name: "Problem",
    schema: {
      type: "object",
      properties: { type: { type: "string" }, title: { type: "string" } },
    },
  });
  const endpoint = await createEndpoint(request, project.id, {
    method: "GET",
    path: "/stocks/{id}",
  });
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Error types").click();

  await expect(
    page.getByText("No error types yet", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Create an error type" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Name" }).fill("not-found");
  await dialog.getByRole("textbox", { name: "Status" }).fill("404");
  await dialog.getByRole("textbox", { name: "Title" }).fill("Not found");
  await dialog.getByRole("button", { name: "Create error type" }).click();
  await expect(page).toHaveURL(/\/error-types\/[0-9A-Z]{26}$/);
  const errorTypeId = page.url().split("/").at(-1) ?? "";

  // New error types start as problem details (RFC 9457) with the Problem model.
  await expect(page.getByRole("textbox", { name: "Content type" })).toHaveValue(
    "application/problem+json",
  );
  await expect(page.getByRole("textbox", { name: "Example" })).toHaveValue(
    /"title": "Not found",\s+"status": 404/,
  );
  await page
    .getByRole("textbox", { name: "Description" })
    .fill("No stock item has this ID.");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Error type saved")).toBeVisible();
  expect(
    await (
      await request.get(
        `/api/projects/${project.id}/error-types/${errorTypeId}`,
      )
    ).json(),
  ).toMatchObject({
    description: "No stock item has this ID.",
    body: {
      contentType: "application/problem+json",
      schema: { $ref: `model:${problem.id}` },
      example: { title: "Not found", status: 404 },
    },
  });

  // Endpoints add it to the response for its status, created if needed.
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);
  await section(page, "Responses")
    .getByRole("button", { name: "Add error types" })
    .click();
  const picker = page.getByRole("dialog");
  await picker.getByRole("checkbox", { name: "not-found Not found" }).check();
  await picker.getByRole("button", { name: "Add", exact: true }).click();
  const notFound = section(page, "Response 404");
  await expect(
    notFound.getByRole("listitem").filter({ hasText: "not-found" }),
  ).toContainText("Not found");
  await expect(
    notFound.getByRole("checkbox", { name: "Has a body" }),
  ).toHaveCount(0);
  await saveEndpoint(page);
  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    responses: [
      { status: "200" },
      {
        status: "404",
        description: "Not Found",
        body: null,
        errors: [{ errorTypeId, examples: [] }],
      },
    ],
  });

  // The error type lists the endpoints that answer with it.
  await projectTab(page, "Error types").click();
  await page
    .getByRole("navigation", { name: "Error types" })
    .getByRole("link", { name: /not-found/ })
    .click();
  await section(page, "Used by")
    .getByRole("link", { name: "GET /stocks/{id}" })
    .click();
  await expect(page).toHaveURL(
    `/projects/${project.id}/endpoints/${endpoint.id}`,
  );
});

test("orders a response's error types and gives one this endpoint's own examples", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Own examples"));
  const taken = await createErrorType(request, project.id, {
    name: "sku-taken",
    status: "409",
    title: "SKU already used",
  });
  const busy = await createErrorType(request, project.id, {
    name: "request-in-progress",
    status: "409",
    title: "Request in progress",
  });
  const endpoint = await createEndpoint(request, project.id, {
    method: "POST",
    path: "/stocks",
  });
  await page.goto(`/projects/${project.id}/endpoints/${endpoint.id}`);

  await section(page, "Responses")
    .getByRole("button", { name: "Add error types" })
    .click();
  const picker = page.getByRole("dialog");
  await picker
    .getByRole("checkbox", { name: "sku-taken SKU already used" })
    .check();
  await picker
    .getByRole("checkbox", { name: "request-in-progress Request in progress" })
    .check();
  await picker.getByRole("button", { name: "Add", exact: true }).click();

  const conflict = section(page, "Response 409");
  // They're added in catalog order; the first is what mock servers answer.
  await expect(conflict.getByRole("listitem")).toHaveText([
    /^request-in-progress/,
    /^sku-taken/,
  ]);
  await conflict.getByRole("button", { name: "Move sku-taken up" }).click();
  await conflict
    .getByRole("checkbox", { name: "Own examples of sku-taken" })
    .check();
  const value = conflict.getByRole("textbox", { name: "Example value" });
  await expect(value).toHaveValue(/"title": "SKU already used"/);
  await value.fill(
    '{ "type": "https://api.example.com/problems/sku-taken", "detail": "BOX-1 is taken" }',
  );
  await saveEndpoint(page);

  expect(await getEndpoint(request, project.id, endpoint.id)).toMatchObject({
    responses: [
      { status: "201" },
      {
        status: "409",
        errors: [
          {
            errorTypeId: taken.id,
            examples: [
              {
                name: "sku-taken",
                value: { detail: "BOX-1 is taken" },
              },
            ],
          },
          { errorTypeId: busy.id, examples: [] },
        ],
      },
    ],
  });
});

test("refuses to delete an error type a response uses", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Delete errors"));
  const notFound = await createErrorType(request, project.id, {
    name: "not-found",
    status: "404",
    title: "Not found",
  });
  await createEndpoint(
    request,
    project.id,
    { method: "GET", path: "/stocks/{id}" },
    {
      responses: [
        {
          id: "r404",
          status: "404",
          description: "Not Found",
          headers: { type: "object", properties: {} },
          body: null,
          errors: [{ errorTypeId: notFound.id }],
        },
      ],
    },
  );

  await page.goto(`/projects/${project.id}/error-types/${notFound.id}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete error type" }).click();

  await expect(
    page.getByText(
      "not-found is used by GET /stocks/{id}. Remove it from those responses first.",
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(
    `/projects/${project.id}/error-types/${notFound.id}`,
  );
});

test("links warnings about an error type to it", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Unused errors"));
  const teapot = await createErrorType(request, project.id, {
    name: "teapot",
    status: "418",
    title: "I'm a teapot",
  });
  await page.goto(`/projects/${project.id}/export`);

  await section(page, "Warnings")
    .getByRole("listitem")
    .filter({ hasText: "teapot isn't used by any endpoint" })
    .getByRole("link", { name: "Open" })
    .click();
  await expect(page).toHaveURL(
    `/projects/${project.id}/error-types/${teapot.id}`,
  );
});
