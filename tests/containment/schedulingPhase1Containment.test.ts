import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import {
  BRAINBASE_PORT_MAPPING,
  SCHEDULING_CAPABILITY_KEY,
  contactToCustomerRef,
  permissionsForRole,
  publicTenantContext,
  staffTenantContext,
} from '@/lib/scheduling/adapters/brainbase';
import { TenantIsolationError } from '@scheduling/core';

// Scheduling & Bookings Phase 1 is a foundation: it must not change what any
// organisation sees or what any production table contains. These checks pin
// that by reading the repository, so a later phase that does enable the
// module has to change them deliberately, in the same PR, with a reason.

const ROOT = path.resolve(__dirname, '../..');
const read = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === '.git') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

describe('Phase 1 does not enable the module anywhere', () => {
  const appDirs = ['app', 'components', 'hooks', 'modules', 'services', 'store', 'lib'];
  const sources = appDirs
    .filter(d => existsSync(path.join(ROOT, d)))
    .flatMap(d => walk(path.join(ROOT, d)))
    .concat(['middleware.ts'].map(f => path.join(ROOT, f)));
  const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join('/');

  it('no application code imports the scheduling core or the scheduling adapters', () => {
    const offenders = sources
      .filter(f => !rel(f).startsWith('lib/scheduling/'))
      // Phase 2B.1 (deliberate, reviewed change): exactly the two foundation routes import the guard (@/lib/scheduling/route)
      // and the audit reader. schedulingPhase2b1Containment.test.ts pins that they do nothing else.
      // Phase 2B.2b (deliberate, reviewed change): every route under app/api/scheduling imports the guard and its configuration modules.
      // schedulingPhase2b1Containment.test.ts and schedulingPhase2b2bContainment.test.ts pin the exact route set and that they do nothing else.
      .filter(f => !rel(f).startsWith('app/api/scheduling/'))
      // Phase 2B.2c (deliberate, reviewed change): the dashboard (app/scheduling) imports the shared core for preset wording and validators.
      // schedulingPhase2b2cContainment.test.ts pins what it may import.
      .filter(f => !rel(f).startsWith('app/scheduling/'))
      .filter(f => /@scheduling\/core|@\/lib\/scheduling|from ['"]\.\.?\/.*scheduling\//.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('no scheduling route or page exists', () => {
    // Phase 2B.1 (deliberate, reviewed change): app/api/scheduling holds exactly the status and audit foundation routes.
    const apiRoutes = existsSync(path.join(ROOT, 'app/api/scheduling')) ? readdirSync(path.join(ROOT, 'app/api/scheduling')).sort() : [];
    // Phase 2B.2b (deliberate, reviewed change): the configuration API adds offerings, resources and schedules (pinned route by route
    // in schedulingPhase2b2bContainment.test.ts).
    expect(apiRoutes).toEqual(['audit', 'offerings', 'resources', 'schedules', 'status']);
    expect(existsSync(path.join(ROOT, 'app/dashboard/scheduling'))).toBe(false);
    expect(existsSync(path.join(ROOT, 'app/book'))).toBe(false); // Phase 2B.2c: app/scheduling (the configuration dashboard) now exists
  });

  it('the navigation model has exactly one capability-gated scheduling entry (2B.2c) and still gates the Tennis group on the ld-tennis variant', () => {
    const nav = read('components/nav/navModel.ts');
    expect((nav.match(/id: 'scheduling'/g) ?? []).length).toBe(1);
    expect(nav).toMatch(/id: 'scheduling'[\s\S]*?gate: \{ anyCapability: \['scheduling'\], minRole: 'viewer' \}/);
    expect(nav).toMatch(/gate:\s*\{\s*variant:\s*'ld-tennis'\s*\}/);
    expect(nav).toContain("label: 'Squad'");
    expect(nav).toContain("href: '/dashboard/sessions'");
  });

  it('the scheduling capability key is reserved but not seeded or checked anywhere', () => {
    expect(SCHEDULING_CAPABILITY_KEY).toBe('scheduling');
    const hits = sources
      .filter(f => !rel(f).startsWith('lib/scheduling/'))
      .filter(f => /['"]scheduling['"]/.test(readFileSync(f, 'utf8')) && /capabilit|requireCapability|module_key/i.test(readFileSync(f, 'utf8')))
      .map(rel);
    // Phase 2B.2c (deliberate, reviewed change): the navigation entry and its icon name the key; both are presentation only.
    expect(hits).toEqual(['components/brand/CapabilityIcon.tsx', 'components/nav/navModel.ts']);
  });

  it('no SQL script or migration creates or alters a scheduling_* table', () => {
    const sqlDirs = ['scripts', 'prisma', 'backend_migration'].filter(d => existsSync(path.join(ROOT, d)));
    const offenders: string[] = [];
    const scan = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const full = path.join(dir, name);
        // Phase 2A (deliberate, reviewed change): the BrainBase HOST migration lives in scripts/scheduling/.
        // Its contents are pinned file-by-file in schedulingPhase2aContainment.test.ts; the shared DDL
        // lives in packages/scheduling/sql (outside these directories) and is pinned there as well.
        if (rel(full) === 'scripts/scheduling') continue;
        // Phase 2B.0 (deliberate, reviewed change): the disposable-Postgres proof of the host files names scheduling_*
        // objects by necessity. It reaches only SCHEDULING_TEST_DATABASE_URL (pinned in schedulingPhase2b0Containment.test.ts).
        if (rel(full) === 'scripts/tests/schedulingHost2b0.integration.test.ts') continue;
        // Phase 2B.1 (deliberate, reviewed change): the disposable-Postgres proof of the runtime names scheduling_settings to
        // set up fixtures. It reaches only SCHEDULING_TEST_DATABASE_URL and creates no scheduling_* table.
        if (rel(full) === 'scripts/tests/schedulingRuntime2b1.integration.test.ts') continue;
        // Phase 2B.2b (deliberate, reviewed change): the disposable-Postgres proof of the configuration API names scheduling_* tables to
        // set up and compare fixtures. It reaches only SCHEDULING_TEST_DATABASE_URL and creates no scheduling_* table.
        if (rel(full) === 'scripts/tests/schedulingConfigApi2b2b.integration.test.ts') continue;
        // Scheduling browser harness (deliberate, reviewed change): it applies the committed Scheduling SQL to a DISPOSABLE Docker
        // database and seeds one scheduling_settings row per fixture organisation (the application never creates settings). Its
        // network guard refuses every non-loopback request and every non-fixture SQL connection; it creates no scheduling_* table itself.
        if (rel(full) === 'scripts/tests/helpers/schedulingBrowserEnv.mjs') continue;
        if (statSync(full).isDirectory()) scan(full);
        else if (/\.(sql|prisma|ts|mjs|js)$/.test(name) && /scheduling_[a-z_]+/.test(readFileSync(full, 'utf8'))) offenders.push(rel(full));
      }
    };
    sqlDirs.forEach(d => scan(path.join(ROOT, d)));
    expect(offenders).toEqual([]);
    expect(read('prisma/schema.prisma')).not.toMatch(/scheduling_/);
  });
});

describe('every LD Tennis route and page that existed before Phase 1 still exists', () => {
  const required = [
    'app/dashboard/sessions/page.tsx',
    'app/admin/sessions/page.tsx',
    'app/api/dashboard/sessions/route.ts',
    'app/api/dashboard/sessions/[id]/route.ts',
    'app/api/dashboard/sessions/[id]/archive/route.ts',
    'app/api/dashboard/sessions/[id]/restore/route.ts',
    'app/api/dashboard/sessions/[id]/generate-instances/route.ts',
    'app/api/dashboard/sessions/[id]/instances/[instanceId]/route.ts',
    'app/api/dashboard/sessions/instances/route.ts',
    'app/api/dashboard/sessions/reconcile/route.ts',
    'app/api/dashboard/enrolments/route.ts',
    'app/api/dashboard/enrolments/[id]/route.ts',
    'app/api/dashboard/enrolments/[id]/pause/route.ts',
    'app/api/dashboard/enrolments/remove-future/route.ts',
    'app/api/dashboard/session-types/route.ts',
    'app/api/dashboard/session-types/[id]/route.ts',
    'app/api/tennis/book/route.ts',
    'app/api/tennis/cancel/route.ts',
    'app/api/tennis/sessions/route.ts',
    'app/api/tennis/subscribe/route.ts',
    'app/api/bookings/route.ts',
    'app/api/bookings/[id]/route.ts',
    'app/api/sessions/route.ts',
    'app/api/sessions/instances/route.ts',
    'app/api/sessions/[id]/route.ts',
    'app/api/sessions/[id]/generate-instances/route.ts',
    'app/api/sessions/[id]/instances/[instanceId]/route.ts',
    'app/api/admin/migrate-sessions/route.ts',
    'app/api/leads/[id]/convert/route.ts',
    'lib/tennisSchedule.ts',
    'lib/tennisRecurrence.ts',
    'lib/tennisSessionTypes.ts',
    'lib/sessionDisplay.ts',
  ];
  for (const f of required) {
    it(`${f} exists`, () => {
      expect(existsSync(path.join(ROOT, f))).toBe(true);
    });
  }

  it('the live tennis modules do not depend on the scheduling code (dependency points one way only)', () => {
    for (const f of ['lib/tennisSchedule.ts', 'lib/tennisRecurrence.ts', 'lib/tennisSessionTypes.ts', 'lib/sessionDisplay.ts']) {
      expect(read(f), f).not.toMatch(/scheduling/i);
    }
  });
});

describe('BrainBase adapter', () => {
  const session = { organisationId: 'org-a', userId: 'u1', timezone: 'Australia/Adelaide' };

  it('maps BrainBase roles onto scheduling permissions the way the live tennis routes gate them', () => {
    expect(permissionsForRole('viewer')).toEqual(['scheduling.view']);
    for (const role of ['manager', 'admin', 'super_admin']) {
      expect(permissionsForRole(role)).toEqual(['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity']);
    }
  });

  it("fails closed for 'analyst' and for any unknown role, exactly like roleGte() in lib/session.ts", () => {
    expect(permissionsForRole('analyst')).toEqual([]);
    expect(permissionsForRole('owner')).toEqual([]);
    expect(permissionsForRole('')).toEqual([]);
    const t = staffTenantContext({ ...session, role: 'analyst' });
    expect(t.can('scheduling.view')).toBe(false);
  });

  it('builds a staff tenant carrying the organisation, the user and the permissions', () => {
    const t = staffTenantContext({ ...session, role: 'manager' });
    expect(t.organisationId).toBe('org-a');
    expect(t.actor).toEqual({ kind: 'staff', userId: 'u1' });
    expect(t.can('scheduling.manage')).toBe(true);
    expect(staffTenantContext({ ...session, role: 'viewer' }).can('scheduling.manage')).toBe(false);
  });

  it('defaults a missing organisation timezone to the production default and refuses a missing organisation', () => {
    expect(staffTenantContext({ ...session, role: 'manager', timezone: null }).timezone).toBe('Australia/Adelaide');
    expect(() => staffTenantContext({ ...session, organisationId: '', role: 'manager' })).toThrow();
    expect(() => publicTenantContext('', null)).toThrow();
  });

  it('the public tenant can do nothing by permission (public booking is a narrow, separately authorised path)', () => {
    const t = publicTenantContext('org-a', undefined);
    expect(t.actor).toEqual({ kind: 'public' });
    expect(t.timezone).toBe('Australia/Adelaide');
    for (const p of ['scheduling.view', 'scheduling.manage', 'scheduling.reserve', 'scheduling.attendance', 'scheduling.audit.identity'] as const) {
      expect(t.can(p)).toBe(false);
    }
  });

  it("maps a CRM contact to a CustomerRef and refuses another organisation's contact", () => {
    const tenant = staffTenantContext({ ...session, role: 'manager' });
    const row = { id: 'c1', organisation_id: 'org-a', name: 'Sam', email: 'sam@example.com', phone: null };
    expect(contactToCustomerRef(tenant, row)).toEqual({ id: 'c1', organisationId: 'org-a', displayName: 'Sam', email: 'sam@example.com', phone: null });
    expect(() => contactToCustomerRef(tenant, { ...row, organisation_id: 'org-b' })).toThrow(TenantIsolationError);
  });

  it('documents an owner for every port the core requires', () => {
    expect(Object.keys(BRAINBASE_PORT_MAPPING).sort()).toEqual(
      ['availability', 'clock', 'customers', 'notifications', 'payments', 'reservations', 'tenant'],
    );
  });
});

describe('BrainBase adapter: timezone fallback and per-schedule resolution', () => {
  it('existing organisations without a configured timezone resolve to Australia/Adelaide, with no backfill', async () => {
    const { BRAINBASE_FALLBACK_TIMEZONE } = await import('@/lib/scheduling/adapters/brainbase');
    const { resolveScheduleTimezone } = await import('@scheduling/core');
    expect(BRAINBASE_FALLBACK_TIMEZONE).toBe('Australia/Adelaide');
    expect(resolveScheduleTimezone({ timezone: null }, { timezone: null }, BRAINBASE_FALLBACK_TIMEZONE)).toBe('Australia/Adelaide');
    expect(resolveScheduleTimezone({ timezone: null }, { timezone: 'Australia/Perth' }, BRAINBASE_FALLBACK_TIMEZONE)).toBe('Australia/Perth');
    expect(resolveScheduleTimezone({ timezone: 'Pacific/Auckland' }, { timezone: 'Australia/Perth' }, BRAINBASE_FALLBACK_TIMEZONE)).toBe('Pacific/Auckland');
  });

  it('the adapter source names the fallback in one place and still reads no organisation column', () => {
    const src = read('lib/scheduling/adapters/brainbase/index.ts');
    expect(src.match(/'Australia\/Adelaide'/g)).toHaveLength(1); // only the constant definition
    expect(src).not.toMatch(/organisations\.timezone/); // organisationTimezoneSchema (F.2A) forbids reading it before Phase 2 wires it
  });
});
