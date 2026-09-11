/**
 * HLNA data engine — NL→SQL execution, trend detection, anomaly identification.
 *
 * Security model:
 *   - Only SELECT statements are executed.
 *   - organisation_id must appear in every query (prevents cross-tenant reads).
 *   - Results are capped at 200 rows.
 *   - The org ID is embedded by Claude as a literal UUID; the caller validates
 *     it matches the authenticated session before executing.
 */

import sql from '@/lib/db';

// ─── Schema description (fed to Claude as tool context) ───────────────────────

export const DB_SCHEMA = `
PostgreSQL tables — ALL scoped by organisation_id (UUID):

waste_records
  department   TEXT          -- source department: 'Waste', 'Customer Complaints', etc. Default 'Waste'.
  service_type TEXT          -- e.g. 'General Waste', 'Recycling', 'Organics', 'Hard Waste'
  suburb       TEXT
  month        TEXT          -- short name: 'Jul','Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun'
  financial_year TEXT        -- e.g. '2025-26'
  tonnes       NUMERIC
  collections  INTEGER
  contamination_rate NUMERIC -- percentage, e.g. 8.5
  cost         NUMERIC
FILTER RULE: Always add "AND department = 'Waste'" when answering Waste dashboard questions.

fleet_metrics
  vehicle_id     TEXT        -- e.g. 'TRK003'
  vehicle_type   TEXT        -- e.g. 'Rear Loader', 'Side Loader', 'Hook Truck'
  make           TEXT
  year           INTEGER
  department     TEXT        -- vehicle's home department
  driver         TEXT
  km             NUMERIC     -- distance driven (km)
  wages          NUMERIC
  fuel           NUMERIC     -- fuel cost ($)
  maintenance    NUMERIC     -- maintenance cost ($)
  rego           NUMERIC
  repairs        NUMERIC
  insurance      NUMERIC
  depreciation   NUMERIC
  services       INTEGER     -- service count
  defects        INTEGER     -- defect count (breakdowns/faults)
  downtime_hours NUMERIC     -- hours vehicle was out of service
  route_minutes  NUMERIC     -- total route time (minutes)
  month          TEXT
  financial_year TEXT

service_requests
  request_id   TEXT
  service_type TEXT
  suburb       TEXT
  month        TEXT
  financial_year TEXT
  status       TEXT          -- e.g. 'Open', 'Closed', 'Pending'
  priority     TEXT          -- 'High', 'Medium', 'Low'
  days_open    INTEGER
  cost         NUMERIC

metric_snapshots              -- cross-module universal metric layer
  module_key      TEXT       -- e.g. 'waste_recycling', 'fleet_management'
  metric_key      TEXT       -- e.g. 'contamination_rate', 'fleet_availability'
  metric_label    TEXT
  value           NUMERIC
  unit            TEXT       -- e.g. '%', '$', 'tonnes'
  period_start    DATE
  period_end      DATE
  dimension       TEXT       -- optional grouping dimension e.g. 'suburb', 'vehicle_type'
  dimension_value TEXT       -- value of that dimension
  source_table    TEXT       -- originating table
`.trim();

