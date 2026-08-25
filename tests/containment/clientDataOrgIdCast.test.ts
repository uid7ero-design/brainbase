import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';

// Clients 2.0 Phase A (F.7S) — app/api/admin/client-data/contacts/[id]/route.ts
// and app/api/admin/client-data/leads/[id]/route.ts compared the TEXT
// organisation_id column against an explicit ::uuid cast. organisations.id
// is a Prisma `String @id @default(cuid())` (prisma/schema.prisma:12) — TEXT,
// not native UUID — and real organisation ids are opaque, mixed-format text
// (some historically UUID-shaped, some cuid-shaped, e.g. the real Production
// "City of Onkaparinga" id `cmp4cndxu0000fabxqwogpttt`). A cuid-shaped id is
// not valid ::uuid syntax, so the old cast made every inline contact/lead
// edit from /clients/[id] throw for any org whose id isn't UUID-shaped text —
// it only ever appeared to work for LD Tennis because that org's id happens
// to be a UUID-shaped string. The fix removes only the invalid
// organisation_id cast; the row's own `id` cast is untouched (contacts.id /
// tennis_leads.id are always server-generated via gen_random_uuid()::text,
// so they are always genuinely UUID-shaped and that cast never breaks).

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

const requireRoleMock = vi.fn();
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}));

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const SUPER_ADMIN = { userId: 'u1', organisationId: 'brainbase-org', role: 'super_admin', name: 'James' };

// A real, live cuid-shaped Production organisation id — never UUID-shaped.
// The old ::uuid cast would fail on syntax alone for this exact value.
const CUID_SHAPED_ORG_ID = 'cmp4cndxu0000fabxqwogpttt';
const CONTACT_ROW_ID = 'a1b2c3d4-e5f6-47a8-9012-3456789abcde';

function sqlCallText(index: number): string {
  const args = sqlMock.mock.calls[index] as unknown[];
  return (args[0] as TemplateStringsArray).join(' ');
}
function sqlCallArgs(index: number): unknown[] {
  return sqlMock.mock.calls[index] as unknown[];
}

const { PATCH: contactsPATCH } = await import('@/app/api/admin/client-data/contacts/[id]/route');
const { PATCH: leadsPATCH } = await import('@/app/api/admin/client-data/leads/[id]/route');

describe('PATCH /api/admin/client-data/contacts/[id] — TEXT organisation_id contract', () => {
  const PATCH = contactsPATCH;

  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
    requireRoleMock.mockResolvedValue(SUPER_ADMIN);
  });

  function req(body: unknown) {
    return asNextRequest(new Request(`http://localhost/api/admin/client-data/contacts/${CONTACT_ROW_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }
  const params = Promise.resolve({ id: CONTACT_ROW_ID });
  const validBody = {
    orgId: CUID_SHAPED_ORG_ID, name: 'Jane', email: null, phone: null, status: 'lead',
    address: null, age: null, program: null, session_times: null, next_action: null,
  };

  it('no longer casts organisation_id to ::uuid', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, name: 'Jane' }]);
    await PATCH(req(validBody), { params });
    expect(sqlCallText(0)).not.toMatch(/organisation_id =\s*::uuid/i);
  });

  it('still casts the contact row id to ::uuid (unchanged — that id is always UUID-shaped)', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, name: 'Jane' }]);
    await PATCH(req(validBody), { params });
    expect(sqlCallText(0)).toMatch(/id =\s*::uuid/i);
  });

  it('a cuid-shaped organisation id succeeds — the old cast would have thrown on syntax alone for this shape', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, name: 'Jane' }]);
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(200);
    expect(sqlCallArgs(0)).toContain(CUID_SHAPED_ORG_ID);
  });

  it('still returns 404 when no row matches', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(404);
  });

  it('still rejects a non-super_admin caller before any DB access', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/client-data/leads/[id] — TEXT organisation_id contract', () => {
  const PATCH = leadsPATCH;

  beforeEach(() => {
    requireRoleMock.mockReset();
    sqlMock.mockReset();
    requireRoleMock.mockResolvedValue(SUPER_ADMIN);
  });

  function req(body: unknown) {
    return asNextRequest(new Request(`http://localhost/api/admin/client-data/leads/${CONTACT_ROW_ID}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
  }
  const params = Promise.resolve({ id: CONTACT_ROW_ID });
  const validBody = { orgId: CUID_SHAPED_ORG_ID, status: 'contacted' };

  it('no longer casts organisation_id to ::uuid', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, status: 'contacted' }]);
    await PATCH(req(validBody), { params });
    expect(sqlCallText(0)).not.toMatch(/organisation_id =\s*::uuid/i);
  });

  it('still casts the lead row id to ::uuid (unchanged — that id is always UUID-shaped)', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, status: 'contacted' }]);
    await PATCH(req(validBody), { params });
    expect(sqlCallText(0)).toMatch(/id =\s*::uuid/i);
  });

  it('a cuid-shaped organisation id succeeds — the old cast would have thrown on syntax alone for this shape', async () => {
    sqlMock.mockResolvedValue([{ id: CONTACT_ROW_ID, status: 'contacted' }]);
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(200);
    expect(sqlCallArgs(0)).toContain(CUID_SHAPED_ORG_ID);
  });

  it('still returns 404 when no row matches', async () => {
    sqlMock.mockResolvedValue([]);
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(404);
  });

  it('still rejects a non-super_admin caller before any DB access', async () => {
    requireRoleMock.mockRejectedValue(new Error('Forbidden'));
    const res = await PATCH(req(validBody), { params });
    expect(res.status).toBe(403);
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
