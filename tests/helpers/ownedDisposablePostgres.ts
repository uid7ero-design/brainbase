// Disposable Postgres OWNED by a single test run.
//
// Destructive SQL (DROP SCHEMA … CASCADE) and container removal are only
// ever performed on resources this run provably created:
//   1. the run starts its own container, named and LABELLED with a random
//      per-run token, bound to 127.0.0.1 on a random port;
//   2. the connection string is built only from that container (user,
//      password and database are the token) — no environment variable, no
//      application/Production connection string is ever read;
//   3. every table lives in a schema named after the token, which this run
//      creates together with an ownership marker row holding the token.
// assertRunOwnership() checks the container label AND the marker before any
// destructive statement; cleanup drops only that schema and removes only the
// container whose id, name and label all match this run.

import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

export const OWNER_LABEL = 'bb.founder-overview.run';
export const MARKER_TABLE = 'bb_run_owner';

export type OwnedRun = {
  token: string;
  containerId: string;
  containerName: string;
  schema: string;
  connectionString: string;
};

export type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
export type Exec = (file: string, args: string[]) => string;

const TOKEN_RE = /^[a-f0-9]{24}$/;
const defaultExec: Exec = (file, args) => execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

export function newRunToken(): string {
  return randomBytes(12).toString('hex');
}

export function schemaFor(token: string): string {
  if (!TOKEN_RE.test(token)) throw new Error('invalid run token');
  return `founder_overview_${token}`;
}

/** Starts this run's own container and returns a run bound to it. */
export async function startOwnedPostgres(exec: Exec = defaultExec, image = 'postgres:16-alpine'): Promise<OwnedRun> {
  const token = newRunToken();
  const containerName = `bb-founder-overview-${token}`;
  const containerId = exec('docker', [
    'run', '-d', '--rm',
    '--name', containerName,
    '--label', `${OWNER_LABEL}=${token}`,
    '-e', `POSTGRES_USER=u${token}`,
    '-e', `POSTGRES_PASSWORD=${token}`,
    '-e', `POSTGRES_DB=d${token}`,
    '-p', '127.0.0.1::5432',
    image,
  ]);
  const mapping = exec('docker', ['port', containerId, '5432/tcp']).split('\n')[0];
  const m = /^127\.0\.0\.1:(\d+)$/.exec(mapping.trim());
  if (!m) {
    await stopOwnedContainer({ token, containerId, containerName, schema: schemaFor(token), connectionString: '' }, exec);
    throw new Error(`container not bound to loopback: ${mapping}`);
  }
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      exec('docker', ['exec', containerId, 'pg_isready', '-h', '127.0.0.1', '-U', `u${token}`, '-d', `d${token}`]);
      break;
    } catch {
      if (Date.now() > deadline) throw new Error('owned postgres did not become ready');
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return {
    token,
    containerId,
    containerName,
    schema: schemaFor(token),
    connectionString: `postgresql://u${token}:${token}@127.0.0.1:${m[1]}/d${token}`,
  };
}

/** Creates this run's schema and its ownership marker. Refuses if the schema already exists. */
export async function claimRunSchema(client: QueryClient, run: OwnedRun): Promise<void> {
  const schema = schemaFor(run.token);
  if (schema !== run.schema) throw new Error('schema does not belong to this run');
  // Plain CREATE SCHEMA (no IF NOT EXISTS): a pre-existing schema is not ours.
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`CREATE TABLE ${schema}.${MARKER_TABLE}(token text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`INSERT INTO ${schema}.${MARKER_TABLE}(token) VALUES ($1)`, [run.token]);
}

/** Throws unless the container label and the in-database marker both prove this run owns the target. */
export async function assertRunOwnership(client: QueryClient, run: OwnedRun, exec: Exec = defaultExec): Promise<void> {
  if (!TOKEN_RE.test(run.token)) throw new Error('ownership refused: invalid run token');
  if (run.schema !== schemaFor(run.token)) throw new Error('ownership refused: schema does not match run token');
  if (!/^postgresql:\/\/[^@]+@127\.0\.0\.1:\d+\//.test(run.connectionString)) throw new Error('ownership refused: not a loopback connection');
  const label = exec('docker', ['inspect', '--format', `{{ index .Config.Labels "${OWNER_LABEL}" }}`, run.containerId]);
  if (label !== run.token) throw new Error('ownership refused: container label does not match run token');
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await client.query(`SELECT token FROM ${run.schema}.${MARKER_TABLE}`));
  } catch {
    throw new Error('ownership refused: ownership marker missing');
  }
  if (rows.length !== 1 || rows[0].token !== run.token) throw new Error('ownership refused: ownership marker does not match run token');
}

/** Drops only this run's schema, after proving ownership. */
export async function dropOwnedSchema(client: QueryClient, run: OwnedRun, exec: Exec = defaultExec): Promise<void> {
  await assertRunOwnership(client, run, exec);
  await client.query(`DROP SCHEMA ${run.schema} CASCADE`);
}

/** Removes only the container whose id, name and label all match this run. */
export async function stopOwnedContainer(run: OwnedRun, exec: Exec = defaultExec): Promise<void> {
  if (!TOKEN_RE.test(run.token)) throw new Error('refusing to remove container: invalid run token');
  const out = exec('docker', ['inspect', '--format', `{{.Id}} {{.Name}} {{ index .Config.Labels "${OWNER_LABEL}" }}`, run.containerId]);
  const [id, name, label] = out.split(' ');
  if (!id.startsWith(run.containerId.slice(0, 12)) || name !== `/${run.containerName}` || label !== run.token) {
    throw new Error('refusing to remove container: not owned by this run');
  }
  exec('docker', ['rm', '-f', id]);
}
