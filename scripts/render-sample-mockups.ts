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
  body { width: ${WIDTH}px; height: ${HEIGHT}px; background: #f4f4f5; font: 15px/1.4 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; color: #18181b; display: flex; align-items: center; justify-content: center; position: relative; overflow: hidden; }
  .card { width: 380px; background: #fff; border: 1px solid #e4e4e7; border-radius: 12px; padding: 28px; display: grid; gap: 14px; }
  .wide { width: 660px; }
  h1 { font-size: 22px; font-weight: 600; }
  h2 { font-size: 16px; font-weight: 600; }
  .muted { color: #71717a; font-size: 13px; }
  label { display: grid; gap: 6px; font-size: 13px; font-weight: 500; }
  .input { height: 36px; border: 1px solid #d4d4d8; border-radius: 8px; padding: 8px 10px; font-size: 14px; color: #a1a1aa; background: #fff; }
  .input.filled { color: #18181b; }
  .input.error { border-color: #dc2626; }
  .area { height: 60px; }
  .button { height: 38px; border-radius: 8px; background: #18181b; color: #fff; font-weight: 600; display: flex; align-items: center; justify-content: center; padding: 0 14px; font-size: 14px; }
  .button.outline { background: #fff; color: #18181b; border: 1px solid #d4d4d8; }
  .alert { background: #fef2f2; border: 1px solid #fecaca; color: #b91c1c; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .notice { background: #f0fdf4; border: 1px solid #bbf7d0; color: #15803d; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  .row { display: flex; gap: 10px; align-items: center; }
  .between { justify-content: space-between; }
  .end { justify-content: end; }
  .grow { flex: 1; }
  .checkbox { width: 16px; height: 16px; border: 1px solid #a1a1aa; border-radius: 4px; }
  .link { color: #2563eb; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: #71717a; font-weight: 500; padding: 8px; border-bottom: 1px solid #e4e4e7; }
  td { padding: 9px 8px; border-bottom: 1px solid #f4f4f5; }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #f4f4f5; font-size: 12px; }
  .pill.green { background: #dcfce7; color: #15803d; }
  .pill.amber { background: #fef3c7; color: #b45309; }
  .pill.red { background: #fee2e2; color: #b91c1c; }
  .stat { border: 1px solid #e4e4e7; border-radius: 8px; padding: 10px 12px; display: grid; gap: 2px; flex: 1; }
  .stat b { font-size: 20px; }
  .segments { display: flex; border: 1px solid #d4d4d8; border-radius: 8px; overflow: hidden; font-size: 13px; font-weight: 500; }
  .segments span { flex: 1; text-align: center; padding: 8px; }
  .segments .on { background: #18181b; color: #fff; }
  .icon { width: 48px; height: 48px; border-radius: 999px; background: #e0e7ff; color: #4338ca; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .shell { position: absolute; inset: 0; display: grid; grid-template-rows: 52px 1fr; }
  .topbar { background: #fff; border-bottom: 1px solid #e4e4e7; display: flex; align-items: center; gap: 20px; padding: 0 20px; font-size: 14px; }
  .topbar .nav { color: #71717a; }
  .topbar .nav.on { color: #18181b; font-weight: 600; }
  .content { padding: 24px; display: grid; gap: 14px; align-content: start; }
  .block { background: #e4e4e7; border-radius: 8px; height: 18px; }
  .menu { position: absolute; top: 48px; right: 16px; width: 220px; background: #fff; border: 1px solid #e4e4e7; border-radius: 10px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.12); padding: 12px; display: grid; gap: 8px; font-size: 13px; }
  .divider { border-top: 1px solid #e4e4e7; }
  .overlay { position: absolute; inset: 0; background: rgb(24 24 27 / 0.45); display: flex; align-items: center; justify-content: center; }
`;

const mockups: Record<string, string> = {
  "login-form": `
    <div class="card">
      <h1>Sign in</h1>
      <p class="muted">Inventory App</p>
      <label>Email<div class="input">you@company.com</div></label>
      <label><span class="row between">Password <span class="link">Forgot password?</span></span><div class="input">••••••••••••</div></label>
      <div class="row"><div class="checkbox"></div><span class="muted">Keep me signed in for 30 days</span></div>
      <div class="button">Sign in</div>
      <span class="muted">New here? <span class="link">Create an account</span></span>
    </div>`,
  "login-error": `
    <div class="card">
      <h1>Sign in</h1>
      <div class="alert">Email or password is wrong.</div>
      <label>Email<div class="input filled">ana@example.com</div></label>
      <label>Password<div class="input error"></div></label>
      <div class="button">Sign in</div>
    </div>`,
  "registration-form": `
    <div class="card">
      <h1>Create an account</h1>
      <label>Full name<div class="input filled">Budi Santoso</div></label>
      <label>Work email<div class="input filled">budi@example.com</div></label>
      <label>Password<div class="input">At least 12 characters</div></label>
      <div class="button">Create account</div>
      <span class="muted">Already have an account? <span class="link">Sign in</span></span>
    </div>`,
  "registration-check-email": `
    <div class="card" style="justify-items: center; text-align: center">
      <div class="icon">✉</div>
      <h1>Check your email</h1>
      <p class="muted">We sent a message to <b>budi@example.com</b> with the next step.<br>A new account's link works for 24 hours.</p>
      <span class="link">Back to sign in</span>
    </div>`,
  "verify-email-expired": `
    <div class="card">
      <h1>Verify your email</h1>
      <div class="alert">This link is invalid or has expired. Ask for a new one.</div>
      <label>Email<div class="input filled">budi@example.com</div></label>
      <div class="button">Send a new link</div>
      <span class="link">Back to sign in</span>
    </div>`,
  "forgot-password": `
    <div class="card">
      <h1>Forgot your password?</h1>
      <p class="muted">Enter your email and we'll send a link to set a new one.</p>
      <label>Email<div class="input filled">ana@example.com</div></label>
      <div class="button">Send link</div>
      <div class="notice">If an account exists for this email, we sent a link.</div>
      <span class="link">Back to sign in</span>
    </div>`,
  "reset-password": `
    <div class="card">
      <h1>Set a new password</h1>
      <label>New password<div class="input">At least 12 characters</div></label>
      <label>Repeat the password<div class="input"></div></label>
      <div class="button">Save password</div>
    </div>`,
  "app-shell": `
    <div class="shell">
      <div class="topbar">
        <b>Inventory App</b>
        <span class="nav on">Stock</span>
        <span class="grow"></span>
        <span class="row">Ana Lima ▾</span>
      </div>
      <div class="content">
        <div class="block" style="width: 30%; height: 24px"></div>
        <div class="block" style="width: 90%"></div>
        <div class="block" style="width: 80%"></div>
        <div class="block" style="width: 85%"></div>
        <p class="muted">Page content</p>
      </div>
      <div class="menu">
        <b>Ana Lima</b>
        <span class="muted">ana@example.com</span>
        <span><span class="pill">Admin</span></span>
        <div class="divider"></div>
        <span>Sign out</span>
      </div>
    </div>`,
  "stock-list": `
    <div class="card wide">
      <div class="row between">
        <h1>Stock</h1>
        <div class="button">Add item</div>
      </div>
      <div class="row">
        <div class="input grow">Search SKU or name</div>
        <div class="input filled">All categories ▾</div>
        <div class="input filled">Any status ▾</div>
      </div>
      <table>
        <tr><th>SKU</th><th>Name</th><th>Category</th><th>On hand</th><th>Status</th><th></th></tr>
        <tr><td>BOX-S-001</td><td>Shipping box, small</td><td>Packaging</td><td>340</td><td><span class="pill green">In stock</span></td><td class="muted">⋯</td></tr>
        <tr><td>TAPE-050</td><td>Packing tape, 50 m</td><td>Packaging</td><td>18</td><td><span class="pill amber">Low stock</span></td><td class="muted">⋯</td></tr>
        <tr><td>FILM-500</td><td>Stretch film, 500 mm</td><td>Packaging</td><td>0</td><td><span class="pill red">Out of stock</span></td><td class="muted">⋯</td></tr>
      </table>
      <div class="row between"><span class="muted">1–3 of 3</span><div class="row"><div class="button outline">Previous</div><div class="button outline">Next</div></div></div>
    </div>`,
  "stock-item": `
    <div class="card wide">
      <div class="row between">
        <div><h1>Shipping box, small</h1><span class="muted">BOX-S-001 · Packaging</span></div>
        <div class="row"><div class="button outline">Edit</div><div class="button">Record movement</div></div>
      </div>
      <div class="row">
        <div class="stat"><span class="muted">On hand</span><b>340 pieces</b></div>
        <div class="stat"><span class="muted">Reorder point</span><b>100</b></div>
        <div class="stat"><span class="muted">Status</span><span><span class="pill green">In stock</span></span></div>
      </div>
      <h2>History</h2>
      <table>
        <tr><th>Date</th><th>Type</th><th>Change</th><th>After</th><th>Reference</th><th>By</th></tr>
        <tr><td>28 Oct</td><td>Receipt</td><td>+200</td><td>340</td><td>DN-2026-1042</td><td>Ana Lima</td></tr>
        <tr><td>15 Oct</td><td>Issue</td><td>−25</td><td>140</td><td>SO-88213</td><td>Ana Lima</td></tr>
        <tr><td>1 Oct</td><td>Count</td><td>−3</td><td>165</td><td class="muted">Monthly stock take</td><td>Ana Lima</td></tr>
      </table>
    </div>`,
  "record-movement": `
    <div class="card wide" style="filter: blur(1px)">
      <h1>Shipping box, small</h1>
      <div class="block" style="height: 60px"></div>
      <div class="block" style="height: 120px"></div>
    </div>
    <div class="overlay">
      <div class="card">
        <h2>Record movement</h2>
        <div class="segments"><span class="on">Receipt</span><span>Issue</span><span>Count</span></div>
        <label>Quantity received<div class="input filled">200</div></label>
        <label>Reference<div class="input filled">DN-2026-1042</div></label>
        <label>Note<div class="input">Optional</div></label>
        <div class="row end"><div class="button outline">Cancel</div><div class="button">Record</div></div>
      </div>
    </div>`,
  "stock-item-form": `
    <div class="card wide">
      <h1>Edit stock item</h1>
      <div class="row" style="align-items: start">
        <label class="grow">SKU<div class="input filled">BOX-S-001</div></label>
        <label class="grow">Name<div class="input filled">Shipping box, small</div></label>
      </div>
      <div class="row" style="align-items: start">
        <label class="grow">Category<div class="input filled">Packaging ▾</div></label>
        <label class="grow">Unit<div class="input filled">Piece ▾</div></label>
        <label class="grow">Reorder point<div class="input filled">100</div></label>
      </div>
      <label>Description<div class="input filled area">Single wall, 30 × 20 × 15 cm</div></label>
      <p class="muted">The quantity changes through stock movements on the item's page.</p>
      <div class="row end"><div class="button outline">Cancel</div><div class="button">Save</div></div>
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
