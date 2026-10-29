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
}

/** Adapts anything with the node-postgres `query(text, values) => { rows }` shape. */
export function fromPgLike(client: {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
}): SqlExecutor {
  return {
    async query<Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query(text, [...params]);
      return result.rows as Row[];
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
  };
}
