// Test-only stand-in for lib/db.ts's Neon HTTP `sql` client, backed by a
// real `pg` Pool against a DISPOSABLE local Postgres. Reproduces exactly the
// Neon surface the Assurance services use:
//   * sql`...`                 lazy, awaitable parameterised query
//   * nested sql`...` fragments composable (Neon >= 1.0 semantics)
//   * sql.unsafe(raw)          raw SQL text (allow-listed identifiers only)
//   * sql.transaction([...])   non-interactive transaction over a query array
// Parameters are sent untyped ($n), like Neon, so Postgres infers types from
// context — casts in the service SQL behave identically.
import { Pool } from 'pg';

class UnsafeRaw {
  constructor(readonly text: string) {}
}

export class PgQuery implements PromiseLike<unknown[]> {
  constructor(private readonly exec: (q: PgQuery) => Promise<unknown[]>, readonly strings: readonly string[], readonly values: unknown[]) {}

  compile(): { text: string; params: unknown[] } {
    const params: unknown[] = [];
    const walk = (q: PgQuery): string => {
      let text = q.strings[0];
      q.values.forEach((v, i) => {
        if (v instanceof PgQuery) text += walk(v);
        else if (v instanceof UnsafeRaw) text += v.text;
        else {
          params.push(v);
          text += `$${params.length}`;
        }
        text += q.strings[i + 1];
      });
      return text;
    };
    return { text: walk(this), params };
  }

  then<A = unknown[], B = never>(onfulfilled?: ((value: unknown[]) => A | PromiseLike<A>) | null, onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null): Promise<A | B> {
    return this.exec(this).then(onfulfilled, onrejected);
  }
}

export function createNeonCompatibleSql(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });

  const run = async (q: PgQuery): Promise<unknown[]> => {
    const { text, params } = q.compile();
    const res = await pool.query(text, params);
    return res.rows;
  };

  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => new PgQuery(run, strings, values)) as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): PgQuery;
    unsafe(raw: string): UnsafeRaw;
    transaction(queries: PgQuery[] | ((txn: unknown) => PgQuery[])): Promise<unknown[][]>;
    end(): Promise<void>;
    raw(text: string): Promise<unknown[]>;
  };

  sql.unsafe = (raw: string) => new UnsafeRaw(raw);

  sql.transaction = async (queries) => {
    const list = typeof queries === 'function' ? queries(sql) : queries;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const results: unknown[][] = [];
      for (const q of list) {
        const { text, params } = q.compile();
        results.push((await client.query(text, params)).rows);
      }
      await client.query('COMMIT');
      return results;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  };

  sql.end = () => pool.end();
  sql.raw = async (text: string) => (await pool.query(text)).rows;

  return sql;
}
