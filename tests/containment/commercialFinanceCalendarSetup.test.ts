import { beforeEach, describe, expect, it, vi } from 'vitest';

const { authorize, transaction } = vi.hoisted(() => ({ authorize: vi.fn(), transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ default: { transaction } }));
vi.mock('@/lib/commercial/auditLog', () => ({ logFinanceCalendarCreated: vi.fn() }));
vi.mock('@/lib/commercial/authorize', () => ({ authorizeCommercialRequest: authorize, COMMERCIAL_MIN_ROLE: { administer: 'admin' } }));
const { parseCalendarInput } = await import('@/lib/commercial/financeCalendarSetup');
const yearRoute = await import('@/app/api/commercial/budgeting/financial-years/route');
const periodRoute = await import('@/app/api/commercial/budgeting/financial-years/[id]/periods/route');
const id = '00000000-0000-4000-8000-000000000701';
const body = { name: 'FY27', startsOn: '2026-07-01', endsOn: '2027-06-30', organisationId: 'attacker-org' };
const request = (value: unknown) => new Request('http://localhost', { method: 'POST', body: JSON.stringify(value) });
beforeEach(() => { vi.clearAllMocks(); authorize.mockResolvedValue({ ok: true, session: { organisationId: 'session-org' } }); });

describe('finance calendar setup boundaries', () => {
  it.each([null, [], {}, { ...body, name: ' ' }, { ...body, name: 'x'.repeat(101) },
    { ...body, startsOn: '2026-02-30' }, { ...body, startsOn: '0000-01-01' },
    { ...body, startsOn: '2026-7-01' }, { ...body, endsOn: '2026-07-01' },
    { ...body, endsOn: '2026-06-30' }, { ...body, startsOn: true }])('rejects invalid input before SQL: %j', async invalid => {
    expect(() => parseCalendarInput(invalid)).toThrow();
    expect((await yearRoute.POST(request(invalid))).status).toBe(400);
    expect(transaction).not.toHaveBeenCalled();
  });
  it('preserves leap dates and trims names', () => {
    expect(parseCalendarInput({ name: ' Leap ', startsOn: '2028-02-29', endsOn: '2028-03-31' })).toEqual({ name: 'Leap', startsOn: '2028-02-29', endsOn: '2028-03-31' });
  });
  it.each([401, 403, 503])('preserves denial %s for both mutations', async status => {
    authorize.mockResolvedValue({ ok: false, response: new Response(null, { status }) });
    expect((await yearRoute.POST(request(body))).status).toBe(status);
    expect((await periodRoute.POST(request(body), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect(authorize).toHaveBeenCalledWith('budgeting', 'admin');
    expect(transaction).not.toHaveBeenCalled();
  });
  it('uses the session tenant even when the caller supplies another tenant', async () => {
    transaction.mockImplementation(async builder => {
      const queries = builder((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values }));
      expect(queries.flatMap((query: { values: unknown[] }) => query.values)).not.toContain('attacker-org');
      expect(queries[1].values).toContain('session-org');
      return [[], [{ record: { id, starts_on: body.startsOn, ends_on: body.endsOn }, error: null }]];
    });
    expect((await yearRoute.POST(request(body))).status).toBe(201);
    expect((await periodRoute.POST(request(body), { params: Promise.resolve({ id }) })).status).toBe(201);
  });
  it.each([['NOT_FOUND', 404], ['CLOSED_YEAR', 409], ['OUTSIDE_YEAR', 409], ['DUPLICATE_NAME', 409], ['OVERLAP', 409]])('returns a domain failure %s without leaking data', async (code, status) => {
    transaction.mockResolvedValue([[], [{ record: null, error: code }]]);
    const response = await periodRoute.POST(request(body), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
  });
});
