import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

// These checks walk the source tree; on a loaded machine (the full parallel run) 5 s is not enough.
vi.setConfig({ testTimeout: 60_000 });

// Phase 2B.2b adds the Scheduling CONFIGURATION API. This file pins its shape so it cannot drift into booking, payments or a
// bypass of the central guard: the exact route set and the permission of every method, no route outside schedulingRoute, no
// database or session access in the handlers, an audit call after every mutation, and the explicit preset scope.

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

type Perm = 'scheduling.view' | 'scheduling.manage';
/** route file -> [METHOD, permission, handler] for each exported method ('' = an inline foundation handler). */
const EXPECTED_ROUTES: Record<string, Array<[string, Perm, string]>> = {
  'app/api/scheduling/audit/route.ts': [['GET', 'scheduling.view', '']],
  'app/api/scheduling/status/route.ts': [['GET', 'scheduling.view', '']],
  'app/api/scheduling/schedules/route.ts': [['GET', 'scheduling.view', 'listSchedules'], ['POST', 'scheduling.manage', 'createSchedule']],
  'app/api/scheduling/schedules/[scheduleId]/route.ts': [['GET', 'scheduling.view', 'getSchedule'], ['PATCH', 'scheduling.manage', 'updateSchedule']],
  'app/api/scheduling/schedules/[scheduleId]/archive/route.ts': [['POST', 'scheduling.manage', 'archiveSchedule']],
  'app/api/scheduling/schedules/[scheduleId]/offerings/route.ts': [['GET', 'scheduling.view', 'listOfferings'], ['POST', 'scheduling.manage', 'createOffering']],
  'app/api/scheduling/offerings/[offeringId]/route.ts': [['GET', 'scheduling.view', 'getOffering'], ['PATCH', 'scheduling.manage', 'updateOffering']],
  'app/api/scheduling/offerings/[offeringId]/archive/route.ts': [['POST', 'scheduling.manage', 'archiveOffering']],
  'app/api/scheduling/offerings/[offeringId]/resources/route.ts': [['GET', 'scheduling.view', 'listOfferingResources'], ['POST', 'scheduling.manage', 'linkResource']],
  'app/api/scheduling/offerings/[offeringId]/resources/[resourceId]/route.ts': [['DELETE', 'scheduling.manage', 'unlinkResource']],
  'app/api/scheduling/resources/route.ts': [['GET', 'scheduling.view', 'listResources'], ['POST', 'scheduling.manage', 'createResource']],
  'app/api/scheduling/resources/[resourceId]/route.ts': [['GET', 'scheduling.view', 'getResource'], ['PATCH', 'scheduling.manage', 'updateResource']],
  'app/api/scheduling/resources/[resourceId]/deactivate/route.ts': [['POST', 'scheduling.manage', 'deactivateResource']],
  'app/api/scheduling/resources/[resourceId]/reactivate/route.ts': [['POST', 'scheduling.manage', 'reactivateResource']],
  // Phase 2B.3b (deliberate, reviewed change): the availability API (weekly rules and closures of an offering or a resource).
  'app/api/scheduling/offerings/[offeringId]/availability/route.ts': [['GET', 'scheduling.view', 'listAvailabilityFor']],
  'app/api/scheduling/offerings/[offeringId]/availability-rules/route.ts': [['POST', 'scheduling.manage', 'createRuleFor']],
  'app/api/scheduling/offerings/[offeringId]/availability-exceptions/route.ts': [['POST', 'scheduling.manage', 'createExceptionFor']],
  'app/api/scheduling/resources/[resourceId]/availability/route.ts': [['GET', 'scheduling.view', 'listAvailabilityFor']],
  'app/api/scheduling/resources/[resourceId]/availability-rules/route.ts': [['POST', 'scheduling.manage', 'createRuleFor']],
  'app/api/scheduling/resources/[resourceId]/availability-exceptions/route.ts': [['POST', 'scheduling.manage', 'createExceptionFor']],
  'app/api/scheduling/availability-rules/[ruleId]/route.ts': [['PATCH', 'scheduling.manage', 'updateRule'], ['DELETE', 'scheduling.manage', 'deleteRule']],
  'app/api/scheduling/availability-rules/remove-overnight/route.ts': [['POST', 'scheduling.manage', 'removeOvernightWindow']],
  'app/api/scheduling/availability-exceptions/[exceptionId]/route.ts': [['PATCH', 'scheduling.manage', 'updateException'], ['DELETE', 'scheduling.manage', 'deleteException']],
};