// ─── Table-level allowlist (HR-0.5 §2 — defense against arbitrary-table access) ─
//
// The guards in executeQuery() below validate SQL *shape* (SELECT-only, no
// writes, no multi-statement) and the *presence* of an organisation_id
// filter — none of that restricts *which* tables the generated SQL may
// reference. Before this change, nothing did: any table with an
// organisation_id column (including a future hr_* table) was queryable the
// moment the model became aware of its name, regardless of DB_SCHEMA above
// (DB_SCHEMA is prompt content fed to Claude, not a security boundary, and
// is deliberately not consulted here). This section closes that gap with an
// explicit allowlist, checked independently of DB_SCHEMA and of the caller.
//
// Supported SQL subset for table-reference extraction (a full SQL parser
// dependency was judged unjustified for a 4-table read-only allowlist —
// this is a small, hand-written scanner, not a regex applied to raw text):
//   - Standard `'...'` string literals (with '' escaping), `--` line
//     comments, and `/* ... */` block comments are stripped before any
//     keyword/identifier scan, so a table name appearing only inside a
//     string or comment can never satisfy or defeat the allowlist.
//   - Nested or unbalanced `/* */` comments are treated as malformed input
//     and REJECTED outright rather than parsed — Postgres is unusual in
//     nesting block comments, and a naive single-pass strip could
//     otherwise be defeated by nesting; failing closed avoids that class
//     of bypass entirely rather than trying to parse it correctly.
//   - `FROM`/`JOIN` (any join flavour — LEFT/INNER/etc. precede JOIN and
//     are not part of the match) are matched wherever they occur in the
//     cleaned text. This is a flat scan, not a structural parse, so it
//     naturally covers subqueries and CTE bodies too — every FROM/JOIN in
//     the query is found regardless of nesting depth.
//   - Optional schema qualification (`schema.table`) and double-quoted
//     identifiers are recognised; only the final, unqualified table name
//     is compared against the allowlist.
//   - Table aliases (`FROM x AS a`, `FROM x a`) never participate in the
//     match — only the single identifier immediately after FROM/JOIN is
//     captured, so an alias cannot be mistaken for (or hide) a table name.
//   - `WITH name AS (...)` / `WITH name(col, ...) AS (...)` CTE names are
//     recognised and excluded from the "must be a real table" requirement
//     — the CTE's own body is still scanned normally by the same flat
//     pass, so any real table it references is still validated.
//   - `$tag$...$tag$` dollar-quoted strings (Postgres's other string-literal
//     form, `$$...$$` included as the empty-tag case) are stripped exactly
//     like `'...'` literals, for the same reason: their content must never
//     be scanned as if it were real syntax.
//   - NOT supported: table names built dynamically (string concatenation,
//     `EXECUTE`) — already impossible, since EXECUTE and multi-statement
//     queries are rejected by the existing guards below.
//
// INTENTIONALLY NARROWED GRAMMAR (HR-0.5 security follow-up): Postgres's
// FROM clause allows a comma-separated list of table_references
// (`FROM a, b, c` — the old-style implicit join/cross join, equivalent to
// `FROM a CROSS JOIN b CROSS JOIN c`), where each element can itself be
// arbitrarily complex (a subquery, a LATERAL subquery, a parenthesized
// join, a table function call...). Correctly enumerating every base
// relation in that general grammar requires something close to a real SQL
// parser — disproportionate for a tool that only ever needs to run simple
// read queries against 4 known tables. Rather than attempt that (and risk
// an incomplete regex-based enumeration silently missing a relation), this
// module takes the narrower, safer path the table-reference extraction
// above already can't fully cover: assertNoTopLevelCommaJoins() below
// REJECTS any query whose FROM clause contains a top-level comma at all,
// at any nesting depth (top query, subquery, or CTE body) — regardless of
// whether every comma-separated element would otherwise have been
// allowlisted. This is a deliberate grammar restriction, not a parsing
// gap: legitimate queries must use explicit JOIN syntax, which the
// existing FROM/JOIN extraction above already handles correctly and
// completely for the single-relation-per-keyword case.
//
// WHY REPLACING STRIPPED LEXICAL CONTENT WITH A SINGLE SPACE CANNOT
// INTRODUCE FALSE ACCEPTANCE (the security invariant this file must
// uphold: removing literals/comments for analysis must never concatenate
// otherwise-separate SQL tokens, and the table-access guard must not rely
// on Postgres itself rejecting whatever malformed adjacency the scanner's
// own stripping produces). Every branch of stripLiteralsAndComments()
// that removes lexical content (string literals, dollar-quoted strings,
// block comments) now inserts exactly one space in place of the removed
// content, rather than nothing. This is a strictly one-directional
// change with respect to what gets detected:
//   - A single-quote, dollar-quote, or comment delimiter in the ORIGINAL
//     source text is always a genuine boundary between whatever precedes
//     it and whatever follows it — no unquoted identifier or keyword can
//     itself contain a raw `'`, a `$tag$` delimiter, or `/*`/`--` in the
//     middle, so nothing that was ever "one token" in the real source
//     gets split apart by inserting a separator at a position that was
//     already a real boundary.
//   - Therefore inserting a space can only ever ADD a token boundary
//     that a zero-character deletion had erroneously destroyed — it can
//     never REMOVE or hide a boundary that genuinely existed. Every
//     match the allowlist/deny-list/comma-join checks were already
//     correctly making before this change is still made identically
//     after it; the only behavioural change is that constructs which
//     previously and erroneously collapsed into one unmatched token
//     (e.g. `FROM'x'hr_people` → `FROMhr_people`) now correctly resolve
//     into separately-matchable tokens (`FROM hr_people`) and are
//     correctly rejected. There is no code path by which this change
//     converts a query that was previously, correctly rejected into one
//     that is now accepted — only the reverse (previously-invisible
//     constructs becoming visible and thus rejected). False rejection of
//     genuinely ambiguous or unsupported grammar remains acceptable per
//     this file's fail-closed design; false acceptance is what this
//     argument rules out.
//   - This holds independently of whether the ORIGINAL raw SQL (before
//     any stripping) would itself have been valid, executable Postgres —
//     the guard does not, and must not, depend on the database rejecting
//     a malformed query the scanner failed to catch first.

