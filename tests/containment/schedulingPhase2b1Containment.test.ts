import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// These checks walk the whole source tree; on a loaded machine (the full parallel run) 5 s is not enough.
vi.setConfig({ testTimeout: 60_000 });

// Phase 2B.1 puts the first Scheduling routes in the application. This file makes a bypass of the central access guard a
// build failure, and keeps the phase from growing beyond the foundation: no customer booking operation, no public
// booking, no payment, no settings writer, no navigation entry.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');
const noTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:'"`])\/\/.*$/gm, '$1');

function walk(dir: string, exts: RegExp, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, exts, out);
    else if (exts.test(name)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const FORBIDDEN_IMPORTS = [
  '@/lib/db',
  '@/lib/org',
  '@/lib/session',
  'next/headers',
  '@scheduling/postgres',
  '@/lib/capabilities/requireCapability',
  '@/lib/scheduling/access',
  '@/lib/scheduling/runtime',
  '@/lib/scheduling/crmLink',
];

/** Everything a Scheduling route file must satisfy. Returns the problems found (empty = compliant). */
function routeProblems(source: string): string[] {
  const src = noTsComments(source);
  const problems: string[] = [];
  const exported = [...src.matchAll(/export\s+(?:async\s+)?(?:const|function|let|var)\s+(\w+)/g)].map(m => m[1]);
  const methods = exported.filter(n => HTTP_METHODS.includes(n));
  if (methods.length === 0) problems.push('exports no HTTP method');
  for (const m of methods) {
    if (!new RegExp(`export\\s+const\\s+${m}\\s*=\\s*schedulingRoute\\(`).test(src)) problems.push(`${m} is not created with schedulingRoute(...)`);
  }
  if (/export\s*\{[^}]*\b(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/.test(src) || /export\s+default\b/.test(src)) problems.push('re-exports or default-exports a handler outside schedulingRoute');
  if (!/export\s+const\s+dynamic\s*=\s*'force-dynamic'/.test(src)) problems.push("does not export dynamic = 'force-dynamic'");
  if (!/from\s+'@\/lib\/scheduling\/route'/.test(src)) problems.push('does not import the central guard');
  for (const f of FORBIDDEN_IMPORTS) {
    if (new RegExp(`from\\s+['"]${f.replace(/[/@]/g, '\\$&')}['"]`).test(src)) problems.push(`imports ${f}`);
  }
  if (/\b(requireSession|requireRole|getSession|cookies\(\)|headers\(\))/.test(src)) problems.push('reads the session or request headers itself');
  // The organisation is never an input. A route may only use the guard's tenant; any other mention of an organisation id is a defect.
  const withoutTenant = src.replace(/\btenant\.organisationId\b/g, '');
  if (/organi[sz]ation_?id|organi[sz]ationSlug|org_?id/i.test(withoutTenant)) problems.push('mentions an organisation id outside the guard tenant');
  if (/\b(sql|neon)\b\s*[`(]/.test(src)) problems.push('queries the database directly');
  if (/\b(stripe|payment|checkout|public_?slug|publicTenantContext)\b/i.test(src)) problems.push('touches payments or public booking');
  return problems;
}

const routeFiles = () => walk(path.join(ROOT, 'app/api/scheduling'), /^route\.ts$/);

describe('every Scheduling API route goes through the central access guard', () => {
  it('the two foundation routes are present (the full route set is pinned by schedulingPhase2b2bContainment.test.ts)', () => {
    expect(routeFiles().map(rel)).toEqual(expect.arrayContaining(['app/api/scheduling/audit/route.ts', 'app/api/scheduling/status/route.ts']));
  });

  it('every route file is compliant', () => {
    for (const f of routeFiles()) expect(routeProblems(readFileSync(f, 'utf8')), rel(f)).toEqual([]);
  });

  it('the checker itself catches bypasses (a sample of each defect is reported)', () => {
    const good = "import { schedulingRoute, schedulingJson } from '@/lib/scheduling/route';\nexport const dynamic = 'force-dynamic';\nexport const GET = schedulingRoute('scheduling.view', () => schedulingJson({}));";
    expect(routeProblems(good)).toEqual([]);

    const plainFunction = good.replace("export const GET = schedulingRoute('scheduling.view', () => schedulingJson({}));", 'export async function GET() { return Response.json({}); }');
    expect(routeProblems(plainFunction).join()).toMatch(/not created with schedulingRoute/);

    const ownSession = "import { requireSession } from '@/lib/org';\n" + good;
    expect(routeProblems(ownSession).join()).toMatch(/imports @\/lib\/org/);

    const directAccess = "import { authorizeSchedulingRequest } from '@/lib/scheduling/access';\n" + good;
    expect(routeProblems(directAccess).join()).toMatch(/imports @\/lib\/scheduling\/access/);

    const direct = good.replace("() => schedulingJson({})", "async () => { const r = await sql`SELECT 1`; return schedulingJson(r); }");
    expect(routeProblems(direct).join()).toMatch(/queries the database/);

    const orgFromRequest = good.replace("() => schedulingJson({})", "({ request }) => schedulingJson({ o: new URL(request.url).searchParams.get('organisation_id') })");
    expect(routeProblems(orgFromRequest).join()).toMatch(/organisation id outside the guard tenant/);

    const noDynamic = good.replace("export const dynamic = 'force-dynamic';\n", '');
    expect(routeProblems(noDynamic).join()).toMatch(/force-dynamic/);

    const reexport = good + '\nconst h = async () => new Response(); export { h as POST };';
    expect(routeProblems(reexport).join()).toMatch(/re-exports/);

    const postUnguarded = good + '\nexport const POST = async () => Response.json({});';
    expect(routeProblems(postUnguarded).join()).toMatch(/POST is not created with schedulingRoute/);

    const payments = good.replace("() => schedulingJson({})", "() => schedulingJson({ checkout: 1 })");
    expect(routeProblems(payments).join()).toMatch(/payments or public booking/);

    expect(routeProblems('export const dynamic = \'force-dynamic\';').join()).toMatch(/exports no HTTP method/);
  });
});

describe('the guard itself', () => {
  const guard = noTsComments(read('lib/scheduling/route.ts'));

  it('authorises first, then builds the runtime, then calls the handler, in that order', () => {
    const a = guard.indexOf('await authorizeSchedulingRequest(permission)');
    const r = guard.indexOf('await loadSchedulingRuntime(');
    const h = guard.indexOf('await handler(');
    expect(a).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(a);
    expect(h).toBeGreaterThan(r);
  });

  it('returns the denial before reaching the runtime, and never calls the handler on a denial', () => {
    expect(guard).toMatch(/if \(!auth\.ok\) return finish\(withNoStore\(auth\.response\), 'denied'\);/); // 2B.3e: the same early return, now also logged (route family only, no path, no identity)
    expect(guard).toMatch(/Cache-Control['"], ['"]no-store/);
  });

  it('maps configuration, runtime and handler failures to closed responses with no internal detail', () => {
    expect(guard).toMatch(/SchedulingConfigurationError/);
    expect(guard).toMatch(/status: 503/);
    expect(guard).toMatch(/status: 500/);
    expect(guard).not.toMatch(/err\.message|\.stack|String\(err\)/);
  });

  it('is the only importer of the access gate and the runtime outside lib/scheduling and tests', () => {
    const sources = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib'].flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mts)$/)).concat([path.join(ROOT, 'middleware.ts')]);
    const importers = (re: RegExp, relative?: RegExp) =>
      sources.filter(f => re.test(readFileSync(f, 'utf8')) || (relative !== undefined && rel(f).startsWith('lib/scheduling/') && relative.test(readFileSync(f, 'utf8')))).map(rel).sort();
    expect(importers(/lib\/scheduling\/access['"]/, /from ['"]\.\/access['"]/)).toEqual(['lib/scheduling/route.ts']);
    expect(importers(/lib\/scheduling\/runtime['"]/, /from ['"]\.\/runtime['"]/)).toEqual(['lib/scheduling/route.ts']);
    expect(importers(/@scheduling\/postgres/)).toEqual(['lib/scheduling/runtime.ts']);
  });
});

describe('settings are explicit: no application code creates or edits them', () => {
  const appSources = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib'].flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mts)$/));

  it('nothing in the application calls saveSettings or names the settings table', () => {
    const offenders = appSources.filter(f => /saveSettings|scheduling_settings/.test(noTsComments(readFileSync(f, 'utf8')))).map(rel);
    expect(offenders).toEqual([]);
  });

  it('the runtime and the guard contain no write statement', () => {
    for (const f of ['lib/scheduling/runtime.ts', 'lib/scheduling/route.ts']) {
      expect(noTsComments(read(f)), f).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+)/i);
    }
  });

  it('the runtime reads settings only through the repository and organisations.timezone with one SELECT', () => {
    // 2B.3e follow-up: the organisation-timezone lookup moved to its own module (the page gate reads the zone without importing the runtime). The pin still holds over both
    // files together: the settings go through the repository, and the only SQL in either is the one SELECT of organisations.timezone.
    const rt = noTsComments(read('lib/scheduling/runtime.ts'));
    const tz = noTsComments(read('lib/scheduling/organisationTimezone.ts'));
    expect(rt).toMatch(/persistence\.config\.getSettings\(/);
    expect([...(rt + tz).matchAll(/sql`([^`]*)`/g)].map(m => m[1].replace(/\s+/g, ' ').trim())).toEqual(['SELECT timezone FROM organisations WHERE id = ${organisationId} LIMIT 1']);
    expect(tz).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+)/i);
  });
});

