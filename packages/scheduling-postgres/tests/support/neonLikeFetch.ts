import { neonConfig } from '@neondatabase/serverless';
import type { Pool } from 'pg';

// TEST-ONLY. The REAL @neondatabase/serverless driver code (parameter serialisation, result parsing, error mapping) running against a disposable local Postgres.
//
// The driver talks to Neon with one HTTPS request per statement: POST {query, params} with the headers Neon-Raw-Text-Output and Neon-Array-Mode, answered with
// {fields: [{name, dataTypeID}], rows: [[text|null, ...]], rowCount, command}, or HTTP 400 with {message, code, ...} for a database error. neonConfig.fetchFunction
// replaces the network hop, so `neon(url)` is the genuine driver and what it sends is what Neon would receive, but each "request" is served by a pooled pg connection.
// What this reproduces faithfully: one statement per request, each in its own implicit transaction, on its own connection (a real race, not a serialised queue),
// no BEGIN/COMMIT across requests, text-format parameters and results, SQLSTATE in `.code`.
// What it does NOT prove: Neon's proxy, pooling and cold-start behaviour. That stays the opt-in live-branch run (SCHEDULING_NEON_DRIVER_URL, never Production).

type FetchLike = (url: string, init: { method: string; body: string; headers: Record<string, string> }) => Promise<unknown>;

const rawText = { getTypeParser: () => (v: string) => v } as unknown as { getTypeParser: (oid: number) => (v: string) => string };

export function installNeonLikeFetch(pool: Pool): { statements: string[]; restore: () => void } {
  const statements: string[] = [];
  const previous = neonConfig.fetchFunction;
  const serve: FetchLike = async (_url, init) => {
    const { query, params } = JSON.parse(init.body) as { query: string; params: unknown[] };
    statements.push(query);
    try {
      const result = (await pool.query({ text: query, values: params, rowMode: 'array', types: rawText } as unknown as string)) as unknown as { command: string; rowCount: number | null; fields: Array<{ name: string; dataTypeID: number }>; rows: unknown[] };
      return {
        ok: true,
        status: 200,
        json: async () => ({ command: result.command, rowCount: result.rowCount, fields: result.fields.map(f => ({ name: f.name, dataTypeID: f.dataTypeID })), rows: result.rows }),
        text: async () => '',
      };
    } catch (err) {
      const e = err as Record<string, unknown> & { message?: string };
      return { ok: false, status: 400, json: async () => ({ ...e, message: e.message ?? 'error' }), text: async () => String(e.message) };
    }
  };
  neonConfig.fetchFunction = serve as never;
  return {
    statements,
    restore: () => {
      neonConfig.fetchFunction = previous;
    },
  };
}
