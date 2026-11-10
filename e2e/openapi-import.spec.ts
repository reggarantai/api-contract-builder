import { expect, type Page, test } from "@playwright/test";
import { stringify } from "yaml";
import { projectTab, uniqueName } from "./helpers";

function choose(page: Page, name: string, content: string | Buffer) {
  return page.getByLabel("Import project").setInputFiles({
    name,
    // Browsers often give no type, or a wrong one, for YAML files.
    mimeType: "",
    buffer: Buffer.from(content),
  });
}

function pets(title: string, extra: Record<string, unknown> = {}) {
  return {
    openapi: "3.1.0",
    info: { title, version: "1.0.0" },
    paths: {
      "/pets": {
        get: {
          parameters: [
            { name: "session", in: "cookie", schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "OK",
              content: { "application/json": { schema: { type: "array" } } },
            },
          },
        },
      },
    },
    ...extra,
  };
}

test("imports an OpenAPI document from the Projects page, listing what it changed", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const title = uniqueName("Pets");
  await page.goto("/");
  await choose(page, "pets.openapi.yaml", stringify(pets(title)));

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText(`Imported ${title}`);
  await expect(dialog).toContainText("Cookie parameters aren't kept");
  await expect(dialog).toContainText("/paths/~1pets/get/parameters/0");
  await dialog.getByRole("button", { name: "Copy notices" }).click();
  await expect(page.getByText("Copied the notices")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    "Cookie parameters aren't kept",
  );

  await dialog.getByRole("button", { name: "Open project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await projectTab(page, "Endpoints").click();
  await expect(page.getByRole("link", { name: /\/pets/ })).toBeVisible();

  // Imported endpoints wait for pages, as the Export tab says.
  await projectTab(page, "Export").click();
  const unused = page
    .getByRole("region", { name: "Warnings" })
    .getByRole("group", { name: "Endpoints no page uses" });
  await expect(unused.getByRole("listitem")).toHaveText([
    /GET \/pets isn't used by any page/,
  ]);
});

test("brings back the pages of an OpenAPI document this app exported", async ({
  page,
  request,
}) => {
  const sample = (await (await request.post("/api/samples")).json()) as {
    id: string;
  };
  const exported = await (
    await request.get(`/api/projects/${sample.id}/export/openapi`)
  ).text();
  await page.goto("/");
  await choose(page, "inventory-app.openapi.yaml", exported);

  // The sample is here already, so the only notice is its new slug.
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("listitem")).toHaveText([
    /inventory-app is used by another project/,
  ]);
  await dialog.getByRole("button", { name: "Open project" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  expect(page.url()).not.toContain(sample.id);
  await projectTab(page, "Pages").click();
  await expect(
    page.getByRole("list", { name: "Pages" }).getByRole("link"),
  ).toHaveCount(9);
});

test("opens an OpenAPI import right away when nothing changed", async ({
  page,
}) => {
  const title = uniqueName("Plain");
  const plain = {
    openapi: "3.1.0",
    info: { title, version: "1.0.0" },
    paths: { "/a": { get: { responses: { "200": { description: "OK" } } } } },
  };
  await page.goto("/");
  await choose(page, "plain.json", JSON.stringify(plain));
  await expect(page.getByText(`Imported ${title}`)).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/[0-9A-Z]{26}$/);
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("says why an OpenAPI document can't be imported, with the places", async ({
  page,
}) => {
  await page.goto("/");
  await choose(
    page,
    "petstore.json",
    JSON.stringify({ swagger: "2.0", info: { title: "P", version: "1" } }),
  );
  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading")).toHaveText(
    "Couldn't import petstore.json",
  );
  await expect(dialog).toContainText(
    "This is a Swagger 2.0 document. Convert it to OpenAPI 3 first",
  );
  await dialog.getByRole("button", { name: "Close" }).click();

  await choose(
    page,
    "split.yaml",
    stringify(
      pets("Split", {
        components: { schemas: { Pet: { $ref: "./pet.yaml#/Pet" } } },
      }),
    ),
  );
  await expect(dialog).toContainText("refers to other files");
  await expect(dialog.getByRole("listitem")).toHaveText([
    /\.\/pet\.yaml#\/Pet.*\/components\/schemas\/Pet\/\$ref/s,
  ]);
});

test("sends a file as what it is, whatever its name", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const yamlTitle = uniqueName("Named oddly");
  await choose(page, "notes.txt", stringify(pets(yamlTitle)));
  await expect(page.getByRole("alertdialog").getByRole("heading")).toHaveText(
    `Imported ${yamlTitle}`,
  );
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Close" })
    .click();

  const jsonTitle = uniqueName("No extension");
  await choose(page, "spec", JSON.stringify(pets(jsonTitle)));
  await expect(page.getByRole("alertdialog").getByRole("heading")).toHaveText(
    `Imported ${jsonTitle}`,
  );

  // A project file without its extension is still a project file.
  const project = (await (
    await request.post("/api/projects", {
      data: { name: uniqueName("Backup") },
    })
  ).json()) as { id: string; name: string };
  const zip = await (
    await request.get(`/api/projects/${project.id}/export/project`)
  ).body();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: "Close" })
    .click();
  await choose(page, "backup", zip);
  await expect(page.getByText(`Imported ${project.name}`)).toBeVisible();
  await expect(page.getByText("the import is a separate copy")).toBeVisible();
});

test("refuses an OpenAPI document larger than 16 MB before sending it", async ({
  page,
}) => {
  let sent = false;
  await page.route("**/api/projects/import", (route) => {
    sent = true;
    return route.continue();
  });
  await page.goto("/");
  await expect(page.getByRole("banner").getByText(/^v\d/)).toBeVisible();
  await choose(page, "huge.yaml", Buffer.alloc(16 * 1024 * 1024 + 1, 0x20));
  await expect(page.getByRole("alertdialog")).toContainText(
    "This file is 16 MB; an OpenAPI document may be at most 16 MB.",
  );
  expect(sent).toBe(false);
});

test("groups the Export tab's warnings by kind, showing the first ten of each", async ({
  page,
  request,
}) => {
  const title = uniqueName("Many");
  const paths = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `/things${String(i).padStart(2, "0")}`,
      { get: { responses: { "204": { description: "Nothing" } } } },
    ]),
  );
  // Other tests import at the same time: wait the turn the server asks for.
  let imported = await request.post("/api/projects/import", {
    headers: { "Content-Type": "application/json" },
    data: JSON.stringify({
      openapi: "3.1.0",
      info: { title, version: "1" },
      paths,
    }),
  });
  for (let tries = 0; imported.status() === 503 && tries < 12; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    imported = await request.post("/api/projects/import", {
      headers: { "Content-Type": "application/json" },
      data: JSON.stringify({
        openapi: "3.1.0",
        info: { title, version: "1" },
        paths,
      }),
    });
  }
  expect(imported.status()).toBe(201);
  const { project } = (await imported.json()) as { project: { id: string } };
  await page.goto(`/projects/${project.id}/export`);

  const group = page
    .getByRole("region", { name: "Warnings" })
    .getByRole("group", { name: "Endpoints no page uses" });
  await expect(group.getByRole("heading")).toHaveText(
    "Endpoints no page uses 12",
  );
  await expect(group.getByRole("listitem")).toHaveCount(10);
  await group.getByRole("button", { name: "Show all 12" }).click();
  await expect(group.getByRole("listitem")).toHaveCount(12);
  await expect(group.getByRole("listitem").last()).toContainText(
    "GET /things11 isn't used by any page",
  );
});
