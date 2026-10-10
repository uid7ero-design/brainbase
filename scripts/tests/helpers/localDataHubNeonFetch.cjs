// Test-only transport for `next start`. Production queries, type parsing and
// transactions remain real. Never load this in a deployed application.
// Node --require preloads must be CommonJS, before Next patches global fetch.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Pool } = require('pg');
const connectionString = process.env.DATABASE_URL;
if (!connectionString || !['127.0.0.1','localhost'].includes(new URL(connectionString).hostname) || new URL(connectionString).pathname !== '/testdb' || process.env.DATAHUB_BROWSER_PROOF !== '1') {
  throw new Error('Data Hub runtime transport requires a disposable loopback database');
}
const localConnection = new URL(connectionString); localConnection.hostname='127.0.0.1';
const pool = new Pool({ connectionString:localConnection.href, max: 8 });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(typeof input === 'string' ? input : input.url ?? input.href);
  const headers = new Headers(options.headers);
  if (headers.has('Neon-Connection-String')) {
    const endpointHost = new URL(connectionString).hostname.replace(/^[^.]+\./, 'api.');
    if (headers.get('Neon-Connection-String') !== connectionString || url.hostname !== endpointHost || url.pathname !== '/sql') throw new Error('Non-local database access blocked');
    const body = JSON.parse(options.body);
    const client = await pool.connect();
    // Return PostgreSQL wire text so the production Neon client applies its own
    // type parsers (including JSON, int8, dates and booleans).
    const query = async entry => {
      const result = await client.query({ text: entry.query, values: entry.params, rowMode: 'array', types: { getTypeParser: () => value => value } });
      return { fields: result.fields, rows: result.rows, rowCount: result.rowCount, command: result.command };
    };
    try {
      let result;
      if (body.queries) {
        const isolation = headers.get('Neon-Batch-Isolation-Level') ?? 'ReadCommitted';
        const levels = { ReadCommitted:'READ COMMITTED', RepeatableRead:'REPEATABLE READ', Serializable:'SERIALIZABLE' };
        if (!levels[isolation]) throw new Error('Unsupported local transaction isolation');
        await client.query(`BEGIN ISOLATION LEVEL ${levels[isolation]}`);
        const results = []; for (const entry of body.queries) results.push(await query(entry));
        await client.query('COMMIT'); result = { results };
      } else result = await query(body);
      return Response.json(result);
    } catch (error) {
      if (body.queries) await client.query('ROLLBACK');
      return Response.json({ message:error.message, code:error.code, constraint:error.constraint, detail:error.detail }, { status:400 });
    } finally { client.release(); }
  }
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) throw new Error('External fetch blocked by Data Hub runtime harness');
  return originalFetch(input, options);
};
