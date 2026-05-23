/**
 * test-apis.ts — Hit all KPI endpoints on the local dev server.
 *
 * Requires the Next.js dev server to be running at http://localhost:3000.
 * Pass a session cookie if the endpoints require auth:
 *   SESSION_COOKIE="next-auth.session-token=<value>" npx ts-node ... scripts/test-apis.ts
 *
 * Run:
 *   npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' \
 *   --transpile-only scripts/test-apis.ts
 */

const BASE    = process.env.BASE_URL ?? 'http://localhost:3000';
const COOKIE  = process.env.SESSION_COOKIE ?? '';
const FY      = '2025-26';
const TARGET_ORG = '0c0397b1-a9a6-4ae5-86f5-283aeb502e73';
const LINE    = '═'.repeat(60);
const LINE_SM = '─'.repeat(60);

// ── Fetch helper ──────────────────────────────────────────────

async function hit(path: string): Promise<{
  status:  number;
  ok:      boolean;
  body:    unknown;
  elapsed: number;
}> {
  const url     = `${BASE}${path}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (COOKIE) headers['Cookie'] = COOKIE;

  const t0 = Date.now();
  let response: Response;
  try {
    response = await fetch(url, { headers, redirect: 'follow' });
  } catch (e) {
    return { status: 0, ok: false, body: { error: `Network error: ${(e as Error).message}` }, elapsed: Date.now() - t0 };
  }

  const elapsed = Date.now() - t0;
  let body: unknown;
  try { body = await response.json(); }
  catch { body = await response.text().catch(() => '(no body)'); }

  return { status: response.status, ok: response.ok, body, elapsed };
}

// ── Pretty-print helpers ──────────────────────────────────────

function countKeys(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  return Object.keys(obj as object).length;
}

function dataIsEmpty(data: unknown): boolean {
  if (data === null || data === undefined) return true;
  if (typeof data === 'object') {
    return Object.values(data as Record<string, unknown>).every(v => {
      if (Array.isArray(v)) return v.length === 0;
      if (typeof v === 'number') return v === 0;
      return false;
    });
  }
  return false;
}

function statusIcon(status: number, ok: boolean): string {
  if (status === 0)   return '🔴';
  if (status === 401) return '🔒';
  if (!ok)            return '❌';
  return '✅';
}

function summarise(body: unknown): string {
  if (!body || typeof body !== 'object') return String(body).slice(0, 120);
  const b = body as Record<string, unknown>;
  const data = b['data'] as Record<string, unknown> | undefined;
  if (!data) return JSON.stringify(b).slice(0, 200);

  const parts: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v))         parts.push(`${k}: [${v.length}]`);
    else if (typeof v === 'number') parts.push(`${k}: ${v}`);
    else if (v !== null && v !== undefined) parts.push(`${k}: "${String(v).slice(0, 30)}"`);
  }
  return `{ ${parts.join(', ')} }`;
}

// ── Tests ─────────────────────────────────────────────────────

const ENDPOINTS: { label: string; path: string }[] = [
  { label: '/api/me',                     path: '/api/me'                                    },
  { label: '/api/debtors/kpi',            path: `/api/debtors/kpi?fy=${FY}`                 },
  { label: '/api/waste/kpi',              path: `/api/waste/kpi?fy=${FY}`                   },
  { label: '/api/missed-collections/kpi', path: `/api/missed-collections/kpi?fy=${FY}`      },
  { label: '/api/illegal-dumping/kpi',    path: `/api/illegal-dumping/kpi?fy=${FY}`         },
  { label: '/api/sports/kpi',             path: `/api/sports/kpi?fy=${FY}`                  },
  { label: '/api/financial/kpi',          path: `/api/financial/kpi?fy=${FY}`               },
  { label: '/api/bin-maintenance/kpi',    path: `/api/bin-maintenance/kpi?fy=${FY}`         },
];

type Result = {
  label:   string;
  status:  number;
  ok:      boolean;
  elapsed: number;
  empty:   boolean;
  summary: string;
  body:    unknown;
};

async function main() {
  console.log(`\n${LINE}`);
  console.log('API ENDPOINT TEST');
  console.log(`${LINE}`);
  console.log(`  Base URL   : ${BASE}`);
  console.log(`  Target Org : ${TARGET_ORG}`);
  console.log(`  Auth cookie: ${COOKIE ? 'provided ✅' : 'none ⚠️  (endpoints may return 401)'}`);
  console.log(`${LINE}\n`);

  const results: Result[] = [];

  for (const { label, path } of ENDPOINTS) {
    process.stdout.write(`  Testing ${label.padEnd(34)} `);
    const { status, ok, body, elapsed } = await hit(path);
    const data  = (body as Record<string, unknown>)?.['data'];
    const empty = dataIsEmpty(data);
    const icon  = statusIcon(status, ok);
    const sum   = summarise(body);
    console.log(`${icon}  ${status}  ${elapsed}ms`);

    results.push({ label, status, ok, elapsed, empty, summary: sum, body });
  }

  // ── /api/me — org UUID check ──────────────────────────────────

  console.log(`\n${LINE_SM}`);
  console.log('SESSION / ORG CHECK');
  console.log(`${LINE_SM}`);

  const meResult = results.find(r => r.label === '/api/me');
  if (meResult && meResult.ok) {
    const me = meResult.body as Record<string, unknown>;
    const orgId = (me['organisationId'] ?? me['org_id'] ?? me['orgId'] ?? '(not found)') as string;
    const match = orgId === TARGET_ORG;
    console.log(`  Session org UUID : ${orgId}`);
    console.log(`  Expected         : ${TARGET_ORG}`);
    console.log(`  Match            : ${match ? '✅ YES' : '❌ NO — data will appear empty on the dashboard'}`);
  } else if (meResult?.status === 401) {
    console.log('  ⚠️  /api/me returned 401 — no active session.');
    console.log('  Provide SESSION_COOKIE env var to test authenticated endpoints.');
  } else {
    console.log('  ⚠️  /api/me did not respond — is the dev server running?');
  }

  // ── Full response dump ────────────────────────────────────────

  console.log(`\n${LINE_SM}`);
  console.log('FULL RESPONSE DETAIL');
  console.log(`${LINE_SM}\n`);

  for (const r of results) {
    const icon = statusIcon(r.status, r.ok);
    console.log(`${icon}  GET ${r.label}  →  ${r.status || 'NETWORK ERROR'}  (${r.elapsed}ms)`);
    if (r.ok) {
      const empty = r.empty ? '  ⚠️  data fields are all zero/empty' : '';
      console.log(`   Data : ${r.summary}${empty}`);
    } else {
      console.log(`   Error: ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    console.log('');
  }

  // ── Summary table ─────────────────────────────────────────────

  console.log(`${LINE}`);
  console.log('SUMMARY');
  console.log(`${LINE}\n`);

  const withData  = results.filter(r => r.ok && !r.empty && r.label !== '/api/me');
  const noData    = results.filter(r => r.ok && r.empty  && r.label !== '/api/me');
  const errored   = results.filter(r => !r.ok);

  if (withData.length) {
    console.log('✅  Endpoints returning live data:');
    withData.forEach(r => console.log(`     ${r.label}`));
  }
  if (noData.length) {
    console.log('\n⚠️   Endpoints returning empty data (org mismatch or no rows):');
    noData.forEach(r => console.log(`     ${r.label}`));
  }
  if (errored.length) {
    console.log('\n❌  Endpoints with errors:');
    errored.forEach(r => console.log(`     ${r.label}  →  ${r.status || 'network error'}`));
  }

  const allAuth = results.every(r => r.status !== 401);
  if (!allAuth) {
    console.log('\n🔒  One or more endpoints returned 401. Re-run with:');
    console.log('    SESSION_COOKIE="next-auth.session-token=<value>" npx ts-node ...');
    console.log('    (Copy the cookie value from browser DevTools → Application → Cookies)');
  }

  console.log(`\n${LINE}\n`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
