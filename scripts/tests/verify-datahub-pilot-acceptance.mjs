// Entirely owned local acceptance. No target URL, env pull or cloud credentials.
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'test-results/runs-pilot-acceptance'); mkdirSync(directory, { recursive: true });
const receiptPath = path.join(directory, 'acceptance-receipt.json');
const git = (...args) => execFileSync('git', args, { cwd: root, windowsHide: true, encoding: 'utf8' }).trim();
const record = value => writeFileSync(receiptPath, JSON.stringify(value, null, 2));
const startedAt = new Date().toISOString(); let candidateCommit = null;
record({ status: 'running', startedAt, releaseAuthorized: false });
try {
  if (process.argv.length !== 2) throw new Error('UNSUPPORTED_ARGUMENTS');
  if (git('status', '--porcelain=v1')) throw new Error('WORKTREE_DIRTY');
  candidateCommit = git('rev-parse', 'HEAD');
  const child = spawn(process.execPath, ['scripts/tests/verify-datahub-mapping-setup.mjs', '--browser'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DATAHUB_PILOT_ACCEPTANCE: '1' },
  });
  let output = '';
  child.stdout.on('data', part => { process.stdout.write(part); if (output.length < 1048576) output += part; });
  child.stderr.on('data', part => process.stderr.write(part));
  const code = await new Promise(resolve => { child.once('exit', resolve); child.once('error', () => resolve(1)); });
  if (code !== 0) throw new Error('LOCAL_ACCEPTANCE_FAILED');
  const evidence = JSON.parse(readFileSync(path.join(directory, 'receipt.json'), 'utf8'));
  const container = output.match(/Starting disposable postgres:16-alpine \((datahub-6-2d4d1b2-profile-execution-\d+)\)/)?.[1];
  const containers = execFileSync('docker', ['ps', '-a', '--format', '{{.Names}}'], { windowsHide: true, encoding: 'utf8' }).trim().split(/\r?\n/);
  if (!container || containers.includes(container) || evidence.passed !== true || evidence.uploads !== 1 ||
      evidence.listenerClosed !== true || evidence.ownedStorageRemoved !== true || evidence.checks.length < 4 ||
      evidence.pageErrors.length || evidence.providerErrors.length || git('rev-parse', 'HEAD') !== candidateCommit || git('status', '--porcelain=v1')) throw new Error('PROOF_OR_CLEANUP_UNCONFIRMED');
  record({ status: 'passed', candidateCommit, startedAt, completedAt: new Date().toISOString(),
    buildId: readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(),
    migrationGitBlob: git('hash-object', 'scripts/create-datahub-mapping-confirmations.sql'),
    ownedDatabaseRemoved: true, listenerClosed: true, ownedStorageRemoved: true,
    artifactSha256: Object.fromEntries(['receipt.json', 'next-server.log', 'counts-mobile.png'].map(name =>
      [name, createHash('sha256').update(readFileSync(path.join(directory, name))).digest('hex')])),
    productionTouched: false, releaseAuthorized: false, boundary: evidence.boundary });
} catch (error) {
  const known = ['UNSUPPORTED_ARGUMENTS', 'WORKTREE_DIRTY', 'LOCAL_ACCEPTANCE_FAILED', 'PROOF_OR_CLEANUP_UNCONFIRMED'];
  record({ status: 'failed', candidateCommit, startedAt, completedAt: new Date().toISOString(),
    code: known.includes(error.message) ? error.message : 'LOCAL_ACCEPTANCE_FAILED', releaseAuthorized: false });
  console.error('FAIL: local pilot acceptance; see acceptance-receipt.json.'); process.exitCode = 1;
}