export const ALLOWED_TABLES = new Set(['waste_records', 'fleet_metrics', 'service_requests', 'metric_snapshots']);

// Defense-in-depth: hr_* tables are rejected unconditionally, even if a
// future edit to ALLOWED_TABLES accidentally adds one. Do not remove this
// check when HR tables are eventually reviewed for AI access (HR-0's phase
// plan places that no earlier than HR-8, after a dedicated redaction/field-
// filtering layer exists) — extend ALLOWED_TABLES explicitly and narrowly
// at that point instead of relaxing this pattern.
const DENIED_TABLE_PATTERNS: RegExp[] = [/^hr_/i];

function stripLiteralsAndComments(sqlText: string): string {
  let out = '';
  let i = 0;
  const n = sqlText.length;
  while (i < n) {
    const ch = sqlText[i];
    const two = sqlText.slice(i, i + 2);

    if (ch === "'") {
      // SECURITY FIX (extends the block-comment fix above to the same
      // underlying mechanical pattern): a single-quoted string literal is
      // now replaced by a token separator, not deleted outright — same
      // reasoning and same guarantee as the block-comment fix, applied
      // here as defense-in-depth against the scanner's own internal
      // representation ever concatenating two otherwise-separate tokens.
      // The table-access guard must not rely on Postgres itself rejecting
      // malformed adjacency (e.g. `FROM'x'hr_people`, which is very
      // likely invalid table_reference syntax) — the scanner's own
      // sanitized text must never destroy a token boundary regardless of
      // whether the resulting raw SQL would separately be rejected by the
      // database. See the "why this cannot introduce false acceptance"
      // note above ALLOWED_TABLES for the safety argument.
      //
      // ADDITIONAL FIX found while verifying the above: unlike the block-
      // comment and dollar-quote branches, this branch previously had NO
      // unterminated-literal check at all — if the closing quote was
      // never found, the while loop simply exited when `i` reached the
      // end of the string, silently discarding every character from the
      // opening quote to end-of-input (including any real FROM/JOIN text
      // in that span) with no error. Now explicitly fails closed, exactly
      // like the other two branches, rather than silently swallowing the
      // remainder of the query.
      out += ' ';
      i++;
      let closed = false;
      while (i < n) {
        if (sqlText[i] === "'" && sqlText[i + 1] === "'") { i += 2; continue; }
        if (sqlText[i] === "'") { i++; closed = true; break; }
        i++;
      }
      if (!closed) throw new Error('Malformed string literal in query.');
      continue;
    }

    if (two === '--') {
      // The loop below stops AT the newline without consuming it, so the
      // newline itself survives into `out` on the next iteration (via the
      // default character handling below) — a real whitespace character
      // is always preserved as the token separator after a line comment
      // that is followed by more query text. No explicit space needs to
      // be inserted here (unlike the block-comment case just below).
      while (i < n && sqlText[i] !== '\n') i++;
      continue;
    }

    if (two === '/*') {
      const end = sqlText.indexOf('*/', i + 2);
      if (end === -1) throw new Error('Malformed comment in query.');
      const body = sqlText.slice(i + 2, end);
      if (body.includes('/*')) throw new Error('Nested comments are not permitted.');
      // SECURITY FIX: a block comment must be replaced by a token
      // separator, not deleted outright. Postgres treats `/* ... */`
      // as pure whitespace-equivalent trivia — `FROM/* x */hr_people` is
      // valid SQL, identical to `FROM hr_people`. Previously this branch
      // discarded the comment with NO replacement character, so a comment
      // placed with zero surrounding whitespace directly after a keyword
      // (e.g. `FROM/* x */hr_people`) collapsed into a single token
      // (`FROMhr_people`) with no word boundary after "FROM" — invisible
      // to every downstream check (TABLE_REF_RE, the hr_* deny-list, and
      // the comma-join guard all require `\bFROM\b`/`\bJOIN\b` to match).
      // Appending exactly one space guarantees a real word boundary
      // exists between whatever precedes and follows the comment,
      // regardless of whether real whitespace was already present.
      out += ' ';
      i = end + 2;
      continue;
    }

    if (ch === '$') {
      // Dollar-quoted string: $tag$...$tag$ (tag optional, e.g. $$...$$).
      // A lone '$' that doesn't open a valid delimiter (e.g. a stray '$'
      // or a "$1"-style placeholder with no matching closing '$') is not
      // a string open and falls through to the default character handling
      // below, unchanged.
      //
      // SECURITY FIX (extends the block-comment fix above to the same
      // underlying mechanical pattern): a dollar-quoted string is now
      // replaced by a token separator, not deleted outright — same
      // reasoning as the single-quote fix above. See the "why this cannot
      // introduce false acceptance" note above ALLOWED_TABLES.
      const opener = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sqlText.slice(i));
      if (opener) {
        const delim = opener[0];
        const closeIdx = sqlText.indexOf(delim, i + delim.length);
        if (closeIdx === -1) throw new Error('Malformed dollar-quoted string in query.');
        out += ' ';
        i = closeIdx + delim.length;
        continue;
      }
    }

    out += ch;
    i++;
  }
  return out;
}

