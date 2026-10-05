import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';
import type { OrgSession } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';

function req(method: string, body?: unknown): NextRequest {
  return new Request('http://localhost/x', {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }) as unknown as NextRequest;
}

let sqlRows: unknown[] = [];
const sqlMock = vi.fn(async () => sqlRows);
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) =>
    (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}));

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});

const requireCapabilityMock = vi.fn();
vi.mock('@/lib/hr/capability', () => ({
  requireHrCapability: (...args: unknown[]) => requireCapabilityMock(...args),
}));

const resolveContextMock = vi.fn();
vi.mock('@/lib/hr/context', () => ({
  resolveHrAccessContext: (...args: unknown[]) => resolveContextMock(...args),
}));

const requireRestrictedCaseMock = vi.fn();
vi.mock('@/lib/hr/restrictedRoute', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/restrictedRoute')>();
  return {
    ...actual,
    requireRestrictedCase: (...args: unknown[]) => requireRestrictedCaseMock(...args),
  };
});

const readAuditMock = vi.fn();
vi.mock('@/lib/hr/auditLog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/hr/auditLog')>();
  return {
    ...actual,
    logRestrictedHrReadEvent: (...args: unknown[]) => readAuditMock(...args),
  };
});

const addParticipantMock = vi.fn();
const removeParticipantMock = vi.fn();
const createNoteMock = vi.fn();
vi.mock('@/lib/hr/restrictedCaseContentMutations', () => ({
  addRestrictedCaseParticipant: (...args: unknown[]) => addParticipantMock(...args),
  removeRestrictedCaseParticipant: (...args: unknown[]) => removeParticipantMock(...args),
  createRestrictedCaseNote: (...args: unknown[]) => createNoteMock(...args),
}));

const participantsRoute = await import('@/app/api/hr/restricted-cases/[id]/participants/route');
const removeRoute = await import('@/app/api/hr/restricted-cases/[id]/participants/[personId]/route');
const notesRoute = await import('@/app/api/hr/restricted-cases/[id]/notes/route');

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const SESSION: OrgSession = {
  userId: 'hr-admin',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'HR Admin',
};

beforeEach(() => {
  sqlRows = [];
  sqlMock.mockClear();
  requireSessionMock.mockReset();
  requireCapabilityMock.mockReset();
  resolveContextMock.mockReset();
  requireRestrictedCaseMock.mockReset();
  readAuditMock.mockReset();
  addParticipantMock.mockReset();
  removeParticipantMock.mockReset();
  createNoteMock.mockReset();

  requireSessionMock.mockResolvedValue(SESSION);
  requireCapabilityMock.mockResolvedValue({ key: 'people', config: {} });
  resolveContextMock.mockResolvedValue({
    organisationId: 'org-a',
    selfPersonId: null,
    isHrAdministrator: true,
    hasRestrictedHrAccess: false,
  });
  requireRestrictedCaseMock.mockResolvedValue({
    ok: true,
    case: { id: CASE_ID },
    auth: { case: { id: CASE_ID, organisationId: 'org-a' }, via: 'live_case_grant' },
    ctx: { userId: 'hr-admin', organisationId: 'org-a', role: 'manager' },
  });
  readAuditMock.mockResolvedValue(undefined);
});

