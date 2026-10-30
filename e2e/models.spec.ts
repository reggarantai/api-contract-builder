import { expect, type Page, test } from "@playwright/test";
import {
  createModel,
  createProject,
  getModelSchema,
  projectTab,
  uniqueName,
} from "./helpers";

async function addField(page: Page, owner: string, name: string) {
  await page.getByRole("button", { name: `Add field to ${owner}` }).click();
  // The new field's name input has focus with its suggested name selected.
  await page.keyboard.type(name);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("textbox", { name: `Name of ${name}` }),
  ).toBeVisible();
}

async function chooseType(page: Page, field: string, type: string) {
  await page.getByRole("combobox", { name: `Type of ${field}` }).click();
  await page.getByRole("option", { name: type, exact: true }).click();
}

async function openDetails(page: Page, field: string) {
  await page.getByRole("button", { name: `Details of ${field}` }).click();
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Model saved")).toBeVisible();
}

function jsonEditor(page: Page) {
  return page.getByRole("textbox", { name: "Schema JSON" });
}

async function replaceJson(page: Page, text: string) {
  await jsonEditor(page).click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(text);
}

test("builds a model with the field builder", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Builder"));
  await page.goto(`/projects/${project.id}`);
  await projectTab(page, "Models").click();

  await page.getByRole("button", { name: "Create a model" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("User");
  await page.getByRole("button", { name: "Create model" }).click();
  await expect(page).toHaveURL(/\/models\/[0-9A-Z]{26}$/);

  await addField(page, "root", "id");
  await page.getByRole("checkbox", { name: "id is required" }).check();
  await openDetails(page, "id");
  await page.getByLabel("Format").click();
  await page.getByRole("option", { name: "uuid" }).click();
  await openDetails(page, "id");

  await addField(page, "root", "email");
  await page.getByRole("checkbox", { name: "email is required" }).check();
  await page
    .getByRole("textbox", { name: "Description of email" })
    .fill("Login email");

  await addField(page, "root", "age");
  await chooseType(page, "age", "Integer");
  await openDetails(page, "age");
  await page.getByLabel("Minimum").fill("0");
  await openDetails(page, "age");
  await expect(page.getByText("≥ 0")).toBeVisible();

  await addField(page, "root", "address");
  await chooseType(page, "address", "Object");
  await addField(page, "address", "street");

  await addField(page, "root", "tags");
  await chooseType(page, "tags", "Array");
  await expect(
    page.getByRole("combobox", { name: "Type of tags[]" }),
  ).toHaveText("String");

  // A duplicate name is refused and the field keeps its name.
  await addField(page, "root", "nickname");
  const nickname = page.getByRole("textbox", { name: "Name of nickname" });
  await nickname.fill("email");
  await expect(page.getByText("Name already used")).toBeVisible();
  await nickname.press("Escape");
  await expect(nickname).toHaveValue("nickname");
  await page.getByRole("button", { name: "Actions for nickname" }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();

  await save(page);

  const modelId = page.url().split("/").at(-1) ?? "";
  expect(await getModelSchema(request, project.id, modelId)).toEqual({
    type: "object",
    properties: {
      id: { type: "string", format: "uuid" },
      email: { type: "string", description: "Login email" },
      age: { type: "integer", minimum: 0 },
      address: { type: "object", properties: { street: { type: "string" } } },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["id", "email"],
  });
});

test("references other models and round-trips through JSON", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Refs"));
  const user = await createModel(request, project.id, { name: "User" });
  const order = await createModel(request, project.id, { name: "Order" });
  await page.goto(`/projects/${project.id}/models/${order.id}`);

  await addField(page, "root", "customer");
  await chooseType(page, "customer", "User");

  await page.getByRole("tab", { name: "JSON" }).click();
  await expect(jsonEditor(page)).toContainText(
    '"$ref": "#/components/schemas/User"',
  );

  await replaceJson(
    page,
    JSON.stringify({
      type: "object",
      properties: {
        customer: { $ref: "#/components/schemas/User" },
        total: { type: "number", minimum: 0 },
      },
      required: ["customer"],
    }),
  );
  await page.getByRole("tab", { name: "Builder" }).click();
  await expect(
    page.getByRole("combobox", { name: "Type of customer" }),
  ).toHaveText("User");
  await expect(
    page.getByRole("checkbox", { name: "customer is required" }),
  ).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Type of total" }),
  ).toHaveText("Number");

  await save(page);
  expect(await getModelSchema(request, project.id, order.id)).toEqual({
    type: "object",
    properties: {
      customer: { $ref: `model:${user.id}` },
      total: { type: "number", minimum: 0 },
    },
    required: ["customer"],
  });
});

test("blocks saving invalid JSON", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Invalid"));
  const model = await createModel(request, project.id, { name: "Thing" });
  await page.goto(`/projects/${project.id}/models/${model.id}`);
  await page.getByRole("tab", { name: "JSON" }).click();

  await replaceJson(page, "{");
  await expect(page.getByRole("alert")).toContainText("Invalid JSON");
  await expect(page.getByRole("tab", { name: "Builder" })).toBeDisabled();

  await replaceJson(page, '{"$ref": "#/components/schemas/Nope"}');
  await expect(page.getByRole("alert")).toHaveText("Unknown model: Nope");
  await expect(page.getByText("Fix the JSON before saving.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();

  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByRole("tab", { name: "Builder" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "Add field to root" }),
  ).toBeVisible();
});

test("keeps schema features the builder can't edit", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Custom"));
  const schema = {
    type: "object",
    "x-table": "payments",
    properties: {
      method: { oneOf: [{ type: "string" }, { type: "integer" }] },
      note: { type: "string", "x-label": "Note" },
    },
  };
  const model = await createModel(request, project.id, {
    name: "Payment",
    schema,
  });
  await page.goto(`/projects/${project.id}/models/${model.id}`);

  await expect(page.getByLabel("Type of method")).toHaveText("Custom");
  await page
    .getByRole("textbox", { name: "Description of note" })
    .fill("Free text");
  await save(page);

  expect(await getModelSchema(request, project.id, model.id)).toEqual({
    ...schema,
    properties: {
      ...schema.properties,
      note: { type: "string", "x-label": "Note", description: "Free text" },
    },
  });
});