// Terminators that end a FROM clause's own top-level scope for the purpose
// of comma-join detection below — matched only at depth 0 (i.e. not inside
// a subquery/function-call paren opened after the FROM this walk started
// from). A closing ')' at depth 0, or end of string, also terminates.
const FROM_TOP_LEVEL_TERMINATOR_RE = /^(WHERE|GROUP|HAVING|WINDOW|ORDER|LIMIT|OFFSET|FETCH|UNION|INTERSECT|EXCEPT|FOR)\b/i;

/**
 * Walks forward from just after one `FROM` keyword occurrence (in already
 * literal/comment-stripped text) and returns true if a comma appears at
 * the SAME paren depth as the FROM clause itself, before that clause's own
 * scope ends (a top-level terminator keyword, a closing paren dropping
 * below the starting depth, or end of string). Double-quoted identifiers
 * are skipped atomically so a comma or paren embedded in an unusual quoted
 * identifier can never confuse the depth tracking.
 */
function fromClauseHasTopLevelComma(cleaned: string, startIndex: number): boolean {
  let depth = 0;
  let i = startIndex;
  const n = cleaned.length;

  while (i < n) {
    const ch = cleaned[i];

    if (ch === '"') {
      i++;
      while (i < n) {
        if (cleaned[i] === '"' && cleaned[i + 1] === '"') { i += 2; continue; }
        if (cleaned[i] === '"') { i++; break; }
        i++;
      }
      continue;
    }

    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') {
      if (depth === 0) return false; // this FROM clause's own enclosing scope ends here
      depth--; i++; continue;
    }
    if (depth === 0 && ch === ',') return true;
    if (depth === 0 && ch === ';') return false;

    if (depth === 0 && /[A-Za-z]/.test(ch)) {
      const rest = cleaned.slice(i);
      if (FROM_TOP_LEVEL_TERMINATOR_RE.test(rest)) return false;
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
      i += word ? word[0].length : 1;
      continue;
    }

    i++;
  }
  return false;
}

const FROM_KEYWORD_RE = /\bFROM\b/gi;

/**
 * Rejects any query whose FROM clause contains a top-level, comma-
 * separated relation list — at any nesting depth (top query, subquery, or
 * CTE body) — per the "intentionally narrowed grammar" note above
 * ALLOWED_TABLES. Runs independently of, and in addition to, the
 * FROM/JOIN table-reference extraction below.
 */
