// Scheduling browser harness: a disposable PostgreSQL 17, the real Next server, synthetic accounts signed in through the real
// login form, and Playwright's Chromium. Local only; never Production, Preview or Neon. See
// docs/architecture/scheduling-browser-harness.md.
//
// USAGE   node scripts/tests/verify-scheduling-browser-local.mjs [playwright args, e.g. permissions.spec.ts --project=desktop]
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startSchedulingBrowserEnv } from './helpers/schedulingBrowserEnv.mjs';

const root = process.cwd();
const stateDir = mkdtempSync(path.join(tmpdir(), 'sched-browser-state-'));
let env;
let code = 1;
try {
  env = await startSchedulingBrowserEnv({ root });
  const args = ['node_modules/@playwright/test/cli.js', 'test', '--config', 'tests/browser/scheduling/playwright.config.ts', ...process.argv.slice(2)];
  // Asynchronous on purpose: the SQL bridge and the TLS proxy live in THIS process, so its event loop must stay free while
  // Playwright runs (a synchronous spawn would starve them and every browser request would time out).
  const status = await new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, SCHED_BROWSER_OUTPUT_DIR: path.join(stateDir, 'results'), SCHED_BROWSER_ORIGIN: env.origin, SCHED_BROWSER_PASSWORD: env.password, SCHED_BROWSER_STATE_DIR: stateDir, SCHED_BROWSER_DATABASE_URL: env.databaseUrl },
    });
    child.once('error', () => resolve(1));
    child.once('exit', exitCode => resolve(exitCode ?? 1));
  });
  code = status;
  console.log(code === 0 ? 'SCHEDULING BROWSER HARNESS: PASS' : 'SCHEDULING BROWSER HARNESS: FAIL');
  if (code !== 0) console.error(env.logs().slice(-6000));
} catch (error) {
  console.error(error.stack ?? error);
} finally {
  await env?.stop();
  rmSync(stateDir, { recursive: true, force: true });
}
process.exit(code);
