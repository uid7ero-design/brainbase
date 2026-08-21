import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

function asNextRequest(req: Request): NextRequest {
  return req as unknown as NextRequest
}

const LD_TENNIS_ORG = 'ld-tennis-org-id'
const OTHER_ORG = 'some-other-org-id'

const requireRoleMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireRole: (...args: unknown[]) => requireRoleMock(...args),
}))

type SqlCall = { text: string; values: unknown[] }
let sqlCalls: SqlCall[] = []

// Scenario knobs, reset in beforeEach. contactRow models the current actual
// row (or null) in the in-memory "contacts" table — every handler below
// reads/mutates this single source of truth, so SELECTs always reflect
// whatever the most recent INSERT/UPDATE left behind (no call-counting).
let leadRow: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
// Only set by the dedicated race test: simulates a concurrent request
// having already inserted this exact row between our SELECT and our own
// INSERT, so our INSERT's ON CONFLICT DO NOTHING fires (0 rows returned)
// and the row it conflicted with becomes the current table state.
let raceWinnerRow: Record<string, unknown> | null = null

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  const text = strings.join('')
  sqlCalls.push({ text, values })

  if (text.includes('FROM tennis_leads')) {
    return Promise.resolve(leadRow ? [leadRow] : [])
  }
  if (text.includes('INSERT INTO contacts')) {
    if (raceWinnerRow) {
      contactRow = raceWinnerRow
      return Promise.resolve([]) // ON CONFLICT DO NOTHING fired
    }
    const inserted = { id: 'contact-new', name: values[1], email: values[2], phone: values[3], status: 'active' }
    contactRow = inserted
    return Promise.resolve([inserted])
  }
  if (text.includes('UPDATE contacts SET status')) {
    const updated = { ...(contactRow as Record<string, unknown>), status: 'active' }
    contactRow = updated
    return Promise.resolve([updated])
  }
  if (text.includes('FROM contacts')) {
    return Promise.resolve(contactRow ? [contactRow] : [])
  }
  if (text.includes('UPDATE tennis_leads SET status')) {
    return Promise.resolve([])
  }
  if (text.includes('INSERT INTO contact_journal')) {
    return Promise.resolve([{ id: 'journal-1' }])
  }
  return Promise.resolve([])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => Promise<unknown[]>)(...args),
}))

const { POST } = await import('@/app/api/leads/[id]/convert/route')

beforeEach(() => {
  sqlCalls = []
  sqlMock.mockClear()
  requireRoleMock.mockReset()
  leadRow = null
  contactRow = null
  raceWinnerRow = null
})

function postRequest(body: unknown = {}): NextRequest {
  return asNextRequest(new Request('http://localhost/api/leads/lead-1/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

function callsMatching(pattern: string): SqlCall[] {
  return sqlCalls.filter(c => c.text.includes(pattern))
}

const LEAD_NEW = { id: 'lead-1', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'new' }

describe('POST /api/leads/[id]/convert — no existing contact (fallback create)', () => {
  it('creates the contact from the canonical lead, active status, and promotes the lead to in_progress', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null // no existing row; INSERT will "succeed" per mock logic

    const res = await POST(postRequest(), params('lead-1'))
    expect(res.status).toBe(200)
    const json = await res.json()

    expect(json.success).toBe(true)
    expect(json.alreadyConverted).toBe(false)
    expect(json.contact.status).toBe('active')
    expect(json.contact.name).toBe('Jamie Client')
    expect(json.contact.email).toBe('jamie@example.com')
    expect(json.contact.phone).toBe('0400000000')
    expect(json.leadStatus).toBe('in_progress')

    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1)
    expect(callsMatching('UPDATE tennis_leads SET status')).toHaveLength(1)
    expect(callsMatching('INSERT INTO contact_journal')).toHaveLength(1)
  })

  it('the INSERT uses the server-side organisation id and the lead\'s own name/email/phone — never anything from the request body', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null

    await POST(postRequest({ organisation_id: 'attacker-org-id', name: 'Attacker Name' }), params('lead-1'))

    const [insertCall] = callsMatching('INSERT INTO contacts')
    expect(insertCall.values[0]).toBe(LD_TENNIS_ORG)
    expect(insertCall.values[1]).toBe('Jamie Client')
    expect(insertCall.values[2]).toBe('jamie@example.com')
    expect(insertCall.values[0]).not.toBe('attacker-org-id')
  })
})

describe('POST /api/leads/[id]/convert — existing non-active contact is promoted, not duplicated', () => {
  it('promotes an existing "lead"-status contact to active, and never inserts a second contact', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = { id: 'contact-1', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'lead' }

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.alreadyConverted).toBe(false)
    expect(json.contact.id).toBe('contact-1')
    expect(json.contact.status).toBe('active')

    expect(callsMatching('UPDATE contacts SET status')).toHaveLength(1)
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(0)
  })

  it('promotes an existing "contacted"-status contact to active', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW, status: 'contacted' }
    contactRow = { id: 'contact-2', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'contacted' }

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()
    expect(json.contact.status).toBe('active')
    expect(json.leadStatus).toBe('in_progress')
  })

  it('promotes an existing "inactive"-status contact to active (deliberate re-activation, not a new record)', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = { id: 'contact-3', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'inactive' }

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()
    expect(json.contact.id).toBe('contact-3')
    expect(json.contact.status).toBe('active')
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(0)
  })
})