describe('audit: one writer, one namespace, nothing identifying in the general fields', () => {
  const audit = noTsComments(read('lib/scheduling/audit.ts'));

  it('inserts only into audit_logs and reads only from it', () => {
    expect([...audit.matchAll(/INSERT\s+INTO\s+(\w+)/gi)].map(m => m[1])).toEqual(['audit_logs']);
    expect([...audit.matchAll(/\bFROM\s+(\w+)/gi)].map(m => m[1]).filter(t => t !== 'audit_logs')).toEqual([]);
    expect(audit).not.toMatch(/\b(UPDATE|DELETE\s+FROM|DROP|ALTER|TRUNCATE)\b/i);
  });

  it('is the only module that writes scheduling.* actions', () => {
    const sources = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib'].flatMap(d => walk(path.join(ROOT, d), /\.(ts|tsx|mts)$/));
    const writers = sources.filter(f => /INSERT\s+INTO\s+audit_logs/i.test(readFileSync(f, 'utf8')) && /['"`]scheduling\./.test(readFileSync(f, 'utf8'))).map(rel);
    expect(writers).toEqual(['lib/scheduling/audit.ts']);
  });

  it('strips identity at read time by permission, and never returns the raw after_state', () => {
    expect(audit).toMatch(/tenant\.can\('scheduling\.audit\.identity'\)/);
    expect(audit).toMatch(/canSeeIdentity && state\.identity/);
    expect(audit).not.toMatch(/after_state:\s*row\.after_state|\.\.\.row\b/);
  });

  it('identity-bearing audit detail is granted to exactly manager, admin and super_admin', async () => {
    const { permissionsForRole } = await import('@/lib/scheduling/adapters/brainbase');
    for (const role of ['manager', 'admin', 'super_admin']) expect(permissionsForRole(role)).toContain('scheduling.audit.identity');
    for (const role of ['viewer', 'analyst', 'guest', '']) expect(permissionsForRole(role)).not.toContain('scheduling.audit.identity');
  });
});

describe('the phase stays a foundation', () => {
  it('no page, cron, navigation entry, public booking or payment appears', () => {
    for (const p of ['app/dashboard/scheduling', 'app/book', 'app/api/cron/scheduling-top-up', 'app/api/scheduling/public']) expect(existsSync(path.join(ROOT, p)), p).toBe(false);
    // Phase 2B.2c (deliberate, reviewed change): one capability-gated navigation entry exists; schedulingPhase2b2cContainment.test.ts pins it.
    expect((read('components/nav/navModel.ts').match(/scheduling/gi) ?? []).length).toBeGreaterThan(0);
    expect(read('vercel.json')).not.toMatch(/scheduling/i);
  });

  it('the new runtime files mention no payment provider and no LD Tennis table', () => {
    for (const f of ['lib/scheduling/runtime.ts', 'lib/scheduling/route.ts', 'lib/scheduling/audit.ts']) {
      expect(noTsComments(read(f)), f).not.toMatch(/stripe|payment_intent|checkout|\bcontacts\b|tennis/i);
    }
  });

  it('no LD Tennis or CRM file mentions the scheduling runtime, guard or audit', () => {
    const files = ['app/api/tennis/book/route.ts', 'app/api/tennis/cancel/route.ts', 'app/api/dashboard/enrolments/route.ts', 'app/api/dashboard/sessions/route.ts', 'app/api/bookings/route.ts', 'lib/tennisRecurrence.ts', 'lib/tennisSchedule.ts', 'app/api/crm/contacts/route.ts'];
    for (const f of files) if (existsSync(path.join(ROOT, f))) expect(read(f), f).not.toMatch(/lib\/scheduling|@scheduling\//);
  });

  it('the shared core still imports no host module (adding a permission added no dependency)', () => {
    for (const f of walk(path.join(ROOT, 'packages/scheduling/src'), /\.ts$/)) {
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/from\s+['"](@\/|\.\.\/\.\.\/|next|react|pg|@neondatabase)/);
    }
  });
});
