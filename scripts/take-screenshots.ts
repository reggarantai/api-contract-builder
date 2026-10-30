/**
 * Takes the README screenshots from a running app: creates the sample project
 * and captures a page view, an endpoint, and the export tab into docs/images/.
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
const login = pages.find((page) => page.name === "Login");
const schedules = endpoints.find((endpoint) => endpoint.path === "/schedules");

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1280, height: 860 },
  deviceScaleFactor: 1,
});

await page.goto(`${base}/projects/${project.id}/pages/${login?.id}`);
await page.getByRole("link", { name: "Edit page" }).waitFor();
await page.screenshot({ path: out("page-view") });

await page.goto(`${base}/projects/${project.id}/endpoints/${schedules?.id}`);
await page.getByRole("region", { name: "Request body" }).waitFor();
await page.screenshot({ path: out("endpoint-editor") });

await page.goto(`${base}/projects/${project.id}/export`);
await page.getByText("Valid OpenAPI 3.1").waitFor();
await page.screenshot({ path: out("export") });

await browser.close();
console.log("Wrote docs/images/{page-view,endpoint-editor,export}.png");
