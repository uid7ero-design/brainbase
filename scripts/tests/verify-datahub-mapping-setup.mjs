// Own disposable Docker database only; the shell helper overrides DATABASE_URL.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
if (process.argv.length > 3 || (process.argv[2] && process.argv[2] !== "--browser")) throw new Error("UNSUPPORTED_ARGUMENTS");
if (process.argv[2] === "--browser") {
  const build = spawn(process.execPath, [path.join(root, "node_modules/next/dist/bin/next"), "build"], { cwd: root, windowsHide: true,
    env: { ...process.env, DATABASE_URL: "postgresql://postgres:test@localhost:9/testdb", DIRECT_URL: "postgresql://postgres:test@localhost:9/testdb",
      SESSION_SECRET: "disposable-build-only-key", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "inherit" });
  const code = await new Promise(resolve => { build.on("exit", resolve); build.on("error", () => resolve(1)); });
  if (code !== 0) process.exit(1);
}
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const child = spawn(bash, ["scripts/tests/verify-datahub-profile-execution.sh"], { cwd: root, windowsHide: true,
  env: { ...process.env, DATAHUB_MAPPING_PROOF: "1", DATAHUB_BROWSER_PROOF: "0", DATAHUB_MAPPING_BROWSER_PROOF: process.argv[2] === "--browser" ? "1" : "0" }, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });
child.on("error", () => { process.exitCode = 1; });
