import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConnection } from 'node:net';
import { ARTIFACTS, D4D5Q_BLOB, RECEIPT_VERSION, createAcceptanceReceipt } from './helpers/dataHubAcceptanceReceipt.mjs';

// Fixed local target only. No env pull, configurable DB, deployment or release.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const directory = resolve(root, 'test-results/datahub-runtime');
const receiptPath = resolve(directory, 'acceptance-receipt.json');
const fixturePath = resolve(directory, 'fixture.json');
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const clean = () => git('status', '--porcelain=v1') === '';
const environment = { ...process.env, DATABASE_URL: 'postgresql://postgres:test@localhost:9/testdb',
  DIRECT_URL: 'postgresql://postgres:test@localhost:9/testdb', SESSION_SECRET: 'disposable-build-only-key',
  NEXT_TELEMETRY_DISABLED: '1', DATAHUB_BROWSER_PROOF: '1' };
let stage = 'preflight', candidateCommit = null;
const startedAt = new Date().toISOString();
const record = value => writeFileSync(receiptPath, JSON.stringify(value, null, 2));

function run(command, args) {
  return new Promise((done, reject) => {
    const child = spawn(command, args, { cwd: root, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', data => { process.stdout.write(data); if (output.length < 1_048_576) output += data; });
    child.stderr.on('data', data => process.stderr.write(data));
    child.on('error', () => reject(new Error('LOCAL_COMMAND_FAILED')));
    child.on('exit', code => code === 0 ? done(output) : reject(new Error('LOCAL_COMMAND_FAILED')));
  });
}
async function listenerClosed(log) {
  const port = Number(log.match(/Local:\s+http:\/\/127\.0\.0\.1:(\d+)/)?.[1]);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('CLEANUP_UNCONFIRMED');
  return new Promise((done, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => { socket.destroy(); done(false); });
    socket.once('error', error => {
      socket.destroy();
      if (error.code === 'ECONNREFUSED') done(true); else reject(new Error('CLEANUP_UNCONFIRMED'));
    });
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('CLEANUP_UNCONFIRMED')); });
  });
}
try {
  mkdirSync(directory, { recursive: true });
  record({ receiptVersion: RECEIPT_VERSION, status: 'running', stage, startedAt, releaseAuthorized: false });
  if (process.argv.length !== 2) throw new Error('UNSUPPORTED_ARGUMENTS');
  if (!clean()) throw new Error('WORKTREE_DIRTY');
  if (existsSync(fixturePath)) throw new Error('TEST_FIXTURE_PENDING');
  candidateCommit = git('rev-parse', 'HEAD');
  const migrationBlob = git('hash-object', 'scripts/create-datahub-analysis-reviews.sql');
  if (migrationBlob !== D4D5Q_BLOB) throw new Error('MIGRATION_CONTENT_CHANGED');
  stage = 'optimized-build';
  await run(process.execPath, [resolve(root, 'node_modules/next/dist/bin/next'), 'build', '--webpack']);
  const buildId = readFileSync(resolve(root, '.next/BUILD_ID'), 'utf8').trim();
  stage = 'owned-postgres-browser';
  const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
  const output = await run(bash, ['scripts/tests/verify-datahub-profile-execution.sh']);
  stage = 'cleanup-and-receipt';
  const ownedContainer = output.match(/Starting disposable postgres:16-alpine \((datahub-6-2d4d1b2-profile-execution-\d+)\)/)?.[1];
  if (!ownedContainer) throw new Error('CLEANUP_UNCONFIRMED');
  const containers = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/);
  const cleanup = { ownedDatabaseRemoved: !containers.includes(ownedContainer),
    loginFixtureRemoved: !existsSync(fixturePath),
    localListenerClosed: await listenerClosed(readFileSync(resolve(directory, 'next-server.log'), 'utf8')) };
  const evidenceFile = readFileSync(resolve(directory, 'evidence.json'));
  if (evidenceFile.byteLength > 65536) throw new Error('ACCEPTANCE_RECEIPT_INVALID');
  const receipt = createAcceptanceReceipt({ candidateCommit, finalCommit: git('rev-parse', 'HEAD'), migrationBlob,
    cleanWorktree: clean(), buildId, startedAt, completedAt: new Date().toISOString(), cleanup,
    evidence: JSON.parse(evidenceFile.toString('utf8')),
    artifactHashes: Object.fromEntries(ARTIFACTS.map(name => [name, createHash('sha256').update(readFileSync(resolve(directory, name))).digest('hex')])) });
  record(receipt);
  console.log(`PASS: isolated acceptance receipt for ${candidateCommit}; release authorization remains separate.`);
} catch (error) {
  // Only the just-run harness could create this fixed generated file: preflight
  // refuses pre-existing fixtures. Never delete files from another run/target.
  if (['owned-postgres-browser', 'cleanup-and-receipt'].includes(stage) && existsSync(fixturePath)) unlinkSync(fixturePath);
  const codes = ['UNSUPPORTED_ARGUMENTS', 'WORKTREE_DIRTY', 'TEST_FIXTURE_PENDING', 'MIGRATION_CONTENT_CHANGED', 'LOCAL_COMMAND_FAILED', 'CLEANUP_UNCONFIRMED', 'ACCEPTANCE_RECEIPT_INVALID'];
  const code = codes.includes(error?.message) ? error.message : 'ACCEPTANCE_FAILED';
  record({ receiptVersion: RECEIPT_VERSION, status: 'failed', candidateCommit, startedAt, completedAt: new Date().toISOString(), stage, code, releaseAuthorized: false });
  console.error(`FAIL: isolated acceptance (${stage}, ${code}).`); process.exitCode = 1;
}
