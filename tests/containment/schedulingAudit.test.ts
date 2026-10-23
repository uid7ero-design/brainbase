import { describe, it, expect, vi, beforeEach } from 'vitest';

// Phase 2B.1: the Scheduling audit module in isolation: what may be written, what is dropped, and what a write failure does.

const db = vi.hoisted(() => ({ calls: [] as { text: string; values: unknown[] }[], fail: false }));
vi.mock('@/lib/db', () => ({
  default: (strings: TemplateStringsArray, ...values: unknown[]) => {
    db.calls.push({ text: strings.join('?').replace(/\s+/g, ' ').trim(), values });
    return db.fail ? Promise.reject(Object.assign(new Error('relation "audit_logs" does not exist'), { code: '42P01' })) : Promise.resolve([]);
  },
}));

const { recordSchedulingAudit, sanitiseAuditSummary, SCHEDULING_AUDIT_ACTIONS, listSchedulingAudit } = await import('@/lib/scheduling/audit');
const { staffTenantContext, publicTenantContext } = await import('@/lib/scheduling/adapters/brainbase');

const tenant = (role = 'manager', org = 'org-a') => staffTenantContext({ organisationId: org, userId: 'u1', role, timezone: null });
const stored = () => JSON.parse(String(db.calls.at(-1)!.values[7]));

