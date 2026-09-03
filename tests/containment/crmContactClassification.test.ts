import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import type { NextRequest } from 'next/server'

// CRM contact classification — a generic, non-destructive classification
// field on the existing crm_contacts table (CLIENT/LEAD/EVENT_CONTACT/
// SUPPLIER/PARTNER/OTHER), NOT a second CRM, NOT a new identity concept.
// Events sets classification = EVENT_CONTACT only when it creates a
// BRAND-NEW contact; a contact matched to an existing row is never
// written to at all (that invariant predates this phase — see
// lib/crm/eventSync.ts / lib/crm/eventBackfill.ts's own headers — this
// phase only extends it to cover the new column, with zero new
// conditional logic). Classification is distinct from source: source
// stays exactly where it already lived, the informal `notes` marker
// ('Events / Event Booking' / 'Events / Historical Backfill') Events
// sync already wrote before this phase existed.
//
// One shared @/lib/db mock is used for every describe block below (vi.mock
// is hoisted and module-scoped — registering it more than once per file
// isn't meaningful), capturing both the literal SQL text AND the
// interpolated values array, since ${EVENT_CONTACT_CLASSIFICATION} is a
// value, not literal SQL text, and the plain text-only capture pattern
// used elsewhere in this test suite can't see it.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
// SQL files in this codebase use `--` line comments, not `//` — this
// migration's own extensive header prose legitimately mentions table
// names (event_orders, crm_deals, ...) in plain English explanation; only
// live SQL statements should be checked for what tables they touch.
function stripSqlComments(src: string): string {
  return src.replace(/--.*$/gm, '')
}

let calls: { text: string; values: unknown[] }[] = []
let responseQueue: (unknown[] | 'THROW')[] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  const next = responseQueue[callCount++]
  if (next === 'THROW') throw new Error('simulated DB failure')
  return Promise.resolve(next ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

function queue(...responses: (unknown[] | 'THROW')[]) { responseQueue = responses; callCount = 0; calls = [] }

const checkCapabilityMock = vi.fn()
const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    checkCapability: (...args: unknown[]) => checkCapabilityMock(...args),
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
  }
})

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

const { syncEventOrderContact } = await import('@/lib/crm/eventSync')
const { executeEventContactBackfill } = await import('@/lib/crm/eventBackfill')
const contactsRoute = await import('@/app/api/crm/contacts/route')
const contactsIdRoute = await import('@/app/api/crm/contacts/[id]/route')

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const SESSION = { userId: 'u1', organisationId: 'org-a', role: 'manager' }

beforeEach(() => {
  checkCapabilityMock.mockReset()
  requireCapabilityMock.mockReset()
  requireSessionMock.mockReset()
  sqlMock.mockClear()
  queue()
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
  requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
  requireSessionMock.mockResolvedValue(SESSION)
})

// ─────────────────────────────────────────────────────────────────────
// SCHEMA
// ─────────────────────────────────────────────────────────────────────

