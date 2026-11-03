/**
 * Takes the README screenshots from a running app: creates the sample project
 * and captures a page view, two of its states, an endpoint, and the export tab
 * into docs/images/.
 *
 *   pnpm build && PORT=3100 DATA_DIR=$(mktemp -d) pnpm start &
 *   pnpm exec tsx scripts/take-screenshots.ts http://127.0.0.1:3100
 */
import path from "node:path";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:3000";
const out = (name: string) => path.resolve("docs/images", `${name}.png`);

const created = await fetch(`${base}/api/samples`, { method: "POST" });
const project = (await created.json()) as { id: string };
const pages = (await (
  await fetch(`${base}/api/projects/${project.id}/pages`)
).json()) as { id: string; name: string }[];
const endpoints = (await (
  await fetch(`${base}/api/projects/${project.id}/endpoints`)
).json()) as { id: string; method: string; path: string }[];
const stockList = pages.find((page) => page.name === "Stock list");
const recordMovement = endpoints.find(
  (endpoint) =>
    endpoint.method === "POST" &&
    endpoint.path === "/stock-items/{itemId}/movements",
);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
});

await page.goto(`${base}/projects/${project.id}/pages/${stockList?.id}`);
await page.getByRole("link", { name: "Edit page" }).waitFor();
await page.screenshot({ path: out("page-view") });

// The issue's example: the `empty` example leads to the empty state, and a
// 409 to an error message.
const empty = page.getByRole("region", { name: "No matching items" });
const cantDelete = page.getByRole("region", { name: "Can't delete" });
await cantDelete.getByText("Prefer: code=409").waitFor();
// Unscrolled, so the boxes are page coordinates, as a full-page clip wants.
const top = await empty.boundingBox();
const bottom = await cantDelete.boundingBox();
if (!top || !bottom) {
  throw new Error("The states aren't on the page");
}
await page.screenshot({
  path: out("page-states"),
  fullPage: true,
  clip: {
    x: top.x - 24,
    y: top.y - 24,
    width: top.width + 48,
    height: bottom.y + bottom.height - top.y + 48,
  },
});

await page.goto(
  `${base}/projects/${project.id}/endpoints/${recordMovement?.id}`,
);
await page.getByRole("region", { name: "Request body" }).waitFor();
await page.screenshot({ path: out("endpoint-editor") });

await page.goto(`${base}/projects/${project.id}/export`);
await page.getByText("Valid OpenAPI 3.1").waitFor();
// The downloads turn on with the report, and fade in. (Text, not a function:
// tsx would add helpers the browser doesn't have.)
await page.waitForFunction(
  `[...document.querySelectorAll("button")].some((button) =>
    button.textContent.includes("Download YAML") &&
    !button.disabled &&
    getComputedStyle(button).opacity === "1")`,
);
await page.screenshot({ path: out("export") });

await browser.close();
console.log(
  "Wrote docs/images/{page-view,page-states,endpoint-editor,export}.png",
);
