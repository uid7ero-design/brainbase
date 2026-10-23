import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 2B.1: the runtime adapter: organisation timezone, tenant construction, explicit settings, and read-only behaviour.

const db = vi.hoisted(() => ({ tz: null as string | null | undefined, orgExists: true, settings: true, statements: [] as string[], fail: false }));
vi.mock('@/lib/db', () => {
  const run = (text: string) => {
    const t = text.replace(/\s+/g, ' ').trim();
    db.statements.push(t);
    if (db.fail) throw new Error('down');
    if (/^SELECT timezone FROM organisations/i.test(t)) return db.orgExists ? [{ timezone: db.tz ?? null }] : [];
    if (/FROM scheduling_settings/i.test(t)) return db.settings ? [{ organisation_id: 'org-a', currency: 'AUD' }] : [];
    throw new Error('unexpected statement ' + t.slice(0, 80));
  };
  const tag = (s: TemplateStringsArray) => Promise.resolve().then(() => run(s.join('?')));
  return { default: Object.assign(tag, { query: (text: string) => Promise.resolve().then(() => run(text)) }) };
});

const { loadSchedulingRuntime, resolveOrganisationTimezone, SchedulingConfigurationError, systemClock } = await import('@/lib/scheduling/runtime');

const session = (role = 'manager', org = 'org-a') => ({ organisationId: org, userId: 'u1', role });

beforeEach(() => {
  db.tz = 'Australia/Perth';
  db.orgExists = true;
  db.settings = true;
  db.statements = [];
  db.fail = false;
});

describe('organisation timezone', () => {
  it('uses the stored zone, trimmed', async () => {
    db.tz = '  Australia/Sydney ';
    expect(await resolveOrganisationTimezone('org-a')).toEqual({ value: 'Australia/Sydney', source: 'organisation' });
  });

  it('falls back to Australia/Adelaide for NULL and blank, and says it is a fallback', async () => {
    db.tz = null;
    expect(await resolveOrganisationTimezone('org-a')).toEqual({ value: 'Australia/Adelaide', source: 'fallback' });
    db.tz = '  ';
    expect(await resolveOrganisationTimezone('org-a')).toEqual({ value: 'Australia/Adelaide', source: 'fallback' });
  });

  it('refuses an invalid stored zone instead of guessing', async () => {
    db.tz = 'Not/AZone';
    await expect(resolveOrganisationTimezone('org-a')).rejects.toBeInstanceOf(SchedulingConfigurationError);
  });

  it('fails closed when the organisation row does not exist', async () => {
    db.orgExists = false;
    await expect(resolveOrganisationTimezone('ghost')).rejects.toThrow(/not found/);
  });
});

describe('loadSchedulingRuntime', () => {
  it('builds the tenant from the session organisation, user and role plus the resolved timezone', async () => {
    const rt = await loadSchedulingRuntime(session('manager'));
    expect(rt.tenant.organisationId).toBe('org-a');
    expect(rt.tenant.timezone).toBe('Australia/Perth');
    expect(rt.tenant.actor).toEqual({ kind: 'staff', userId: 'u1' });
    expect(rt.tenant.can('scheduling.manage')).toBe(true);
    expect(rt.settings).toMatchObject({ organisationId: 'org-a', currency: 'AUD' });
    expect(rt.timezone.source).toBe('organisation');
  });

  it('a viewer tenant can view but not manage (the runtime does not widen what the role allows)', async () => {
    const rt = await loadSchedulingRuntime(session('viewer'));
    expect(rt.tenant.can('scheduling.view')).toBe(true);
    expect(rt.tenant.can('scheduling.manage')).toBe(false);
    expect(rt.tenant.can('scheduling.audit.identity')).toBe(false);
  });

  it('missing settings is a SchedulingConfigurationError and the runtime issues only SELECT statements', async () => {
    db.settings = false;
    await expect(loadSchedulingRuntime(session())).rejects.toMatchObject({ name: 'SchedulingConfigurationError', code: 'SCHEDULING_NOT_CONFIGURED', reason: 'missing_settings' });
    expect(db.statements.length).toBeGreaterThan(0);
    for (const s of db.statements) expect(s).toMatch(/^SELECT/i);
  });

  it('a database failure propagates (the guard turns it into a closed 503)', async () => {
    db.fail = true;
    await expect(loadSchedulingRuntime(session())).rejects.toThrow('down');
  });
});

describe('the clock', () => {
  it("today() is the calendar date in the REQUESTED zone, not the server's", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-23T14:30:00Z')); // 2026-10-24 01:00 in Adelaide (ACDT), still the 23rd in Perth
      expect(systemClock.today('Australia/Adelaide')).toBe('2026-10-24');
      expect(systemClock.today('Australia/Perth')).toBe('2026-10-23');
      expect(systemClock.now().toISOString()).toBe('2026-10-23T14:30:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });
});