function assertNoTopLevelCommaJoins(cleaned: string): void {
  FROM_KEYWORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FROM_KEYWORD_RE.exec(cleaned))) {
    if (fromClauseHasTopLevelComma(cleaned, m.index + m[0].length)) {
      throw new Error('Comma-separated FROM relations (implicit joins) are not permitted — use explicit JOIN syntax.');
    }
  }
}

const CTE_NAME_RE = /\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\([^)]*\))?\s+AS\s*(?:MATERIALIZED\s+|NOT\s+MATERIALIZED\s+)?\(/gi;
const TABLE_REF_RE = /\b(?:FROM|JOIN)\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?)/gi;

function extractCteNames(cleaned: string): Set<string> {
  const names = new Set<string>();
  let m: RegExpExecArray | null;
  CTE_NAME_RE.lastIndex = 0;
  while ((m = CTE_NAME_RE.exec(cleaned))) names.add(m[1].toLowerCase());
  return names;
}

function extractTableRefs(cleaned: string): string[] {
  const refs: string[] = [];
  let m: RegExpExecArray | null;
  TABLE_REF_RE.lastIndex = 0;
  while ((m = TABLE_REF_RE.exec(cleaned))) {
    const segments = m[1].split('.');
    const last = segments[segments.length - 1].replace(/^"|"$/g, '');
    refs.push(last.toLowerCase());
  }
  return refs;
}

/**
 * Validates that every table referenced by `rawSql` (in FROM/JOIN, at any
 * nesting depth, excluding locally-defined CTE names) is in ALLOWED_TABLES.
 * Throws on the first disallowed table found. Exported for direct,
 * DB-independent unit testing (see tests/containment/dataEngineTableAllowlist.test.ts).
 */
export function assertTablesAllowed(rawSql: string): void {
  const cleaned = stripLiteralsAndComments(rawSql);
  assertNoTopLevelCommaJoins(cleaned);
  const cteNames = extractCteNames(cleaned);
  const refs = extractTableRefs(cleaned);

  for (const table of refs) {
    if (cteNames.has(table)) continue; // locally-defined CTE, not a real table

    if (DENIED_TABLE_PATTERNS.some(p => p.test(table))) {
      throw new Error(`Table "${table}" is not accessible through this query engine.`);
    }
    if (!ALLOWED_TABLES.has(table)) {
      throw new Error(`Table "${table}" is not in the approved query allowlist.`);
    }
  }
}

// ─── Query execution ──────────────────────────────────────────────────────────

export type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
};

const ROW_LIMIT = 200;
const FORBIDDEN = /\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|TRUNCATE|EXEC|EXECUTE|GRANT|REVOKE|COPY)\b/i;