describe('POST /api/leads/[id]/convert — idempotency', () => {
  it('a contact already at "active" is reported as already converted, with zero writes', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = { id: 'contact-4', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'active' }

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.alreadyConverted).toBe(true)
    expect(json.contact.id).toBe('contact-4')

    // No mutation of any kind on a second/no-op call
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(0)
    expect(callsMatching('UPDATE contacts SET status')).toHaveLength(0)
    expect(callsMatching('UPDATE tennis_leads SET status')).toHaveLength(0)
    expect(callsMatching('INSERT INTO contact_journal')).toHaveLength(0)
  })

  it('pressing convert twice in sequence never creates a second contact or a duplicate journal entry', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null

    const first = await POST(postRequest(), params('lead-1'))
    expect((await first.json()).alreadyConverted).toBe(false)

    const second = await POST(postRequest(), params('lead-1'))
    const secondJson = await second.json()
    expect(secondJson.alreadyConverted).toBe(true)

    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1)
    expect(callsMatching('INSERT INTO contact_journal')).toHaveLength(1)
  })

  it('a lost insert race against a concurrent conversion still reuses the winning row instead of duplicating', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null // first SELECT finds nothing
    raceWinnerRow = { id: 'contact-race', name: 'Jamie Client', email: 'jamie@example.com', phone: '0400000000', status: 'lead' }

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()

    expect(json.contact.id).toBe('contact-race')
    expect(json.contact.status).toBe('active')
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(1) // attempted, but conflicted (0 rows returned)
    expect(callsMatching('UPDATE contacts SET status')).toHaveLength(1) // promoted the winning row instead
  })
})

describe('POST /api/leads/[id]/convert — lead status transition rules', () => {
  it.each(['booked', 'closed', 'cancelled', 'in_progress'])('does not touch tennis_leads.status when it is already "%s"', async (status) => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW, status }
    contactRow = null

    const res = await POST(postRequest(), params('lead-1'))
    const json = await res.json()

    expect(callsMatching('UPDATE tennis_leads SET status')).toHaveLength(0)
    expect(json.leadStatus).toBe(status)
  })

  it('never sets tennis_leads.status to "booked" as a side effect of conversion', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null

    await POST(postRequest(), params('lead-1'))
    const [call] = callsMatching('UPDATE tennis_leads SET status')
    expect(call.text).not.toContain("'booked'")
  })
})

describe('POST /api/leads/[id]/convert — lead history is preserved', () => {
  it('never issues a DELETE against tennis_leads', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null

    await POST(postRequest(), params('lead-1'))
    expect(sqlCalls.some(c => c.text.includes('DELETE FROM tennis_leads'))).toBe(false)
  })
})

describe('POST /api/leads/[id]/convert — tenant safety', () => {
  it('requires authentication', async () => {
    requireRoleMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await POST(postRequest(), params('lead-1'))
    expect(res.status).toBe(401)
  })

  it('a lead id that does not belong to the caller\'s organisation resolves as not found, never converted', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u2', organisationId: OTHER_ORG, role: 'manager', name: 'Someone Else' })
    leadRow = null // simulates the org-scoped WHERE clause finding nothing for this org

    const res = await POST(postRequest(), params('someone-elses-lead'))
    expect(res.status).toBe(404)
    expect(callsMatching('FROM contacts')).toHaveLength(0)
    expect(callsMatching('INSERT INTO contacts')).toHaveLength(0)
  })

  it('the tennis_leads lookup is always scoped by session.organisationId, not any client-supplied value', async () => {
    requireRoleMock.mockResolvedValue({ userId: 'u1', organisationId: LD_TENNIS_ORG, role: 'manager', name: 'Luke' })
    leadRow = { ...LEAD_NEW }
    contactRow = null

    await POST(postRequest({ organisationId: 'attacker-org-id' }), params('lead-1'))

    const [leadCall] = callsMatching('FROM tennis_leads')
    expect(leadCall.values).toContain(LD_TENNIS_ORG)
    expect(leadCall.values).not.toContain('attacker-org-id')
  })
})

describe('Squad visibility — converted contact matches Squad\'s actual query/filter', () => {
  it('/dashboard/contacts (Squad) reads every contacts row for the org with no status filter, so a newly-active contact is visible immediately', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/contacts/page.tsx'), 'utf-8')
    expect(source).toContain('FROM contacts')
    expect(source).toContain('WHERE organisation_id = ${session.organisationId}')
    expect(source).not.toMatch(/WHERE organisation_id = \$\{session\.organisationId\}\s*AND status/)
  })

  it('ContactsClient\'s "Active" tab — the Squad-membership view — filters on status === "active", matching what conversion sets', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/contacts/ContactsClient.tsx'), 'utf-8')
    expect(source).toContain('c.status === "active"')
  })
})

describe('Preserved out of scope — Requests/client_pipeline, /tennis/book, and the canonical lead route are untouched', () => {
  it('the convert route never references client_pipeline, bookings, or pipeline_messages', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/convert/route.ts'), 'utf-8')
    expect(source).not.toContain('client_pipeline')
    expect(source).not.toContain('INSERT INTO bookings')
    expect(source).not.toContain('pipeline_messages')
  })

  it('app/api/lead/route.ts (the public LD Tennis enquiry endpoint) is unaffected by this feature', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    expect(source).toContain("INSERT INTO tennis_leads")
    expect(source).not.toContain('/convert')
  })
})