describe('restricted participant routes', () => {
  it('GET requires exact restricted-case read authorization and audits every returned participant before disclosure', async () => {
    sqlRows = [{ id: 'p1', case_id: CASE_ID, person_id: PERSON_ID, role_in_case: 'witness', created_at: '2026-09-25T01:00:00Z' }];
    const res = await participantsRoute.GET(req('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(200);
    expect(requireRestrictedCaseMock).toHaveBeenCalledWith(SESSION, CASE_ID);
    expect(readAuditMock).toHaveBeenCalledTimes(1);
    expect(await res.json()).toEqual({ participants: [{ id: 'p1', person_id: PERSON_ID, role_in_case: 'witness', created_at: '2026-09-25T01:00:00Z' }] });
  });

  it('GET fails closed with 503 when participant read audit fails', async () => {
    sqlRows = [{ id: 'p1', case_id: CASE_ID, person_id: PERSON_ID, role_in_case: 'subject', created_at: 'x' }];
    readAuditMock.mockRejectedValue(new Error('audit down'));
    const res = await participantsRoute.GET(req('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Unable to record restricted HR access.' });
  });

  it('POST uses management authority without requiring a read grant and returns 201 for a new participant', async () => {
    addParticipantMock.mockResolvedValue({ outcome: 'created', participantId: 'p1', roleInCase: 'respondent' });
    const res = await participantsRoute.POST(req('POST', { person_id: PERSON_ID, role_in_case: 'respondent' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(requireRestrictedCaseMock).not.toHaveBeenCalled();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      participant: { id: 'p1', person_id: PERSON_ID, role_in_case: 'respondent' },
      already_participant: false,
    });
    expect(addParticipantMock).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      personId: PERSON_ID,
      roleInCase: 'respondent',
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'hr-admin' }),
    }));
  });

  it('POST is idempotent for the same role and reports a role conflict without rewriting an existing role', async () => {
    addParticipantMock.mockResolvedValueOnce({ outcome: 'already_participant', participantId: 'p1', roleInCase: 'witness' });
    const idem = await participantsRoute.POST(req('POST', { person_id: PERSON_ID, role_in_case: 'witness' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(idem.status).toBe(200);
    expect((await idem.json()).already_participant).toBe(true);

    addParticipantMock.mockResolvedValueOnce({ outcome: 'already_participant', participantId: 'p1', roleInCase: 'subject' });
    const conflict = await participantsRoute.POST(req('POST', { person_id: PERSON_ID, role_in_case: 'witness' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: 'Participant already exists with a different role.',
      code: 'restricted_hr_participant_role_conflict',
    });
  });

  it('POST collapses malformed/cross-org person targets and wrong-org cases without exposing data', async () => {
    const malformed = await participantsRoute.POST(req('POST', { person_id: 'not-a-uuid' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(malformed.status).toBe(400);
    expect((await malformed.json()).code).toBe('restricted_hr_person_not_eligible');

    addParticipantMock.mockResolvedValueOnce({ outcome: 'person_not_found' });
    const missingPerson = await participantsRoute.POST(req('POST', { person_id: PERSON_ID }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(missingPerson.status).toBe(400);
    expect((await missingPerson.json()).code).toBe('restricted_hr_person_not_eligible');

    addParticipantMock.mockResolvedValueOnce({ outcome: 'case_not_found' });
    const missingCase = await participantsRoute.POST(req('POST', { person_id: PERSON_ID }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(missingCase.status).toBe(404);
    expect(await missingCase.json()).toEqual({ error: 'Restricted HR case not found.' });
  });

  it('DELETE is management-only and idempotent, including malformed person ids', async () => {
    const malformed = await removeRoute.DELETE(req('DELETE'), { params: Promise.resolve({ id: CASE_ID, personId: 'bad-id' }) });
    expect(malformed.status).toBe(200);
    expect(await malformed.json()).toEqual({ removed: true, already_removed: true, person_id: 'bad-id' });

    removeParticipantMock.mockResolvedValueOnce({ outcome: 'removed' });
    const removed = await removeRoute.DELETE(req('DELETE'), { params: Promise.resolve({ id: CASE_ID, personId: PERSON_ID }) });
    expect(removed.status).toBe(200);
    expect(await removed.json()).toEqual({ removed: true, already_removed: false, person_id: PERSON_ID });

    removeParticipantMock.mockResolvedValueOnce({ outcome: 'already_removed' });
    const idem = await removeRoute.DELETE(req('DELETE'), { params: Promise.resolve({ id: CASE_ID, personId: PERSON_ID }) });
    expect((await idem.json()).already_removed).toBe(true);
  });
});

describe('restricted note routes', () => {
  it('GET requires restricted-case read access, audits note reads, and returns note bodies only after successful audit', async () => {
    sqlRows = [{ id: 'n1', case_id: CASE_ID, author_id: 'author', body: 'sensitive narrative', created_at: '2026-09-25T02:00:00Z' }];
    const res = await notesRoute.GET(req('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(requireRestrictedCaseMock).toHaveBeenCalledWith(SESSION, CASE_ID);
    expect(readAuditMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'hr_restricted_case_note.read',
      resourceType: 'hr_restricted_case_note',
      afterState: expect.objectContaining({ body: 'sensitive narrative' }),
    }));
    expect(res.status).toBe(200);
    expect((await res.json()).notes[0].body).toBe('sensitive narrative');
  });

  it('GET fails closed when note-read audit storage fails', async () => {
    sqlRows = [{ id: 'n1', case_id: CASE_ID, author_id: 'author', body: 'secret', created_at: 'x' }];
    readAuditMock.mockRejectedValue(new Error('audit down'));
    const res = await notesRoute.GET(req('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'Unable to record restricted HR access.' });
  });

  it('POST requires read access, accepts only body, and derives author from session', async () => {
    createNoteMock.mockResolvedValue({ noteId: 'n1', createdAt: '2026-09-25T03:00:00Z' });
    const res = await notesRoute.POST(req('POST', { body: '  note text  ' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ note: { id: 'n1', author_id: 'hr-admin', body: 'note text', created_at: '2026-09-25T03:00:00Z' } });
    expect(createNoteMock).toHaveBeenCalledWith(expect.objectContaining({
      caseId: CASE_ID,
      body: 'note text',
      actor: expect.objectContaining({ organisationId: 'org-a', userId: 'hr-admin' }),
    }));
  });

  it('POST never treats participation or HR-admin management authority as note-read authority', async () => {
    requireRestrictedCaseMock.mockResolvedValue({ ok: false, response: Response.json({ error: 'Restricted HR case not found.' }, { status: 404 }) });
    const res = await notesRoute.POST(req('POST', { body: 'secret' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(404);
    expect(createNoteMock).not.toHaveBeenCalled();
  });

  it('POST rejects client-supplied author/case fields and empty bodies', async () => {
    const injected = await notesRoute.POST(req('POST', { body: 'x', author_id: 'attacker' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(injected.status).toBe(400);
    expect(await injected.json()).toEqual({ error: 'Unknown or unsupported field: author_id' });

    const empty = await notesRoute.POST(req('POST', { body: '   ' }), { params: Promise.resolve({ id: CASE_ID }) });
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({ error: 'body is required.' });
  });

  it('returns 503 for People capability lookup failures before restricted data access', async () => {
    requireCapabilityMock.mockRejectedValue(new CapabilityDatabaseError());
    const res = await notesRoute.GET(req('GET'), { params: Promise.resolve({ id: CASE_ID }) });
    expect(res.status).toBe(503);
    expect(requireRestrictedCaseMock).not.toHaveBeenCalled();
  });
});
