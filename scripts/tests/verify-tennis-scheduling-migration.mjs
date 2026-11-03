// Owns its disposable database. No supplied DATABASE_URL or live provider is used.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
const image = process.argv[2] ?? 'postgres:16-alpine';
if (!['postgres:16-alpine', 'postgres:17-alpine'].includes(image)) throw Error('Use an approved Postgres 16/17 image');
const name = `tennis-migration-${randomBytes(6).toString('hex')}`;
const password = randomBytes(24).toString('hex');
const exec = (file, args, options = {}) => execFileSync(file, args, { encoding: 'utf8', windowsHide: true, ...options });
let created = false;
try {
  exec('docker', ['run', '-d', '--name', name, '-e', `POSTGRES_PASSWORD=${password}`, '-e', 'POSTGRES_DB=tennis_migration_proof', '-p', '127.0.0.1::5432', image]);
  created = true;
  const address = exec('docker', ['port', name, '5432/tcp']).trim();
  if (!/^127\.0\.0\.1:\d+$/.test(address)) throw Error('Disposable database must use loopback');
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { exec('docker', ['exec', name, 'pg_isready', '-U', 'postgres'], { stdio: 'ignore' }); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  if (!ready) throw Error('Disposable Postgres failed to start');
  const url = `postgresql://postgres:${password}@${address}/tennis_migration_proof`;
  exec(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/containment/tennisSchedulingMigration.test.ts', 'tests/containment/tennisSchedulingMigrationPostgres.test.ts'], {
    stdio: 'inherit', timeout: 120000,
    env: { ...process.env, TENNIS_MIGRATION_TEST_URL: url, DATABASE_URL: url, DIRECT_URL: url, RESEND_API_KEY: '' },
  });
  exec('docker', ['exec', name, 'createdb', '-U', 'postgres', 'tennis_coaching_proof']);
  const coachingUrl = `postgresql://postgres:${password}@${address}/tennis_coaching_proof`;
  exec(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/containment/tennisSchedulingBookingsPostgres.test.ts'], {
    stdio: 'inherit', timeout: 120000,
    env: { ...process.env, TENNIS_COACHING_TEST_URL: coachingUrl, DATABASE_URL: coachingUrl, DIRECT_URL: coachingUrl, RESEND_API_KEY: '' },
  });
  exec('docker', ['exec', name, 'createdb', '-U', 'postgres', 'tennis_history_proof']);
  const historyUrl = `postgresql://postgres:${password}@${address}/tennis_history_proof`;
  exec(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/containment/tennisSchedulingHistoryPostgres.test.ts'], {
    stdio: 'inherit', timeout: 120000,
    env: { ...process.env, TENNIS_HISTORY_TEST_URL: historyUrl, DATABASE_URL: historyUrl, DIRECT_URL: historyUrl, RESEND_API_KEY: '' },
  });
} finally {
  if (created) {
    exec('docker', ['rm', '-f', name], { stdio: 'ignore' });
    const left = exec('docker', ['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']).trim();
    if (left) throw Error('Owned disposable database cleanup incomplete');
    console.log('Owned disposable database removed.');
  }
}
