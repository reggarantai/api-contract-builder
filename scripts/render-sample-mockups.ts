/**
 * Renders the wireframe mockups of the sample project to PNG files in
 * samples/mockups/. Run after changing them: `pnpm exec tsx scripts/render-sample-mockups.ts`.
 */
import path from "node:path";
import { chromium } from "@playwright/test";

const OUT_DIR = path.resolve("samples/mockups");
const WIDTH = 720;
const HEIGHT = 520;

const style = `
  * { box-sizing: border-box; margin: 0; }
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #f4f4f5; font: 15px/1.4 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #18181b; display: flex; align-items: center; justify-content: center; }
  .card { width: 380px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 28px; display: grid; gap: 14px; }
  .wide { width: 640px; }
  h1 { font-size: 22px; font-weight: 600; }
  .muted { color: #71717a; font-size: 13px; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 500; }
  .input { height: 36px; border: 1px solid #d4d4d8; border-radius: 8px; padding: 8px 10px; font-size: 14px; color: #a1a1aa; }
  .input.filled { color: #18181b; }
  .input.error { border-color: #dc2626; }
  .button { height: 38px; border-radius: 8px; background: #18181b; color: #fff; font-weight: 600; display: flex; align-items: center; justify-content: center; }
  .button.outline { background: #fff; color: #18181b; border: 1px solid #d4d4d8; }
  .alert { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .row { display: flex; gap: 10px; align-items: center; }
  .checkbox { width: 16px; height: 16px; border: 1px solid #a1a1aa; border-radius: 4px; }
  .link { color: #2563eb; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #71717a; font-weight: 500; padding: 8px; border-bottom: 1px solid #e4e4e7; }
  td { padding: 10px 8px; border-bottom: 1px solid #f4f4f5; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f4f4f5; font-size: 12px; }
  .zero { color: #dc2626; font-weight: 600; }
  .radio { display: flex; gap: 14px; font-size: 13px; font-weight: 400; }
`;

const mockups: Record<string, string> = {
  "login-form": `
    <div class="card">
      <h1>Sign in</h1>
      <p class="muted">Inventory App</p>
      <label>Email<div class="input">you@company.com</div></label>
      <label>Password<div class="input">••••••••</div></label>
      <div class="row"><div class="checkbox"></div><span class="muted">Remember me for 30 days</span></div>
      <div class="button">Sign in</div>
      <span class="link">Create an account</span>
    </div>`,
  "login-error": `
    <div class="card">
      <h1>Sign in</h1>
      <div class="alert">Email or password is wrong. 4 attempts left.</div>
      <label>Email<div class="input filled">ana@example.com</div></label>
      <label>Password<div class="input error"></div></label>
      <div class="button">Sign in</div>
    </div>`,
  registration: `
    <div class="card">
      <h1>Create an account</h1>
      <label>Full name<div class="input">Ana Lima</div></label>
      <label>Work email<div class="input">ana@company.com</div></label>
      <label>Password<div class="input">At least 8 characters</div></label>
      <div class="button">Create account</div>
      <span class="muted">Already have an account? <span class="link">Sign in</span></span>
    </div>`,
  "stock-list": `
    <div class="card wide">
      <div class="row" style="justify-content: space-between">
        <h1>Stock</h1>
        <div class="row"><div class="input" style="width: 200px">Search SKU or name</div><div class="button" style="padding: 0 14px">Add stock</div></div>
      </div>
      <table>
        <tr><th>SKU</th><th>Name</th><th>Category</th><th>Quantity</th><th></th></tr>
        <tr><td>SKU-001</td><td>Widget</td><td><span class="pill">Parts</span></td><td>12</td><td class="muted">Delete</td></tr>
        <tr><td>SKU-002</td><td>Gadget</td><td><span class="pill">Tools</span></td><td class="zero">0</td><td class="muted">Delete</td></tr>
        <tr><td>SKU-003</td><td>Bolt M6</td><td><span class="pill">Parts</span></td><td>480</td><td class="muted">Delete</td></tr>
      </table>
      <div class="row" style="justify-content: space-between"><span class="muted">1–3 of 3</span><div class="row"><div class="button outline" style="padding: 0 12px">Previous</div><div class="button outline" style="padding: 0 12px">Next</div></div></div>
    </div>`,
  "create-schedule": `
    <div class="card wide">
      <h1>New restock schedule</h1>
      <div class="row" style="align-items: start">
        <label style="flex: 1">Supplier<div class="input filled">Acme Supplies ▾</div></label>
        <label style="flex: 1">Item<div class="input filled">SKU-002 · Gadget ▾</div></label>
      </div>
      <div class="row" style="align-items: start">
        <label style="flex: 1">Quantity<div class="input filled">50</div></label>
        <label style="flex: 1">First delivery<div class="input filled">2026-11-15</div></label>
      </div>
      <label>Repeat<div class="radio"><span>○ Once</span><span>● Weekly</span><span>○ Monthly</span></div></label>
      <label>Note<div class="input">Optional, e.g. deliver to dock 2</div></label>
      <div class="row" style="justify-content: end"><div class="button outline" style="padding: 0 14px">Cancel</div><div class="button" style="padding: 0 14px">Create schedule</div></div>
    </div>`,
};

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
});
for (const [name, body] of Object.entries(mockups)) {
  await page.setContent(
    `<!doctype html><style>${style}</style><body>${body}</body>`,
  );
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
  console.log(`samples/mockups/${name}.png`);
}
await browser.close();
