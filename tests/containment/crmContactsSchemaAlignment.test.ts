import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';

// Clients 2.0 Phase A (F.7S) — app/api/crm/contacts/route.ts and
// app/api/crm/contacts/[id]/route.ts read/wrote six columns
// (coaching_type, date_of_birth, emergency_contact_name,
// emergency_contact_phone, guardian_name, guardian_phone) that do not
// exist on the canonical crm_contacts table (scripts/crm-migrate.mjs).
// These are LD-Tennis/coaching-vertical fields that exist (in a
// still-pending-migration form) on the separate, vertical-specific
// `contacts` table used by app/api/contacts/[id]/route.ts — they leaked
// into the generic, tenant-facing CRM's insert/update statements during
// the CRM restoration. Any CRM contact create/update that actually
// populated one of these fields would throw a SQL "column does not
// exist" error in Production.
//
// Per F.7R's own finding and this phase's explicit instruction ("generic
// CRM must remain generic... do not add coaching/tennis fields to
// crm_contacts merely to make the broken route compile/work"), the fix
// removes the six fields from both routes and from the CRM contact form
// (app/crm/_components/ContactForm.tsx) rather than inventing a schema
// migration for them.

const VERTICAL_ONLY_FIELDS = [
  'coaching_type', 'date_of_birth', 'emergency_contact_name',
  'emergency_contact_phone', 'guardian_name', 'guardian_phone',
];

describe('crm_contacts canonical schema (scripts/crm-migrate.mjs)', () => {
  const migrationSource = fs.readFileSync(
    path.resolve(__dirname, '../../scripts/crm-migrate.mjs'),
    'utf-8',
  );

  function crmContactsCreateTableBody(): string {
    const start = migrationSource.indexOf('CREATE TABLE IF NOT EXISTS crm_contacts');
    expect(start, 'expected to find the crm_contacts CREATE TABLE statement').toBeGreaterThan(-1);
    const end = migrationSource.indexOf(')`);', start);
    return migrationSource.slice(start, end);
  }

  it('does not define any of the six vertical-only fields', () => {
    const body = crmContactsCreateTableBody();
    for (const field of VERTICAL_ONLY_FIELDS) {
      expect(body, `crm_contacts should not define ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('defines exactly the legitimate generic contact columns', () => {
    const body = crmContactsCreateTableBody();
    for (const col of ['id', 'organisation_id', 'company_id', 'first_name', 'last_name', 'email', 'phone', 'job_title', 'notes', 'created_by', 'created_at', 'updated_at']) {
      expect(body, `crm_contacts should define ${col}`).toMatch(new RegExp(`\\b${col}\\b`));
    }
  });
});

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest;
}

const requireSessionMock = vi.fn();
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>();
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) };
});

const requireCapabilityMock = vi.fn();
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>();
  return { ...actual, requireCapability: (...args: unknown[]) => requireCapabilityMock(...args) };
});

const sqlMock = vi.fn();
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => sqlMock(...args),
}));

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager' };

function sqlCallText(index: number): string {
  const args = sqlMock.mock.calls[index] as unknown[];
  return (args[0] as TemplateStringsArray).join(' ');
}

const contactsRoute = await import('@/app/api/crm/contacts/route');
const contactsIdRoute = await import('@/app/api/crm/contacts/[id]/route');

describe('POST/PUT /api/crm/contacts — request body / SQL no longer reference vertical-only fields', () => {
  beforeEach(() => {
    requireSessionMock.mockReset();
    requireCapabilityMock.mockReset();
    sqlMock.mockReset();
    requireSessionMock.mockResolvedValue(SESSION);
    requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} });
  });

  it('POST insert SQL does not reference any of the six vertical-only fields', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', first_name: 'Jane', last_name: 'Doe' }]);
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }),
    }));
    await contactsRoute.POST(req);
    const text = sqlCallText(0);
    for (const field of VERTICAL_ONLY_FIELDS) {
      expect(text).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('POST still accepts and inserts the legitimate generic fields', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', first_name: 'Jane', last_name: 'Doe' }]);
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', job_title: 'CFO' }),
    }));
    const res = await contactsRoute.POST(req);
    expect(res.status).toBe(201);
    expect(sqlCallText(0)).toMatch(/first_name/);
    expect(sqlCallText(0)).toMatch(/job_title/);
  });

  it('POST silently ignores stale vertical-only fields in the request body rather than erroring (defense-in-depth for cached/old clients)', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', first_name: 'Jane', last_name: 'Doe' }]);
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', guardian_name: 'stale field', coaching_type: 'PRIVATE' }),
    }));
    const res = await contactsRoute.POST(req);
    expect(res.status).toBe(201);
    const text = sqlCallText(0);
    for (const field of VERTICAL_ONLY_FIELDS) {
      expect(text).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('PUT update SQL does not reference any of the six vertical-only fields', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', first_name: 'Jane', last_name: 'Doe' }]);
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }),
    }));
    const params = Promise.resolve({ id: 'c1' });
    await contactsIdRoute.PUT(req, { params });
    const text = sqlCallText(0);
    for (const field of VERTICAL_ONLY_FIELDS) {
      expect(text).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('PUT still updates the legitimate generic fields and enforces tenant scoping', async () => {
    sqlMock.mockResolvedValue([{ id: 'c1', first_name: 'Jane', last_name: 'Doe' }]);
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts/c1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', notes: 'VIP' }),
    }));
    const params = Promise.resolve({ id: 'c1' });
    const res = await contactsIdRoute.PUT(req, { params });
    expect(res.status).toBe(200);
    expect(sqlCallText(0)).toMatch(/notes/);
    expect(sqlCallText(0)).toMatch(/organisation_id/);
  });
});

describe('app/crm/_components/ContactForm.tsx — no longer offers vertical-only fields the API silently drops', () => {
  const formSource = fs.readFileSync(
    path.resolve(__dirname, '../../app/crm/_components/ContactForm.tsx'),
    'utf-8',
  );

  it('does not reference any of the six vertical-only fields', () => {
    for (const field of VERTICAL_ONLY_FIELDS) {
      expect(formSource, `ContactForm.tsx should not reference ${field}`).not.toMatch(new RegExp(`\\b${field}\\b`));
    }
  });

  it('still renders the legitimate generic fields', () => {
    for (const field of ['first_name', 'last_name', 'email', 'phone', 'job_title', 'company_id', 'notes']) {
      expect(formSource).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});