describe('SCHEMA — scripts/add-crm-contact-classification.sql', () => {
  const migrationSource = read('scripts/add-crm-contact-classification.sql')

  it('adds a nullable classification column with no default (existing rows must remain NULL)', () => {
    expect(migrationSource).toMatch(/ALTER TABLE crm_contacts ADD COLUMN IF NOT EXISTS classification TEXT;/)
    expect(migrationSource).not.toMatch(/classification TEXT[^;]*NOT NULL/)
    expect(migrationSource).not.toMatch(/classification TEXT[^;]*DEFAULT/)
  })

  it('the CHECK constraint vocabulary is exactly the six canonical values, nothing else, plus NULL', () => {
    const checkStart = migrationSource.indexOf('CHECK (classification')
    expect(checkStart).toBeGreaterThan(-1)
    const checkEnd = migrationSource.indexOf('));', checkStart) + 3
    const checkBody = migrationSource.slice(checkStart, checkEnd)
    for (const value of ['CLIENT', 'LEAD', 'EVENT_CONTACT', 'SUPPLIER', 'PARTNER', 'OTHER']) {
      expect(checkBody).toContain(`'${value}'`)
    }
    // No stray seventh value / no accidental duplicate.
    const matches = checkBody.match(/'[A-Z_]+'/g) ?? []
    expect(matches.length).toBe(6)
  })

  it('the CHECK constraint is added idempotently (existence-guarded DO block, matching add-events-crm-link.sql\'s own convention)', () => {
    expect(migrationSource).toMatch(/DO \$\$\s*\nBEGIN\s*\n\s*IF NOT EXISTS \(\s*\n\s*SELECT 1 FROM pg_constraint WHERE conname = 'crm_contacts_classification_check'/)
  })

  it('the index is tenant-scoped, organisation_id first', () => {
    expect(migrationSource).toContain('CREATE INDEX IF NOT EXISTS idx_crm_contacts_classification')
    expect(migrationSource).toContain('ON crm_contacts(organisation_id, classification)')
  })

  it('performs no UPDATE / backfill of any kind against crm_contacts', () => {
    expect(stripSqlComments(migrationSource)).not.toMatch(/UPDATE\s+crm_contacts/i)
  })

  it('the live SQL statements (comments stripped) never touch any other table (event_orders, crm_deals, crm_activities, crm_companies) — the header prose may mention them, but no DDL/DML does', () => {
    const code = stripSqlComments(migrationSource)
    for (const table of ['event_orders', 'crm_deals', 'crm_activities', 'crm_companies']) {
      expect(code).not.toContain(table)
    }
  })
})

describe('SCHEMA — lib/crm/classification.ts is the single canonical source', () => {
  const source = read('lib/crm/classification.ts')

  it('defines exactly the six values, matching the migration\'s CHECK constraint', () => {
    for (const value of ['CLIENT', 'LEAD', 'EVENT_CONTACT', 'SUPPLIER', 'PARTNER', 'OTHER']) {
      expect(source).toContain(`'${value}'`)
    }
  })

  it('is a pure, DB-agnostic data-layer module — no @/lib/db import, no sql usage', () => {
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(source).not.toMatch(/\bsql`/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// EVENT SYNC (lib/crm/eventSync.ts)
// ─────────────────────────────────────────────────────────────────────

describe('EVENT SYNC — syncEventOrderContact sets classification only on brand-new contacts', () => {
  it('matched-identity path: the INSERT branch\'s column list includes classification, and EVENT_CONTACT is among the interpolated values', async () => {
    queue([{ id: 'contact-1' }], [])
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null })
    expect(calls[0].text).toContain('classification')
    expect(calls[0].values).toContain('EVENT_CONTACT')
  })

  it('no-identity fallback path: also sets classification = EVENT_CONTACT (this branch always creates)', async () => {
    queue([{ id: 'contact-2' }], [])
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'No Contact Method', purchaserEmail: null, purchaserPhone: null })
    expect(calls[0].text).toContain('INSERT INTO crm_contacts')
    expect(calls[0].text).toContain('classification')
    expect(calls[0].values).toContain('EVENT_CONTACT')
  })

  it('the notes marker (\'Events / Event Booking\') is still written alongside classification — source stays independent, not replaced by classification', async () => {
    queue([{ id: 'contact-3' }], [])
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null })
    // The notes marker is literal SQL text (not an interpolated value),
    // classification is an interpolated value — the two live in the same
    // INSERT statement without one crowding out the other.
    expect(calls[0].text).toContain("'Events / Event Booking'")
    expect(calls[0].values).toContain('EVENT_CONTACT')
  })
})

describe('EVENT SYNC — source-text proof that a matched existing contact can never have its classification touched', () => {
  const source = read('lib/crm/eventSync.ts')

  it('the "existing" CTE (the match branch) only ever SELECTs c.id — no UPDATE, no classification assignment', () => {
    const start = source.indexOf('existing AS (')
    const end = source.indexOf('ins AS (', start)
    const existingCte = source.slice(start, end)
    expect(existingCte).toMatch(/SELECT c\.id/)
    expect(existingCte).not.toMatch(/UPDATE/i)
    expect(existingCte).not.toContain('classification')
  })

  it('EVENT_CONTACT_CLASSIFICATION (the actual value Events writes) is referenced exactly twice outside its own import — once per brand-new-row INSERT branch', () => {
    const withoutImportLine = source.split('\n').filter(l => !l.includes("from './classification'") && !l.trim().startsWith('//')).join('\n')
    const occurrences = (withoutImportLine.match(/EVENT_CONTACT_CLASSIFICATION/g) ?? []).length
    expect(occurrences).toBe(2)
  })

  it('both EVENT_CONTACT_CLASSIFICATION usages sit inside an INSERT INTO crm_contacts statement, never a bare UPDATE', () => {
    const matchedInsertBlock = source.slice(source.indexOf('ins AS ('), source.indexOf('SELECT id FROM existing'))
    expect(matchedInsertBlock).toContain('INSERT INTO crm_contacts')
    expect(matchedInsertBlock).toContain('EVENT_CONTACT_CLASSIFICATION')

    const fallbackStart = source.lastIndexOf('INSERT INTO crm_contacts')
    const fallbackBlock = source.slice(fallbackStart, source.indexOf('RETURNING id', fallbackStart))
    expect(fallbackBlock).toContain('EVENT_CONTACT_CLASSIFICATION')

    expect(source).not.toMatch(/UPDATE\s+crm_contacts[^;]*EVENT_CONTACT_CLASSIFICATION/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// BACKFILL (lib/crm/eventBackfill.ts)
// ─────────────────────────────────────────────────────────────────────

describe('BACKFILL — executeEventContactBackfill sets classification only on brand-new contacts', () => {
  it('a newly-created historical contact (0 matches) gets classification = EVENT_CONTACT and the outcome is created_new', async () => {
    queue(
      [{ id: 'order-1', purchaser_name: 'Alex Demo', purchaser_email: 'alex@example.invalid', purchaser_phone: null }],
      [{ match_count: 0, existing_id: null, created_id: 'contact-new-1' }],
      [{ id: 'order-1' }],
      [{ crm_contact_id: 'contact-new-1', total_cents: 0, currency: 'AUD', payment_status: 'NOT_REQUIRED', event_name: 'Fete', quantity: 1, organisation_id: 'org-a' }],
      [],
    )
    const result = await executeEventContactBackfill('org-a')
    expect(result.createdNew).toBe(1)
    expect(result.results[0].outcome).toBe('created_new')
    // The match/create compound statement is the 2nd sql call (1st is
    // the unlinked-orders lookup).
    expect(calls[1].text).toContain('INSERT INTO crm_contacts')
    expect(calls[1].text).toContain('classification')
    expect(calls[1].values).toContain('EVENT_CONTACT')
  })

  it('a linked-existing contact (1 match) is NOT written to — the outcome is linked_existing, and the same compound statement is used either way (match_count=1 means the WHERE cnt=0 guard blocks the DB-side INSERT; this proves the JS-side call shape stays identical regardless)', async () => {
    queue(
      [{ id: 'order-2', purchaser_name: 'Jamie Existing', purchaser_email: 'jamie@example.invalid', purchaser_phone: null }],
      [{ match_count: 1, existing_id: 'contact-existing-1', created_id: null }],
      [{ id: 'order-2' }],
      [{ crm_contact_id: 'contact-existing-1', total_cents: 0, currency: 'AUD', payment_status: 'NOT_REQUIRED', event_name: 'Fete', quantity: 1, organisation_id: 'org-a' }],
      [],
    )
    const result = await executeEventContactBackfill('org-a')
    expect(result.linkedExisting).toBe(1)
    expect(result.results[0]).toMatchObject({ outcome: 'linked_existing', contactId: 'contact-existing-1' })
    const crmContactsCalls = calls.filter(c => c.text.includes('crm_contacts'))
    expect(crmContactsCalls.length).toBe(1)
    expect(crmContactsCalls[0].text).not.toMatch(/UPDATE\s+crm_contacts/i)
  })
})

describe('BACKFILL — source-text proof that a matched existing contact can never have its classification touched', () => {
  const source = read('lib/crm/eventBackfill.ts')

  it('the "matches" CTE only ever SELECTs id/created_at — no UPDATE, no classification assignment', () => {
    const start = source.indexOf('matches AS (')
    const end = source.indexOf('match_count AS (', start)
    const matchesCte = source.slice(start, end)
    expect(matchesCte).toMatch(/SELECT c\.id, c\.created_at/)
    expect(matchesCte).not.toMatch(/UPDATE/i)
    expect(matchesCte).not.toContain('classification')
  })

  it('EVENT_CONTACT_CLASSIFICATION is referenced exactly once outside its own import — once, inside the single INSERT statement (this file also has a pre-existing, unrelated `BackfillClassification`/`classification` field on its own preview-row type, so this check is deliberately scoped to the specific imported constant, not the generic word)', () => {
    const withoutImportLine = source.split('\n').filter(l => !l.includes("from './classification'") && !l.trim().startsWith('//')).join('\n')
    const occurrences = (withoutImportLine.match(/EVENT_CONTACT_CLASSIFICATION/g) ?? []).length
    expect(occurrences).toBe(1)

    const insStart = source.indexOf('ins AS (')
    const insEnd = source.indexOf('RETURNING id', insStart)
    const insBody = source.slice(insStart, insEnd)
    expect(insBody).toContain('INSERT INTO crm_contacts')
    expect(insBody).toContain('EVENT_CONTACT_CLASSIFICATION')
  })

  it('this file still never UPDATEs crm_contacts at all (the pre-existing NON-OVERWRITE guarantee, extended, not replaced, by this phase)', () => {
    expect(source).not.toMatch(/UPDATE\s+crm_contacts/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// API — GET/POST /api/crm/contacts, PUT /api/crm/contacts/[id]
// ─────────────────────────────────────────────────────────────────────

describe('API — /api/crm/contacts classification handling', () => {
  it('POST accepts a valid classification and includes it in the INSERT', async () => {
    queue([{ id: 'c1', classification: 'EVENT_CONTACT' }])
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', classification: 'CLIENT' }),
    }))
    const res = await contactsRoute.POST(req)
    expect(res.status).toBe(201)
    expect(calls[0].text).toContain('classification')
    expect(calls[0].values).toContain('CLIENT')
  })

  it('POST accepts null/omitted classification as unclassified (no error)', async () => {
    queue([{ id: 'c1' }])
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe' }),
    }))
    const res = await contactsRoute.POST(req)
    expect(res.status).toBe(201)
    expect(calls[0].values).toContain(null)
  })

  it('POST rejects an invalid classification with 400, never reaching SQL', async () => {
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', classification: 'NOT_A_REAL_VALUE' }),
    }))
    const res = await contactsRoute.POST(req)
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('PUT accepts a valid classification and includes it in the UPDATE', async () => {
    queue([{ id: 'c1', classification: 'LEAD' }])
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts/c1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', classification: 'LEAD' }),
    }))
    const res = await contactsIdRoute.PUT(req, { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(200)
    expect(calls[0].text).toMatch(/classification\s*=/)
    expect(calls[0].values).toContain('LEAD')
  })

  it('PUT rejects an invalid classification with 400, never reaching SQL', async () => {
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts/c1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ first_name: 'Jane', last_name: 'Doe', classification: 'bogus' }),
    }))
    const res = await contactsIdRoute.PUT(req, { params: Promise.resolve({ id: 'c1' }) })
    expect(res.status).toBe(400)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('GET executes successfully end-to-end with a classification filter present (smoke check that the handler does not throw regardless of which conditional branch fires)', async () => {
    queue([])
    const req = asNextRequest(new Request('http://localhost/api/crm/contacts?classification=EVENT_CONTACT'))
    const res = await contactsRoute.GET(req)
    expect(res.status).toBe(200)
  })
})

// GET's classification filter builds its WHERE clause from conditionally
// assembled NESTED sql`` fragments (sql`AND ct.classification = ...` /
// sql`AND ct.classification IS NULL` / sql``, interpolated as
// ${classificationClause} into the outer query). The real driver
// (@neondatabase/serverless's neon(), see lib/db.ts) merges these
// fragments' own strings/values into the parent call — the same
// pre-existing pattern this route already used for ?companyId= before
// this phase touched it. The flat sqlMock used elsewhere in this file
// only captures each individual sql`` invocation's own literal strings/
// values; it cannot replicate the driver's fragment-merging, so it would
// see the classificationClause as an opaque, unresolved value rather
// than its expanded SQL. That structural gap — not a real ambiguity — is
// why the filter's actual SQL shape is proven by static source-text
// checks below instead of a live mocked call, matching this test
// suite's own established methodology (crmEventSyncPrivacy.test.ts) for
// claims a dumb pass-through mock cannot evaluate.
describe('API — GET /api/crm/contacts classification filter (static source-text proof; see comment above)', () => {
  const source = read('app/api/crm/contacts/route.ts')
  const getBody = source.slice(source.indexOf('export async function GET'), source.indexOf('export async function POST'))

  it('a valid classification value is filtered via an equality clause bound to the session organisation, never a raw string swap', () => {
    expect(getBody).toContain('isValidCrmContactClassification(classificationParam)')
    expect(getBody).toMatch(/classificationClause = sql`AND ct\.classification = \$\{classificationParam\}`/)
    expect(getBody).toMatch(/WHERE ct\.organisation_id = \$\{session\.organisationId\}/)
  })

  it('the UNCLASSIFIED sentinel filters for NULL, never as a literal string value', () => {
    expect(getBody).toMatch(/classificationParam === 'UNCLASSIFIED'/)
    expect(getBody).toMatch(/classificationClause = sql`AND ct\.classification IS NULL`/)
  })

  it('an invalid/unrecognized classification value falls through to the empty-fragment default — never interpolated into SQL, never a thrown error', () => {
    expect(getBody).toMatch(/let classificationClause = sql``/)
    expect(getBody).toMatch(/\} else if \(isValidCrmContactClassification\(classificationParam\)\) \{/)
  })

  it('the WHERE clause is always scoped by session.organisationId regardless of the classification filter — the classification clause is additive (AND-joined), never a replacement for the tenant scope', () => {
    expect(getBody).toMatch(/WHERE ct\.organisation_id = \$\{session\.organisationId\}[\s\S]*\$\{classificationClause\}/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// UI
// ─────────────────────────────────────────────────────────────────────

describe('UI — ClassificationBadge, ContactForm, contact list filter', () => {
  it('ClassificationBadge renders every canonical label (via the shared CRM_CONTACT_CLASSIFICATION_LABELS lookup, not its own duplicated strings) and handles null/undefined safely (no crash path, plain muted dash)', () => {
    const badgeSource = read('app/crm/_components/ClassificationBadge.tsx')
    expect(badgeSource).toContain('CRM_CONTACT_CLASSIFICATION_LABELS')
    expect(badgeSource).toMatch(/if \(!classification\)/)

    const labelsSource = read('lib/crm/classification.ts')
    for (const label of ['Client', 'Lead', 'Event Contact', 'Supplier', 'Partner', 'Other']) {
      expect(labelsSource).toContain(label)
    }
  })

  it('ClassificationBadge never imports from the Events-only UI primitives module', () => {
    const source = read('app/crm/_components/ClassificationBadge.tsx')
    expect(source).not.toMatch(/from ['"]@\/app\/events\/_components\/ui['"]/)
  })

  it('ContactForm exposes an Unclassified option plus all six canonical values', () => {
    const source = read('app/crm/_components/ContactForm.tsx')
    expect(source).toContain('Unclassified')
    expect(source).toContain('CRM_CONTACT_CLASSIFICATIONS')
    expect(source).not.toMatch(/<select[^>]*classification[^>]*required/)
  })

  it('the contact list page offers All/Unclassified plus all six canonical filter choices', () => {
    const source = read('app/crm/contacts/page.tsx')
    expect(source).toContain('ALL')
    expect(source).toContain('UNCLASSIFIED')
    expect(source).toContain('CRM_CONTACT_CLASSIFICATIONS')
  })

  it('the contact list page reuses the SAME crm_contacts-backed API — no new endpoint, no new table', () => {
    const source = read('app/crm/contacts/page.tsx')
    expect(source).toMatch(/fetch\(`\/api\/crm\/contacts/)
    expect(source).not.toMatch(/events-contacts|event-contacts-table/i)
  })

  it('the "Event Contacts" sidebar shortcut resolves to the existing contacts list with a query-param filter, not a new route', () => {
    const source = read('app/crm/_components/CrmSidebar.tsx')
    expect(source).toContain("'/crm/contacts?classification=EVENT_CONTACT'")
  })
})

// ─────────────────────────────────────────────────────────────────────
// PRIVACY (extends the existing boundary already proven for eventSync/eventBackfill)
// ─────────────────────────────────────────────────────────────────────

describe('PRIVACY — classification support introduces no registration-answer leakage', () => {
  it('lib/crm/classification.ts never references registration answers/questions', () => {
    const source = read('lib/crm/classification.ts')
    expect(source).not.toMatch(/event_registration_responses|event_registration_questions|question_label_snapshot|field_type_snapshot/)
  })

  it('the classification-column additions to eventSync.ts/eventBackfill.ts stay inside their existing INSERT-only, registration-answer-free boundary (both files\' own header comments legitimately NAME these tables while documenting their absence, so comments are stripped before checking for a live reference)', () => {
    for (const file of ['lib/crm/eventSync.ts', 'lib/crm/eventBackfill.ts']) {
      const source = stripComments(read(file))
      expect(source).not.toMatch(/event_registration_responses|event_registration_questions/)
    }
  })

  it('the classification API additions never reference registration answers', () => {
    for (const file of ['app/api/crm/contacts/route.ts', 'app/api/crm/contacts/[id]/route.ts']) {
      const source = read(file)
      expect(source).not.toMatch(/event_registration_responses|event_registration_questions|dietary|accessibility/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// SOURCE SEPARATION
// ─────────────────────────────────────────────────────────────────────

describe('SOURCE SEPARATION — the pre-existing notes marker stays independent of the new classification field', () => {
  it('eventSync.ts still writes the unchanged "Events / Event Booking" notes marker alongside (not instead of) classification', () => {
    const source = read('lib/crm/eventSync.ts')
    expect(source).toContain("'Events / Event Booking'")
  })

  it('eventBackfill.ts still writes the unchanged "Events / Historical Backfill" notes marker alongside (not instead of) classification', () => {
    const source = read('lib/crm/eventBackfill.ts')
    expect(source).toContain("'Events / Historical Backfill'")
  })

  it('no dedicated `source` column was introduced anywhere in this phase — deferred per the audit\'s own §C decision', () => {
    const migrationSource = read('scripts/add-crm-contact-classification.sql')
    expect(stripSqlComments(migrationSource)).not.toMatch(/ADD COLUMN[^;]*\bsource\b/i)
  })
})
