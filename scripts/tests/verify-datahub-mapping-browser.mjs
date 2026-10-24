// Only invoked from the owned local DB proof. Real built Next/auth/API/DB;
// loopback Neon transport, synthetic account/workbook; no hosted provider proof.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, expect } from "@playwright/test";
import { Pool } from "pg";
if (process.env.DATAHUB_MAPPING_BROWSER_PROOF !== "1" || !process.env.DATABASE_URL ||
  !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname) || new URL(process.env.DATABASE_URL).pathname !== "/testdb") throw new Error("OWNED_MAPPING_HARNESS_REQUIRED");
let input = ""; for await (const part of process.stdin) input += part;
const { uploadId, username, password } = JSON.parse(input); input = "";
const directory = path.resolve("test-results/runs-pilot-review/real-browser"); await mkdir(directory, { recursive: true });
const port = await new Promise((resolve, reject) => { const server = createServer(); server.on("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); });
const origin = `http://127.0.0.1:${port}`, pool = new Pool({ connectionString: process.env.DATABASE_URL.replace("localhost", "127.0.0.1") });
const server = spawn(process.execPath, [path.resolve("node_modules/next/dist/bin/next"), "start", "-p", String(port), "-H", "127.0.0.1"], {
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DATAHUB_BROWSER_PROOF: "1", NEXT_TELEMETRY_DISABLED: "1",
    NODE_OPTIONS: `--require "${path.resolve("scripts/tests/helpers/localDataHubNeonFetch.cjs").replaceAll("\\", "/")}"` } });
let log = "", browser;
server.stdout.on("data", part => { log += part; }); server.stderr.on("data", part => { log += part; });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  let ready = false;
  for (let i = 0; i < 90; i++) { if (server.exitCode !== null) throw new Error("LOCAL_NEXT_START_FAILED");
    try { if ((await fetch(`${origin}/login`)).ok) { ready = true; break; } } catch { /* local listener starting */ }
    await pause(500); }
  if (!ready) throw new Error("LOCAL_NEXT_TIMEOUT");
  browser = await chromium.launch(); const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
  const page = await context.newPage(), errors = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() === "POST" && request.url().endsWith("/mapping-setup")) writes.push(request.postDataJSON().action); });
  page.setDefaultTimeout(30000);
  await page.goto(`${origin}/login`); await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect.poll(async () => (await context.cookies()).some(cookie => cookie.name === "session" && cookie.httpOnly && cookie.secure)).toBe(true);
  await page.goto(`${origin}/data-hub/prepare/${uploadId}/mapping`);
  await expect(page.getByRole("button", { name: "Change saved mapping" })).toBeVisible(); expect(writes).toEqual([]);
  await page.getByRole("button", { name: "Change saved mapping" }).click();
  await expect(page.getByRole("checkbox")).toHaveCount(21);
  for (const checkbox of await page.getByRole("checkbox").all()) await checkbox.check();
  await page.getByLabel("Unit for Total Weight", { exact: true }).selectOption("t");
  await expect(page.getByRole("button", { name: "Save and activate reviewed mapping" })).toBeDisabled();
  await page.getByRole("checkbox", { name: "I confirm the meaning and unit for Total Weight", exact: true }).check();
  const savedResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith("/mapping-setup"));
  await page.getByRole("button", { name: "Save and activate reviewed mapping" }).click();
  const saved = await savedResponse;
  expect(saved.status(), await saved.text().catch(() => "BODY_UNAVAILABLE")).toBe(200);
  await expect(page.getByText("Mapping version 4.", { exact: false })).toBeVisible();
  const confirm = page.getByRole("button", { name: "Confirm mapping for this workbook" }); await expect(confirm).toBeDisabled();
  await page.getByRole("checkbox", { name: "This workbook uses the displayed units and formats." }).check(); await confirm.click();
  await expect(page.getByText(/This workbook is confirmed/)).toBeVisible(); expect(writes).toEqual(["SAVE", "CONFIRM"]);
  await page.screenshot({ path: path.join(directory, "approved-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("group", { name: "18. Duration", exact: true }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: path.join(directory, "approved-mobile.png") });
  const rows = (await pool.query("SELECT c.profile_version_id FROM data_hub_mapping_use_confirmations c JOIN worksheet_mapping_profile_versions v ON v.id=c.profile_version_id WHERE c.upload_id=$1 AND v.version_number=4", [uploadId])).rows;
  expect(rows).toHaveLength(1);
  await pool.query("UPDATE users SET role='VIEWER' WHERE id=$1", [username]);
  await page.getByRole("button", { name: "Refresh mapping status" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("access has changed");
  await expect(page.getByRole("checkbox")).toHaveCount(0); expect(writes).toEqual(["SAVE", "CONFIRM"]); expect(errors).toEqual([]);
  await writeFile(path.join(directory, "receipt.json"), JSON.stringify({ builtNext: true, realFormLogin: true, authenticatedAPIAndDatabase: true,
    editedAllFields: 21, editClearsConfirmation: true, savedVersion: 4, explicitWorkbookConfirmation: true, writes,
    phoneWidth: 390, horizontalOverflow: false, liveRoleLossClearsControls: true, pageErrors: 0,
    boundary: "Synthetic local workbook/account and loopback Neon transport; no real Blob upload, hosted pilot or Production change" }, null, 2));
  console.log("PASS: built Next mapping save/confirmation, desktop/mobile, live role denial; local synthetic database only.");
} finally {
  await pool.query("UPDATE users SET role='ADMIN' WHERE id=$1", [username]).catch(() => {});
  await browser?.close(); await pool.end();
  await writeFile(path.join(directory, "next-server.log"), log);
  if (server.exitCode === null) { server.kill(); await Promise.race([new Promise(resolve => server.once("exit", resolve)), pause(5000)]); }
}