beforeEach(() => {
  db.calls = [];
  db.fail = false;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('action names', () => {
  it("every action is in the scheduling namespace '<scheduling>.<resource>.<verb>' and the list is closed", () => {
    for (const a of SCHEDULING_AUDIT_ACTIONS) expect(a).toMatch(/^scheduling\.[a-z]+\.[a-z_]+$/);
    expect(new Set(SCHEDULING_AUDIT_ACTIONS).size).toBe(SCHEDULING_AUDIT_ACTIONS.length);
  });

  it('an action outside the list is refused and nothing is written', async () => {
    const ok = await recordSchedulingAudit({ tenant: tenant(), action: 'scheduling.reservation.exploded' as never, resourceType: 'reservation', resourceId: 'r1' });
    expect(ok).toBe(false);
    expect(db.calls).toEqual([]);
  });
});

describe('what is written', () => {
  it('takes the organisation and the actor from the tenant, never from a caller value', async () => {
    const ok = await recordSchedulingAudit({ tenant: tenant('manager', 'org-z'), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: 'r1', summary: { occurrence_id: 'o1' } });
    expect(ok).toBe(true);
    const v = db.calls[0].values;
    expect(v[1]).toBe('org-z');
    expect(v[2]).toBe('u1');
    expect(v[3]).toBe('scheduling.reservation.created');
    expect(v[4]).toBe('scheduling.reservation'); // the resource type is namespaced too, so no other vertical's filter can match it
  });

  it('only staff actors are recorded (a public or system tenant is refused)', async () => {
    expect(await recordSchedulingAudit({ tenant: publicTenantContext('org-a', undefined), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: 'r1' })).toBe(false);
    expect(db.calls).toEqual([]);
  });

  it('identity detail is stored apart from the summary, and the summary stays free of it', async () => {
    await recordSchedulingAudit({
      tenant: tenant(),
      action: 'scheduling.reservation.created',
      resourceType: 'reservation',
      resourceId: 'r1',
      summary: { occurrence_id: 'o1', party_size: 3, outcome: 'created' },
      identity: { customerName: ' Pat Example ', customerEmail: 'pat@example.test' },
    });
    const s = stored();
    expect(s.summary).toEqual({ occurrence_id: 'o1', party_size: 3, outcome: 'created' });
    expect(s.identity).toEqual({ customer_name: 'Pat Example', customer_email: 'pat@example.test' });
    expect(JSON.stringify(s.summary)).not.toMatch(/Pat|pat@/);
  });

  it('no identity field at all when none is given', async () => {
    await recordSchedulingAudit({ tenant: tenant(), action: 'scheduling.schedule.created', resourceType: 'schedule', resourceId: 's1', summary: { preset_key: 'classes_coaching' } });
    expect(stored()).not.toHaveProperty('identity');
  });
});

describe('the summary is non-sensitive by construction', () => {
  it('drops keys that name a person or a contact detail, and counts them', () => {
    const { summary, redacted } = sanitiseAuditSummary({
      occurrence_id: 'o1',
      email: 'x@y.test',
      customer_email: 'x@y.test',
      phone: '0400000000',
      first_name: 'Pat',
      last_name: 'Example',
      customer_name: 'Pat Example',
      name: 'Pat',
      notes: 'allergic',
      address: '1 Street',
    });
    expect(summary).toEqual({ occurrence_id: 'o1' });
    expect(redacted).toBe(9);
  });

  it('drops values that look like an email address or a phone number, whatever the key', () => {
    const { summary, redacted } = sanitiseAuditSummary({ changed_field: 'pat@example.test', ref: '+61 400 000 000', other: '0412 345 678', fine: 'currency' });
    expect(summary).toEqual({ fine: 'currency' });
    expect(redacted).toBe(3);
  });

  it('keeps ids, UUIDs, ISO dates and instants, counts, booleans and short id lists', () => {
    const input = { reservation_id: '123e4567-e89b-12d3-a456-426614174000', on: '2026-10-23', at: '2026-10-23T01:02:03Z', n: 4, ok: true, none: null, ids: ['a', 'b', 3] };
    const { summary, redacted } = sanitiseAuditSummary(input);
    expect(summary).toEqual(input);
    expect(redacted).toBe(0);
  });

  it('drops objects, oversized strings, long arrays and non-finite numbers', () => {
    const { summary, redacted } = sanitiseAuditSummary({ nested: { a: 1 }, big: 'x'.repeat(500), many: Array.from({ length: 40 }, (_, i) => i), inf: Infinity, ok: 1 });
    expect(summary).toEqual({ ok: 1 });
    expect(redacted).toBe(4);
  });

  it('drops a key that is not a plain snake_case identifier', () => {
    expect(sanitiseAuditSummary({ 'Bad Key': 1, 'a-b': 2, A: 3, good_key: 4 }).summary).toEqual({ good_key: 4 });
  });

  it('records the redaction count in the entry without the dropped content', async () => {
    await recordSchedulingAudit({ tenant: tenant(), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: 'r1', summary: { customer_email: 'pat@example.test', n: 1 } });
    const s = stored();
    expect(s.summary).toEqual({ n: 1 });
    expect(s.redacted).toBe(1);
    expect(JSON.stringify(db.calls[0].values)).not.toContain('pat@example.test');
  });
});

describe('audit failures never reverse or surface through the operation', () => {
  it('a failed write resolves to false and never throws, and the log line carries no payload', async () => {
    db.fail = true;
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = await recordSchedulingAudit({
      tenant: tenant(),
      action: 'scheduling.reservation.created',
      resourceType: 'reservation',
      resourceId: 'r1',
      summary: { n: 1 },
      identity: { customerName: 'Pat Example', customerEmail: 'pat@example.test' },
    });
    expect(ok).toBe(false);
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('scheduling.reservation.created');
    expect(logged).not.toMatch(/Pat Example|pat@example\.test/);
  });

  it('a committed operation followed by a failing audit write keeps its result', async () => {
    let committed: string | null = null;
    const operation = async () => {
      committed = 'reservation-1'; // stands for the already-committed booking
      return committed;
    };
    const result = await operation();
    db.fail = true;
    const audited = await recordSchedulingAudit({ tenant: tenant(), action: 'scheduling.reservation.created', resourceType: 'reservation', resourceId: result });
    expect(audited).toBe(false);
    expect(committed).toBe('reservation-1');
  });
});

describe('reading', () => {
  it('requires scheduling.view', async () => {
    const t = publicTenantContext('org-a', undefined);
    await expect(listSchedulingAudit(t)).rejects.toThrow(/scheduling\.view/);
    expect(db.calls).toEqual([]);
  });

  it('is scoped by the tenant organisation and the scheduling action prefix in SQL, and bounds the limit', async () => {
    await listSchedulingAudit(tenant('viewer', 'org-q'), { limit: 5000 });
    const c = db.calls[0];
    expect(c.text).toMatch(/WHERE organisation_id = \? AND action LIKE 'scheduling\.%'/);
    expect(c.values[0]).toBe('org-q');
    expect(c.values.at(-1)).toBe(100);
    await listSchedulingAudit(tenant('viewer'), { limit: -3 });
    expect(db.calls[1].values.at(-1)).toBe(1);
  });
});