export async function executeQuery(rawSql: string, orgId: string): Promise<QueryResult> {
  const clean = rawSql.trim().replace(/;+\s*$/, '');

  if (!/^SELECT\b/i.test(clean))     throw new Error('Only SELECT queries are permitted.');
  if (FORBIDDEN.test(clean))          throw new Error('Write operations are not permitted.');
  if (/;/.test(clean))                throw new Error('Multi-statement queries are not permitted.');
  if (!/organisation_id/i.test(clean)) throw new Error('Query must filter by organisation_id.');
  if (!clean.includes(orgId))         throw new Error('Query must reference the correct organisation ID.');
  assertTablesAllowed(clean);

  // Inject row cap unless already present
  const limited = /\bLIMIT\b/i.test(clean) ? clean : `${clean} LIMIT ${ROW_LIMIT}`;

  // Execute — build a zero-interpolation TemplateStringsArray and call the neon tag
  const tpl = Object.assign([limited], { raw: [limited] }) as unknown as TemplateStringsArray;
  const rows = (await sql(tpl)) as unknown as Record<string, unknown>[];

  return { rows, rowCount: rows.length, truncated: rows.length === ROW_LIMIT };
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export type TrendResult = {
  direction: 'increasing' | 'decreasing' | 'stable';
  changePct: string;
  first: number;
  last: number;
  peak: number;
  peakLabel: string;
};

export function detectTrend(
  rows: Record<string, unknown>[],
  valueKey: string,
  labelKey: string,
): TrendResult | null {
  if (rows.length < 2) return null;
  const values = rows.map(r => Number(r[valueKey]) || 0);
  const labels = rows.map(r => String(r[labelKey] ?? ''));
  const first = values[0], last = values[values.length - 1];
  const changePct = first > 0 ? (((last - first) / first) * 100).toFixed(1) : '0';
  const direction = Number(changePct) > 5 ? 'increasing' : Number(changePct) < -5 ? 'decreasing' : 'stable';
  const peak = Math.max(...values);
  const peakLabel = labels[values.indexOf(peak)];
  return { direction, changePct, first, last, peak, peakLabel };
}

export type AnomalyResult = { label: string; value: number; zScore: number; direction: 'high' | 'low' };

export function findAnomalies(
  rows: Record<string, unknown>[],
  valueKey: string,
  labelKey: string,
): AnomalyResult[] {
  if (rows.length < 4) return [];
  const values = rows.map(r => Number(r[valueKey]) || 0);
  const labels = rows.map(r => String(r[labelKey] ?? ''));
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const std  = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  if (std === 0) return [];
  return values
    .map((v, i) => ({ label: labels[i], value: v, zScore: (v - mean) / std, direction: v > mean ? 'high' as const : 'low' as const }))
    .filter(r => Math.abs(r.zScore) > 1.5)
    .sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// ─── Formatting for Claude ────────────────────────────────────────────────────

export function formatQueryResult(result: QueryResult): string {
  if (result.rowCount === 0) return 'Query returned no rows.';

  const rows = result.rows;
  const cols = Object.keys(rows[0]);

  // Build a compact table
  const header = cols.join(' | ');
  const body   = rows
    .slice(0, 50)
    .map(r => cols.map(c => {
      const v = r[c];
      if (v == null) return '—';
      if (typeof v === 'number' || (!isNaN(Number(v)) && v !== '')) {
        return Number(v).toLocaleString('en-AU', { maximumFractionDigits: 2 });
      }
      return String(v);
    }).join(' | '))
    .join('\n');

  const tableStr = `${header}\n${'-'.repeat(header.length)}\n${body}`;
  const suffix   = result.truncated ? `\n(showing first ${ROW_LIMIT} rows)` : `\n(${result.rowCount} rows)`;

  // Attempt analytics on first numeric col vs first text col
  const numCol  = cols.find(c => rows.some(r => r[c] != null && !isNaN(Number(r[c]))));
  const textCol = cols.find(c => rows.some(r => r[c] != null && isNaN(Number(r[c]))));
  const insights: string[] = [];

  if (numCol && textCol) {
    const trend = detectTrend(rows, numCol, textCol);
    if (trend && trend.direction !== 'stable') {
      insights.push(`TREND: ${numCol} is ${trend.direction} — changed ${trend.changePct}% from ${trend.first.toLocaleString('en-AU')} to ${trend.last.toLocaleString('en-AU')}. Peak: ${trend.peak.toLocaleString('en-AU')} at ${trend.peakLabel}.`);
    }

    const anomalies = findAnomalies(rows, numCol, textCol);
    for (const a of anomalies.slice(0, 3)) {
      insights.push(`ANOMALY: ${a.label} has ${a.direction === 'high' ? 'unusually high' : 'unusually low'} ${numCol} (${a.value.toLocaleString('en-AU')}, z=${a.zScore.toFixed(1)}).`);
    }
  }

  // Basic stats for numeric cols
  for (const col of cols.filter(c => rows.every(r => r[c] == null || !isNaN(Number(r[c])))).slice(0, 3)) {
    const vals = rows.map(r => Number(r[col]) || 0).filter(v => v !== 0);
    if (vals.length < 2) continue;
    const sum = vals.reduce((s, v) => s + v, 0);
    const avg = sum / vals.length;
    insights.push(`STATS ${col}: total=${sum.toLocaleString('en-AU', { maximumFractionDigits: 0 })}, avg=${avg.toLocaleString('en-AU', { maximumFractionDigits: 1 })}, max=${Math.max(...vals).toLocaleString('en-AU', { maximumFractionDigits: 0 })}, min=${Math.min(...vals).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`);
  }

  const analyticsStr = insights.length ? `\n\nANALYTICS:\n${insights.join('\n')}` : '';

  return `${tableStr}${suffix}${analyticsStr}`;
}