test("refuses to delete a model that another model uses", async ({
  page,
  request,
}) => {
  const project = await createProject(request, uniqueName("Delete"));
  const user = await createModel(request, project.id, { name: "User" });
  const order = await createModel(request, project.id, {
    name: "Order",
    schema: { $ref: `model:${user.id}` },
  });

  await page.goto(`/projects/${project.id}/models/${user.id}`);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete model" }).click();
  await expect(
    page.getByText("User is used by Order. Remove those references first."),
  ).toBeVisible();
  await expect(page).toHaveURL(`/projects/${project.id}/models/${user.id}`);

  await page
    .getByRole("navigation", { name: "Models" })
    .getByRole("link", { name: "Order" })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Delete model" }).click();
  await expect(page).toHaveURL(`/projects/${project.id}/models`);
  await expect(page.getByText(`Deleted Order`)).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Models" }).getByRole("link"),
  ).toHaveText(["User"]);
  expect(
    (
      await request.get(`/api/projects/${project.id}/models/${order.id}`)
    ).status(),
  ).toBe(404);
});

test("asks before leaving with unsaved changes", async ({ page, request }) => {
  const project = await createProject(request, uniqueName("Unsaved"));
  const model = await createModel(request, project.id, { name: "Draft" });
  await page.goto(`/projects/${project.id}/models/${model.id}`);

  await addField(page, "root", "title");

  page.once("dialog", (dialog) => dialog.dismiss());
  await projectTab(page, "Overview").click();
  await expect(page).toHaveURL(`/projects/${project.id}/models/${model.id}`);

  page.once("dialog", (dialog) => dialog.accept());
  await projectTab(page, "Overview").click();
  await expect(page).toHaveURL(`/projects/${project.id}`);
});