const routeFiles = () => walk(path.join(ROOT, 'app/api/scheduling'), /^route\.ts$/).map(rel).sort();
const CONFIG_LIBS = ['http', 'schedules', 'offerings', 'resources', 'links', 'availability'].map(n => `lib/scheduling/config/${n}.ts`);

describe('the route set is exactly the configuration API: no booking, public or payment route', () => {
  it('pins every route file', () => {
    expect(routeFiles()).toEqual(Object.keys(EXPECTED_ROUTES).sort());
  });

  it('every method is created with schedulingRoute(<permission>, ...): reads need scheduling.view, every write scheduling.manage', () => {
    for (const [file, methods] of Object.entries(EXPECTED_ROUTES)) {
      const src = noTsComments(read(file));
      const exported = [...src.matchAll(/export\s+const\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*=\s*schedulingRoute\(\s*'([^']+)'\s*,\s*(\w*)/g)].map(m => ({ method: m[1], permission: m[2], handler: m[3] }));
      expect(exported.map(e => `${e.method} ${e.permission}`).sort(), file).toEqual(methods.map(m => `${m[0]} ${m[1]}`).sort());
      for (const [method, , handler] of methods) if (handler) expect(exported.find(e => e.method === method)?.handler, `${file} ${method}`).toBe(handler);
      expect(src, file).toMatch(/export const dynamic = 'force-dynamic'/);
      for (const m of methods) if (m[0] !== 'GET') expect(m[1], `${file} ${m[0]}`).toBe('scheduling.manage');
    }
  });

  it('no route accepts PUT/HEAD/OPTIONS, and no route path names booking, payment, checkout or public access', () => {
    for (const f of routeFiles()) {
      expect(f, f).not.toMatch(/book|payment|checkout|public|stripe|reservation|occurrence|customer|attendance/i);
      expect(noTsComments(read(f)), f).not.toMatch(/export\s+const\s+(PUT|HEAD|OPTIONS)\b/);
    }
  });
});

describe('handlers stay inside the guard', () => {
  it('the configuration modules import no database, session, capability, access gate, runtime or Postgres package', () => {
    for (const f of CONFIG_LIBS) {
      const src = noTsComments(read(f));
      for (const forbidden of ['@/lib/db', '@/lib/org', '@/lib/session', 'next/headers', '@scheduling/postgres', '@/lib/capabilities', 'lib/scheduling/access', 'lib/scheduling/runtime', "/access'", "/runtime'"]) {
        expect(src, `${f} imports ${forbidden}`).not.toContain(forbidden);
      }
      expect(src, f).not.toMatch(/\b(sql|neon)\b\s*[`(]/);
      expect(src, f).not.toMatch(/\b(SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/);
      expect(src, f).not.toMatch(/scheduling_[a-z_]+/);
      expect(src, f).not.toMatch(/requireSession|requireRole|getSession|cookies\(\)|headers\(\)/);
    }
  });

  it('no configuration module takes an organisation id as an input: the only organisation is the guard tenant', () => {
    for (const f of CONFIG_LIBS) {
      // omitOrganisation is the one place that names the field, to REMOVE it from a response; it reads no input.
      const src = noTsComments(read(f)).replace(/\btenant\.organisationId\b/g, '').replace(/export function omitOrganisation[\s\S]*?\r?\n}\r?\n/, '');
      expect(src, f).not.toMatch(/organi[sz]ation_?id|organi[sz]ationSlug|org_?id/i);
    }
  });

  it('nothing in the configuration modules touches reservations, occurrences, payments or a public slug input', () => {
    for (const f of CONFIG_LIBS) {
      expect(noTsComments(read(f)), f).not.toMatch(/persistence\.reservations|createOccurrence|createSeries|cancelOccurrence|stripe|payment|checkout/i);
    }
    const schedules = noTsComments(read('lib/scheduling/config/schedules.ts'));
    const mentions = [...schedules.matchAll(/publicSlug[^\n]*/g)].map(m => m[0].replace(/\s+/g, ' ').trim());
    expect(mentions).toEqual(['publicSlug: null,']);
  });

  it('every repository mutation is audited, and only after a failure branch has already returned', () => {
    const mutation = /persistence\.config\.(createSchedule|updateSchedule|archiveSchedule|createOffering|updateOffering|archiveOffering|createResource|updateResource|linkOfferingResource|unlinkOfferingResource)\(/g;
    for (const f of CONFIG_LIBS.filter(x => !x.endsWith('http.ts'))) {
      const src = noTsComments(read(f));
      const calls = [...src.matchAll(mutation)].length;
      const audits = [...src.matchAll(/\baudit\(context,/g)].length;
      expect(audits, f).toBeGreaterThanOrEqual(calls);
      // no audit call sits before the guard of its mutation: each `await audit(` is preceded (in its function) by a refusal return
      for (const fn of src.split(/\nexport (?:async )?function /).slice(1)) {
        if (!/await audit\(/.test(fn) || !mutation.test(fn)) continue;
        mutation.lastIndex = 0;
        const firstMutation = fn.search(mutation);
        mutation.lastIndex = 0;
        expect(fn.indexOf('await audit('), `${f} audits before it mutates`).toBeGreaterThan(firstMutation);
        expect(fn, `${f} must return on a failed result before auditing`).toMatch(/if \(!\w+\.ok\) return|if \(!archived\)|if \(!\w+\.value\.ok\) return/);
      }
    }
  });
});

describe('the explicit scope', () => {
  it('only the three initial presets can be configured', () => {
    expect(noTsComments(read('lib/scheduling/configurable.ts'))).toMatch(/CONFIGURABLE_PRESETS: readonly PresetKey\[\] = \['classes_coaching', 'appointments', 'resource_hire'\]/);
  });

  it('no cron, public booking route or booking page appears', () => {
    // Phase 2B.2c (deliberate, reviewed change): the configuration dashboard (app/scheduling) and its navigation entry now exist;
    // they are pinned in schedulingPhase2b2cContainment.test.ts. Nothing else may.
    for (const p of ['app/dashboard/scheduling', 'app/book', 'app/api/cron/scheduling-top-up', 'app/api/scheduling/public']) expect(existsSync(path.join(ROOT, p)), p).toBe(false);
    expect(read('vercel.json')).not.toMatch(/scheduling/i);
  });

  it('the shared core still imports no host module', () => {
    for (const f of walk(path.join(ROOT, 'packages/scheduling/src'), /\.ts$/)) {
      expect(readFileSync(f, 'utf8'), rel(f)).not.toMatch(/from\s+['"](@\/|\.\.\/\.\.\/|next|react|pg|@neondatabase)/);
    }
  });

  it('LD Tennis and CRM files do not mention the configuration API', () => {
    for (const f of ['app/api/tennis/book/route.ts', 'app/api/tennis/cancel/route.ts', 'app/api/dashboard/enrolments/route.ts', 'app/api/dashboard/sessions/route.ts', 'app/api/bookings/route.ts', 'lib/tennisRecurrence.ts', 'lib/tennisSchedule.ts', 'app/api/crm/contacts/route.ts']) {
      if (existsSync(path.join(ROOT, f))) expect(read(f), f).not.toMatch(/lib\/scheduling|@scheduling\//);
    }
  });
});

describe('the central guard passes dynamic params without deriving an organisation from them', () => {
  const guard = noTsComments(read('lib/scheduling/route.ts'));

  it('awaits the params promise and keeps only string segments', () => {
    expect(guard).toMatch(/const params = await resolveParams\(routeContext\)/);
    expect(guard).toMatch(/typeof value === 'string'/);
  });

  it('resolves params after authorisation and the runtime, so a denied or unconfigured caller never reaches them', () => {
    const a = guard.indexOf('await authorizeSchedulingRequest(permission)');
    const r = guard.indexOf('await loadSchedulingRuntime(');
    const p = guard.indexOf('await resolveParams(');
    expect(a).toBeGreaterThan(-1);
    expect(r).toBeGreaterThan(a);
    expect(p).toBeGreaterThan(r);
  });
});
