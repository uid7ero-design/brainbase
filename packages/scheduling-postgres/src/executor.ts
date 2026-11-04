// The only thing the Postgres adapter needs from its environment: run one parameterised SQL
// statement and return rows. It is deliberately NOT a Neon, pg or Prisma type, so the same
// repositories run on the Neon HTTP driver, a pooled or direct pg connection, or a standalone
// deployment's own database. Every repository operation is ONE statement (see README): the
// adapter never needs, and never assumes, an interactive transaction.
//
// Contract for implementations:
//  * `$1, $2, ...` positional parameters;
//  * rows are plain objects keyed by column name;
//  * errors propagate as thrown objects carrying a Postgres `code` (SQLSTATE) and, where
//    available, `constraint`; both pg and @neondatabase/serverless do this.
export interface SqlExecutor {
  query<Row = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<Row[]>;
  /**
   * OPTIONAL. Runs the statements in order in ONE transaction and returns each statement's rows: they all commit or none does, and a transaction-local setting made by
   * the first (set_config(..., true)) applies to the rest. Non-interactive: no statement can depend on the rows of an earlier one. The facility-hire booking needs it to bound
   * its own lock wait and run time without changing a role that other applications share; an executor without it makes createHire refuse to run rather than run unbounded.
   */
  transaction?(statements: readonly SqlStatement[]): Promise<Array<Record<string, unknown>[]>>;
}

export interface SqlStatement {
  text: string;
  params?: readonly unknown[];
}

/** Adapts anything with the node-postgres `query(text, values) => { rows }` shape. */
export function fromPgLike(client: {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  /** A pg.Pool: transaction() checks one connection out for the whole transaction. A pg.Client has no connect-and-release and is used as it is. */
  connect?: unknown;
  totalCount?: number;
}): SqlExecutor {
  const isPool = typeof client.totalCount === 'number' && typeof client.connect === 'function';
  type Conn = { query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>; release(error?: Error | boolean): void };
  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query(text, [...params]);
      return result.rows as Row[];
    },
    async transaction(statements) {
      const conn = isPool ? await (client as unknown as { connect(): Promise<Conn> }).connect() : null;
      const run = (text: string, values?: unknown[]) => (conn ? conn.query(text, values) : client.query(text, values));
      let failed: Error | undefined;
      try {
        await run('BEGIN');
        const out: Array<Record<string, unknown>[]> = [];
        for (const s of statements) out.push((await run(s.text, [...(s.params ?? [])])).rows as Record<string, unknown>[]);
        await run('COMMIT');
        return out;
      } catch (err) {
        failed = err as Error;
        // The server rolls an errored transaction back; ROLLBACK also covers a failure of COMMIT's reply. A dead connection cannot roll back and is discarded below.
        await run('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        conn?.release(failed);
      }
    },
  };
}

/**
 * Adapts a Neon HTTP driver function (`neon(url)`): `sql.query(text, params)` returns rows.
 * Takes the function structurally so this package never imports @neondatabase/serverless.
 */
export function fromNeonHttpLike(
  sql: {
    query(text: string, params?: unknown[], queryOptions?: Record<string, unknown>): Promise<unknown>;
    /** The driver's non-interactive transaction: takes query objects made by sql.query (lazy: not yet sent) and sends them as one HTTP request, one transaction. */
    transaction?(queries: unknown[], options?: Record<string, unknown>): Promise<unknown[]>;
  },
  options: {
    /**
     * Passed to the driver as the third argument of every query (the Neon HTTP driver merges its `fetchOptions` into the request it makes), so a caller can
     * bound a request: `{ fetchOptions: { signal } }` makes every statement stop waiting when the signal aborts. Absent: the call is exactly as before.
     */
    queryOptions?: Record<string, unknown>;
  } = {},
): SqlExecutor {
  const { queryOptions } = options;
  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const rows = queryOptions ? await sql.query(text, [...params], queryOptions) : await sql.query(text, [...params]);
      return rows as Row[];
    },
    ...(typeof sql.transaction === 'function'
      ? {
          async transaction(statements: readonly SqlStatement[]) {
            // sql.query(...) with no await is a lazy query object; transaction() sends them together.
            const queries = statements.map(s => (queryOptions ? sql.query(s.text, [...(s.params ?? [])], queryOptions) : sql.query(s.text, [...(s.params ?? [])])));
            return (await sql.transaction!(queries, queryOptions)) as Array<Record<string, unknown>[]>;
          },
        }
      : {}),
  };
}
