/**
 * test-apis-with-jwt.ts
 *
 * Run:
 *   JWT_TOKEN="eyJ..." npx ts-node --skipProject \
 *   --compilerOptions '{"module":"commonjs","esModuleInterop":true}' \
 *   --transpile-only scripts/test-apis-with-jwt.ts
 */

const BASE  = process.env.BASE_URL ?? 'http://localhost:3000';
const TOKEN = process.env.JWT_TOKEN ?? '';
const FY    = '2025-26';
const LINE  = '═'.repeat(62);
const LINE2 = '─'.repeat(62);

if (!TOKEN) { console.error('❌ JWT_TOKEN not set'); process.exit(1); }

const ENDPOINTS = [
  '/api/debtors/kpi',
  '/api/waste/kpi',
  '/api/missed-collections/kpi',
  '/api/illegal-dumping/kpi',
  '/api/sports/kpi',
  '/api/financial/kpi',
  '/api/bin-maintenance/kpi',
];

async function hit(path: string) {
  const url = `${BASE}${path}?fy=${FY}`;
  const t0  = Date.now();
  try {
    // The app reads from cookie "session", not Authorization header
    const res  = await fetch(url, { headers: { Cookie: `session=${TOKEN}` } });
    const text = await res.text();
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { body = { _raw: text.slice(0, 500) }; }
    return { status: res.status, ok: res.ok, body, elapsed: Date.now() - t0 };
  } catch (e) {
    return { status: 0, ok: false, body: { error: String(e) }, elapsed: Date.now() - t0 };
  }
}

function countRows(data: unknown): number | null {
  if (!data || typeof data !== 'object') return null;
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(v) && v.length > 0) return v.length;
  }
  return null;
}

function isAllZero(data: unknown): boolean {
  if (!data || typeof data !== 'object') return true;
  return Object.values(data as Record<string, unknown>).every(v =>
    v === 0 || v === null || (Array.isArray(v) && v.length === 0)
  );
}

async function main() {
  console.log(`\n${LINE}`);
  console.log('API TEST — JWT Auth');
  console.log(`${LINE}`);
  console.log(`  Base : ${BASE}`);
  console.log(`  Token: …${TOKEN.slice(-20)}`);
  console.log(`${LINE}\n`);

  type Result = { path: string; status: number; ok: boolean; elapsed: number; body: unknown };
  const results: Result[] = [];

  for (const path of ENDPOINTS) {
    process.stdout.write(`  GET ${path.padEnd(32)} `);
    const r = await hit(path);
    const icon = r.status === 0 ? '🔴' : !r.ok ? '❌' : '✅';
    console.log(`${icon}  ${r.status}  ${r.elapsed}ms`);
    results.push({ path, ...r });
  }

  console.log(`\n${LINE2}`);
  console.log('FULL RESPONSES');
  console.log(`${LINE2}\n`);

  for (const r of results) {
    const icon = r.status === 0 ? '🔴' : !r.ok ? '❌' : '✅';
    console.log(`${icon}  GET ${r.path}?fy=${FY}  →  ${r.status || 'ERR'}  (${r.elapsed}ms)`);

    if (r.ok) {
      const body = r.body as Record<string, unknown>;
      const data = body?.data;
      console.log(JSON.stringify(body, null, 2)
        .split('\n')
        .map(l => `   ${l}`)
        .join('\n'));
      const rowCount = countRows(data);
      const empty    = isAllZero(data);
      if (rowCount !== null) console.log(`   → Array has ${rowCount} items`);
      if (empty)             console.log(`   ⚠️  All values are 0 / empty — no data for this org`);
    } else {
      console.log(`   Error: ${JSON.stringify(r.body)}`);
    }
    console.log('');
  }

  console.log(`${LINE}`);
  console.log('REPORT');
  console.log(`${LINE}\n`);

  const withData = results.filter(r => r.ok && !isAllZero((r.body as Record<string, unknown>)?.data));
  const empty    = results.filter(r => r.ok &&  isAllZero((r.body as Record<string, unknown>)?.data));
  const errored  = results.filter(r => !r.ok);

  if (withData.length) {
    console.log('✅  Has live data:');
    for (const r of withData) {
      const data     = (r.body as Record<string, unknown>)?.data;
      const rowCount = countRows(data);
      const suffix   = rowCount !== null ? `  (${rowCount} array rows)` : '';
      console.log(`     ${r.path}${suffix}`);
    }
  }
  if (empty.length) {
    console.log('\n⚠️   Empty (org mismatch or no rows ingested):');
    empty.forEach(r => console.log(`     ${r.path}`));
  }
  if (errored.length) {
    console.log('\n❌  Errors:');
    errored.forEach(r => console.log(`     ${r.path}  →  ${r.status || 'network error'}`));
  }

  console.log(`\n${LINE}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
