// Isolated component browser proof only: no Next session, DB, hosted app,
// customer values or configuration writes. Next Link is a plain-anchor stub.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const output = path.join(repo, "test-results/runs-pilot-review");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "link.jsx"), 'export default function Link({href, children, ...rest}) { return <a href={href} {...rest}>{children}</a>; }');
await writeFile(path.join(output, "entry.jsx"), `import {createRoot} from 'react-dom/client';
import Review from '/@fs/${repo.replaceAll("\\", "/")}/app/data-hub/sources/runs-review/RunsPilotReviewClient.tsx';
createRoot(document.getElementById('root')).render(<Review />);`);
await writeFile(path.join(output, "index.html"), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Isolated Runs review</title><style>:root{--bb-text-primary:#f3f0fa;--bb-text-secondary:#c6bfd6;--bb-border-default:#514b60;--bb-surface-soft:#24202f;--brand-brainbase-accent:#aa8cff}body{margin:0;background:#15121d;color:#f3f0fa;font-family:Arial,sans-serif}a{color:#cebbff}*{box-sizing:border-box}</style></head>
<body><div id="root"></div><script type="module" src="/entry.jsx"></script></body></html>`);

const server = await createServer({ configFile: false, root: output, cacheDir: path.join(output, "vite-cache"),
  esbuild: { jsx: "automatic" }, resolve: { alias: [
    { find: "@", replacement: repo }, { find: "next/link", replacement: path.join(output, "link.jsx") },
  ] }, server: { host: "127.0.0.1", port: 0, fs: { allow: [repo] } } });
let browser;
try {
  await server.listen();
  const address = server.httpServer.address();
  assert(address && typeof address !== "string");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [], apiRequests = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url()); });
  await page.goto(`http://127.0.0.1:${address.port}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Review Runs field meanings" }).waitFor();
  assert.equal(await page.getByRole("checkbox").count(), 21);
  assert.equal(await page.getByRole("checkbox", { checked: true }).count(), 0);
  await page.screenshot({ path: path.join(output, "desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("group", { name: "1. Id", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, "mobile.png") });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "mobile page overflows");
  await page.getByLabel("How does your report mark missing values?").selectOption("NULL_ONLY");
  const units = { "Ave Bin Weight": "kg", "Travel Distance Kms": "km", "Collection Distance Kms": "km", "Total Distance": "km" };
  for (const [label, unit] of Object.entries(units)) await page.getByLabel(`Unit for ${label}`, { exact: true }).selectOption(unit);
  for (const label of ["Loads", "Collections Booked", "Collections Performed", "Not Presented", "Contaminated"]) {
    await page.getByLabel(`Are negative values valid for ${label}?`, { exact: true }).selectOption("ALLOW");
  }
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  assert.match(await page.getByRole("status").textContent(), /21 of 21/);
  // A subsequent edit invalidates confirmation in an actual browser.
  await page.getByLabel("Unit for Total Weight", { exact: true }).selectOption("kg");
  assert.match(await page.getByRole("status").textContent(), /20 of 21/);
  await page.getByRole("checkbox", { name: "I confirm the meaning and unit for Total Weight", exact: true }).check();
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download draft field review" }).click();
  const download = await downloadEvent;
  const saved = path.join(output, "downloaded-review.json");
  await download.saveAs(saved);
  const review = JSON.parse(await readFile(saved, "utf8"));
  assert.equal(review.activationAllowed, false); assert.equal(review.fields.length, 21);
  assert(review.fields.every(field => field.confirmed));
  assert.equal(apiRequests.length, 0); assert.deepEqual(errors, []);
  const receipt = { scope: "isolated component only; synthetic choices; plain-anchor Next Link stub; no authenticated or hosted proof",
    fields: 21, initialConfirmations: 0, confirmedAfterReview: 21, editInvalidatedConfirmation: true,
    mobileWidth: 390, horizontalOverflow: false, downloadedDraft: true, activationAllowed: false, apiRequests: 0, pageErrors: 0 };
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify(receipt));
} finally { await browser?.close(); await server.close(); }
