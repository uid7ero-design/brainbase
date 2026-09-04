import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import {
  computeClassificationEligibility,
  detectEventsNotesMarker,
} from '@/lib/crm/eventContactClassificationBackfill'

// Historical CRM contact classification — PREVIEW ONLY in this phase.
// Mirrors tests/containment/crmEventBackfill.test.ts's own established
// mock/auth pattern for the sibling /api/crm/events-backfill route
// family, rather than inventing a new one. Covers: (1) the pure
// eligibility/notes-marker functions directly, independent of any SQL;
// (2) the preview query's organisation scoping and zero-write
// guarantee via a mocked sql client; (3) the route's auth/capability
// gate; (4) static proofs that no execution/POST path exists anywhere
// yet, and that registration answers are never referenced; (5) the UI
// exposes only a Preview action, never Execute.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─────────────────────────────────────────────────────────────────────
// PURE FUNCTIONS — no SQL, no mocks
// ─────────────────────────────────────────────────────────────────────

describe('detectEventsNotesMarker', () => {
  it('matches "Events / Event Booking" at the start of notes', () => {
    expect(detectEventsNotesMarker('Events / Event Booking')).toBe('Events / Event Booking')
    expect(detectEventsNotesMarker('Events / Event Booking — some extra text')).toBe('Events / Event Booking')
  })

  it('matches "Events / Historical Backfill" at the start of notes', () => {
    expect(detectEventsNotesMarker('Events / Historical Backfill')).toBe('Events / Historical Backfill')
  })

  it('returns null for notes not starting with either marker, even if the text appears elsewhere', () => {
    expect(detectEventsNotesMarker('Called about renewal. Events / Event Booking mentioned in passing.')).toBeNull()
    expect(detectEventsNotesMarker('Unrelated note')).toBeNull()
  })

  it('returns null for null/empty notes', () => {
    expect(detectEventsNotesMarker(null)).toBeNull()
    expect(detectEventsNotesMarker('')).toBeNull()
  })
})

describe('computeClassificationEligibility — the exact three-tier priority', () => {
  it('NULL classification + valid notes marker + at least one live order link => eligible', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 1,
    })
    expect(result).toEqual({ eligible: true, skipReason: null })
  })

  it('CLIENT => ineligible, "already classified" wins over any other evidence, even strong evidence', () => {
    const result = computeClassificationEligibility({
      currentClassification: 'CLIENT',
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 3,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'already classified (CLIENT)' })
  })

  it('LEAD => ineligible, same as CLIENT', () => {
    const result = computeClassificationEligibility({
      currentClassification: 'LEAD',
      notesMarker: 'Events / Event Booking',
      linkedEventOrderCount: 1,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'already classified (LEAD)' })
  })

  it('an unrelated NULL contact (no marker, no order link) => ineligible, "no Events notes marker" (checked before the order-link tier)', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: null,
      linkedEventOrderCount: 0,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no Events notes marker' })
  })

  it('notes marker present but zero live order links => ineligible ("no linked event order found") — covers both "never linked" and "was linked, order/event since deleted"', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: 'Events / Historical Backfill',
      linkedEventOrderCount: 0,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no linked event order found' })
  })

  it('live order link present but no notes marker => ineligible ("no Events notes marker") — a matched/reused contact, or one whose notes were edited away', () => {
    const result = computeClassificationEligibility({
      currentClassification: null,
      notesMarker: null,
      linkedEventOrderCount: 2,
    })
    expect(result).toEqual({ eligible: false, skipReason: 'no Events notes marker' })
  })

  it('the function accepts no activity-count parameter at all — activity presence/absence structurally cannot affect eligibility', () => {
    // TypeScript already enforces this at the call site (no such field
    // exists on the input type); this test documents and locks that
    // shape so a future edit cannot silently add and start trusting it.
    const source = read('lib/crm/eventContactClassificationBackfill.ts')
    const fnStart = source.indexOf('export function computeClassificationEligibility')
    const fnSignatureEnd = source.indexOf('{', fnStart)
    const signature = source.slice(fnStart, fnSignatureEnd)
    expect(signature).not.toMatch(/activity/i)
  })
})

// ─────────────────────────────────────────────────────────────────────
// PREVIEW QUERY — mocked sql, organisation scoping + zero writes
// ─────────────────────────────────────────────────────────────────────

let calls: { text: string; values: unknown[] }[] = []
let responseQueue: (unknown[] | 'THROW' | { THROW_MESSAGE: string })[] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  const next = responseQueue[callCount++]
  if (next === 'THROW') throw new Error('simulated DB failure')
  if (typeof next === 'object' && next !== null && 'THROW_MESSAGE' in next) throw new Error((next as { THROW_MESSAGE: string }).THROW_MESSAGE)
  return Promise.resolve(next ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

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

function queue(...responses: (unknown[] | 'THROW' | { THROW_MESSAGE: string })[]) { responseQueue = responses; callCount = 0; calls = [] }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role, name: 'Staff One' } }

const { previewEventContactClassification, executeEventContactClassification } = await import('@/lib/crm/eventContactClassificationBackfill')
const route = await import('@/app/api/crm/events-backfill/classification/route')

function eligibleCandidate(overrides: Partial<{
  id: string; first_name: string; last_name: string; email: string | null;
  notes: string | null; classification: string | null;
  linked_order_count: number; event_activity_count: number;
}> = {}) {
  return {
    id: 'contact-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.invalid',
    notes: 'Events / Event Booking', classification: null,
    linked_order_count: 1, event_activity_count: 1,
    ...overrides,
  }
}

beforeEach(() => {
  sqlMock.mockClear()
  checkCapabilityMock.mockReset()
  requireCapabilityMock.mockReset()
  requireSessionMock.mockReset()
  queue()
  checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
  requireCapabilityMock.mockResolvedValue({ key: 'crm', config: {} })
  requireSessionMock.mockResolvedValue(sessionAs('admin'))
})

describe('previewEventContactClassification — organisation scoping', () => {
  it('every sub-query is scoped by organisationId — the linked-order count, the activity count, and the outer candidate WHERE clause', async () => {
    queue([{
      id: 'contact-1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.invalid',
      notes: 'Events / Event Booking', classification: null,
      linked_order_count: 1, event_activity_count: 1,
    }])
    await previewEventContactClassification('org-a')
    expect(calls).toHaveLength(1)
    const values = calls[0].values
    // organisationId is interpolated three times (linked-order subquery,
    // activity subquery, outer WHERE + its EXISTS clause) — every
    // occurrence must be the same tenant, never a different one.
    const orgOccurrences = values.filter(v => v === 'org-a')
    expect(orgOccurrences.length).toBeGreaterThanOrEqual(3)
    expect(values).not.toContain('org-b')
  })

  it('a different organisationId produces a query scoped to that org only — cross-tenant leakage is impossible by construction (the query has no OR/global branch)', async () => {
    queue([])
    await previewEventContactClassification('org-b')
    expect(calls[0].values.every(v => v !== 'org-a')).toBe(true)
    expect(calls[0].values).toContain('org-b')
  })

  it('returns crmEnabled: false and issues zero SQL calls when the crm capability is disabled', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, entitlement: null })
    const result = await previewEventContactClassification('org-a')
    expect(result).toEqual({ crmEnabled: false, totalCandidates: 0, eligibleCount: 0, rows: [] })
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('previewEventContactClassification — zero writes', () => {
  it('issues exactly one SQL statement, and it is a SELECT — no UPDATE/INSERT/DELETE anywhere', async () => {
    queue([])
    await previewEventContactClassification('org-a')
    expect(calls).toHaveLength(1)
    expect(calls[0].text.trim().toUpperCase().startsWith('SELECT')).toBe(true)
    expect(calls[0].text).not.toMatch(/UPDATE|INSERT|DELETE/i)
  })

  it('activity absence (event_activity_count = 0) does not block an otherwise-eligible row', async () => {
    queue([{
      id: 'contact-2', first_name: 'Alex', last_name: 'Roe', email: 'alex@example.invalid',
      notes: 'Events / Historical Backfill', classification: null,
      linked_order_count: 1, event_activity_count: 0,
    }])
    const result = await previewEventContactClassification('org-a')
    expect(result.rows[0].eligible).toBe(true)
    expect(result.rows[0].eventActivityCount).toBe(0)
  })

  it('maps a full row correctly end to end', async () => {
    queue([{
      id: 'contact-3', first_name: 'Sam', last_name: 'Lee', email: null,
      notes: 'Events / Event Booking', classification: null,
      linked_order_count: 2, event_activity_count: 1,
    }])
    const result = await previewEventContactClassification('org-a')
    expect(result).toEqual({
      crmEnabled: true,
      totalCandidates: 1,
      eligibleCount: 1,
      rows: [{
        contactId: 'contact-3', name: 'Sam Lee', email: null,
        currentClassification: null, notesMarker: 'Events / Event Booking',
        linkedEventOrderCount: 2, eventActivityCount: 1,
        eligible: true, skipReason: null,
      }],
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// executeEventContactClassification — the actual write path
// ─────────────────────────────────────────────────────────────────────

describe('executeEventContactClassification — eligible contacts are classified', () => {
  it('an eligible NULL contact (marker + live order link) is classified as EVENT_CONTACT, and the UPDATE/audit values are exactly right', async () => {
    queue(
      [eligibleCandidate()],
      [{ updated_id: 'contact-1' }],
    )
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.crmEnabled).toBe(true)
    expect(result.eligibleAtExecution).toBe(1)
    expect(result.updatedCount).toBe(1)
    expect(result.skippedCount).toBe(0)
    expect(result.updated).toEqual([{ contactId: 'contact-1', name: 'Jane Doe', outcome: 'updated' }])

    expect(calls).toHaveLength(2)
    const writeCall = calls[1]
    expect(writeCall.text).toMatch(/UPDATE\s+crm_contacts/i)
    expect(writeCall.text).toContain('classification IS NULL')
    expect(writeCall.values).toContain('EVENT_CONTACT')
    expect(writeCall.values).toContain('contact-1')
    expect(writeCall.values).toContain('org-a')
    expect(writeCall.values).toContain('actor-1')
    // The action/resource_type strings are literal SQL text (not
    // interpolated values), so they appear in .text, not .values.
    expect(writeCall.text).toContain('crm_contact.historical_classification_backfill')
  })

  it('CLIENT is never updated — zero write calls for a classified contact', async () => {
    queue([eligibleCandidate({ classification: 'CLIENT' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(result.skipped).toEqual([{ contactId: 'contact-1', name: 'Jane Doe', outcome: 'skipped_already_classified' }])
    expect(calls).toHaveLength(1) // candidate query only — no write attempted
  })

  it('LEAD is never updated', async () => {
    queue([eligibleCandidate({ classification: 'LEAD' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('SUPPLIER is never updated', async () => {
    queue([eligibleCandidate({ classification: 'SUPPLIER' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('PARTNER is never updated', async () => {
    queue([eligibleCandidate({ classification: 'PARTNER' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('OTHER is never updated', async () => {
    queue([eligibleCandidate({ classification: 'OTHER' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(calls).toHaveLength(1)
  })

  it('a marker-only contact (no live order link) is skipped, no write attempted', async () => {
    queue([eligibleCandidate({ linked_order_count: 0 })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(result.skipped).toEqual([{ contactId: 'contact-1', name: 'Jane Doe', outcome: 'skipped_no_order_link' }])
    expect(calls).toHaveLength(1)
  })

  it('a link-only contact (no notes marker) is skipped, no write attempted', async () => {
    queue([eligibleCandidate({ notes: 'Unrelated note' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(result.skipped).toEqual([{ contactId: 'contact-1', name: 'Jane Doe', outcome: 'skipped_no_marker' }])
    expect(calls).toHaveLength(1)
  })

  it('cross-tenant is impossible — the write statement is scoped to the same organisationId as the candidate query, never a different one', async () => {
    queue(
      [eligibleCandidate()],
      [{ updated_id: 'contact-1' }],
    )
    await executeEventContactClassification('org-b', 'actor-1')
    const writeCall = calls[1]
    expect(writeCall.values).toContain('org-b')
    expect(writeCall.values).not.toContain('org-a')
  })

  it('returns crmEnabled: false and issues zero SQL calls when the crm capability is disabled', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, entitlement: null })
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result).toEqual({ crmEnabled: false, eligibleAtExecution: 0, updatedCount: 0, skippedCount: 0, updated: [], skipped: [] })
    expect(sqlMock).not.toHaveBeenCalled()
  })
})

describe('executeEventContactClassification — stale-preview / concurrency safety', () => {
  it('a contact eligible at query time but no longer NULL when the guarded UPDATE actually runs (classified by someone else in the gap) is reported as skipped_stale — no audit row, because the audit INSERT is chained FROM the UPDATE\'s own RETURNING', async () => {
    queue(
      [eligibleCandidate()],
      [{ updated_id: null }], // RETURNING yielded nothing — the WHERE classification IS NULL guard did not match
    )
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(result.eligibleAtExecution).toBe(1) // it WAS eligible per the candidate query
    expect(result.skipped).toEqual([{ contactId: 'contact-1', name: 'Jane Doe', outcome: 'skipped_stale' }])
    // Exactly one write attempt was made (the guarded compound statement)
    // — there is no separate audit-insert call to assert "didn't happen"
    // because it's the SAME statement; its own RETURNING already proves
    // nothing was inserted.
    expect(calls).toHaveLength(2)
  })

  it('a thrown error on one contact is caught and reported as failed, without aborting the rest of the batch', async () => {
    queue(
      [eligibleCandidate({ id: 'contact-1' }), eligibleCandidate({ id: 'contact-2' })],
      'THROW',
      [{ updated_id: 'contact-2' }],
    )
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.skipped.find(s => s.contactId === 'contact-1')?.outcome).toBe('failed')
    expect(result.updated.find(u => u.contactId === 'contact-2')).toBeDefined()
  })

  // Reproduces the actual Production incident: audit_logs previously had
  // no `detail` column, so every write's compound CTE (UPDATE + audit
  // INSERT, one atomic statement) failed with a real Postgres error the
  // instant it reached the DB — before anything could commit. This is
  // exactly what the Neon HTTP driver surfaces as a thrown exception,
  // caught per-contact, never a top-level 500 — so the route still
  // returned HTTP 200 with eligibleAtExecution=N, updatedCount=0,
  // skippedCount=N (all 'failed'), which is precisely what was observed.
  it('a Postgres schema-mismatch error (e.g. an invalid column in the audit INSERT) is caught, surfaces its real message on the row, and updatedCount stays 0 — never a top-level throw', async () => {
    queue(
      [eligibleCandidate()],
      { THROW_MESSAGE: 'column "detail" of relation "audit_logs" does not exist' },
    )
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.eligibleAtExecution).toBe(1)
    expect(result.updatedCount).toBe(0)
    expect(result.skippedCount).toBe(1)
    expect(result.skipped).toEqual([{
      contactId: 'contact-1',
      name: 'Jane Doe',
      outcome: 'failed',
      error: 'column "detail" of relation "audit_logs" does not exist',
    }])
  })

  it('POST still returns HTTP 200 (never a top-level 500) even when every eligible write fails — the per-contact catch means the route always has a well-formed result to return', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin', 'org-a'))
    queue(
      [eligibleCandidate()],
      { THROW_MESSAGE: 'column "detail" of relation "audit_logs" does not exist' },
    )
    const res = await route.POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, eligibleAtExecution: 1, updatedCount: 0, skippedCount: 1 })
    expect(body.skipped[0].outcome).toBe('failed')
    expect(body.skipped[0].error).toContain('audit_logs')
  })
})

describe('the guarded UPDATE+audit CTE matches the REAL audit_logs schema (prisma/schema.prisma\'s AuditLog model) — not a schema the test harness invented', () => {
  const src = read('lib/crm/eventContactClassificationBackfill.ts')
  const insertIdx = src.indexOf('INSERT INTO audit_logs')
  const auditBlock = src.slice(insertIdx, src.indexOf('RETURNING id', insertIdx))

  it('never references a `detail` column in live code — audit_logs has no such column in Production (it has before_state/after_state); the module\'s own header comment legitimately NAMES the old, wrong column while documenting the incident, so comments are stripped before checking for a live reference', () => {
    expect(stripComments(src)).not.toContain('detail')
  })

  it('inserts the real AuditLog columns: id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state', () => {
    expect(auditBlock).toMatch(/INSERT INTO audit_logs \(id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state\)/)
  })

  it('supplies id explicitly via crypto.randomUUID() — this table has no DB-level default for id (cuid() is a Prisma client-side default only), matching the already-live lib/events/auditLog.ts writer', () => {
    expect(auditBlock).toContain('crypto.randomUUID()')
  })

  it('the schema this module writes to matches prisma/schema.prisma\'s AuditLog model field-for-field (id, organisation_id, user_id, action, resource_type, resource_id, before_state, after_state — no `detail`)', () => {
    const schemaSrc = read('prisma/schema.prisma')
    const modelStart = schemaSrc.indexOf('model AuditLog {')
    const modelEnd = schemaSrc.indexOf('\n}', modelStart)
    const model = schemaSrc.slice(modelStart, modelEnd)
    for (const field of ['id', 'organisation_id', 'user_id', 'action', 'resource_type', 'resource_id', 'before_state', 'after_state']) {
      expect(model, `AuditLog model must still define ${field}`).toMatch(new RegExp(`\\b${field}\\b`))
    }
    expect(model).not.toMatch(/\bdetail\b/)
  })
})

// Reproduces the SECOND Production incident: after the audit_logs
// schema fix (above) deployed, a real controlled execution still
// failed every row with "could not determine data type of parameter
// $8". Root cause: this table's own PREPARE/EXECUTE proof (scripts/
// tests/verify-crm-event-contact-classification-execute.sh) empirically
// confirmed jsonb_build_object(...) — declared VARIADIC "any" — gives
// Postgres's parser nothing to resolve a bare bound parameter against,
// so any placeholder passed directly as one of its arguments (with no
// cast) fails PARSE ANALYSIS under the extended query protocol, which
// is exactly how the Neon driver sends this statement (genuine bound
// parameters, never literal-substituted SQL text). Every other
// parameter in this statement sits in a directly-typed context (column
// assignment, column comparison, or an INSERT...SELECT target-list
// position) and resolves fine — only the two values passed straight
// into jsonb_build_object(...) needed an explicit cast. A disposable-
// Postgres harness that only ever substitutes literals into the SQL
// text (this file's OWN previous approach) cannot catch this class of
// bug either — a literal like 'EVENT_CONTACT' always has an inferable
// type, a bound placeholder in the same position does not. This is a
// source-level, driver-semantics-adjacent proof; the authoritative
// real-Postgres proof (a genuine PREPARE with no explicit parameter
// type list, mirroring the extended query protocol's unspecified-type
// Parse step) lives in the .sh harness referenced above.
describe('the two jsonb_build_object(...) arguments are explicitly ::text-cast — closes "could not determine data type of parameter $8"', () => {
  const src = read('lib/crm/eventContactClassificationBackfill.ts')
  const insertIdx = src.indexOf('INSERT INTO audit_logs')
  const auditBlock = src.slice(insertIdx, src.indexOf('RETURNING id', insertIdx))
  const jsonbIdx = auditBlock.indexOf('jsonb_build_object(')
  const jsonbBlock = auditBlock.slice(jsonbIdx)

  it('the new_classification value is ${EVENT_CONTACT_CLASSIFICATION}::text, not a bare interpolation', () => {
    expect(jsonbBlock).toContain('${EVENT_CONTACT_CLASSIFICATION}::text')
  })

  it('the notes_marker value is ${notesMarker}::text, not a bare interpolation', () => {
    expect(jsonbBlock).toContain('${notesMarker}::text')
  })

  it('every other interpolation in the whole statement (classification target, ids, org scoping, actor) remains uncast — this fix is scoped to exactly the two parameters that actually need it, per the harness\'s own empirical PREPARE proof, not a blanket cast', () => {
    // Exactly 9 total interpolations across the WHOLE compound
    // statement (matches the harness's own extracted, ground-truth
    // parameter count: $1..$9) — only 2 of them (both inside
    // jsonb_build_object, the two nested "any"-typed function
    // arguments) carry a ::text suffix.
    const cteStart = src.indexOf('WITH upd AS (')
    const cteEnd = src.indexOf('AS updated_id', cteStart) + 'AS updated_id'.length
    const fullCte = src.slice(cteStart, cteEnd)
    const allInterpolations = [...fullCte.matchAll(/\$\{[^}]*\}(::\w+)?/g)]
    expect(allInterpolations.length).toBe(9)
    const castCount = allInterpolations.filter(m => m[1] === '::text').length
    expect(castCount).toBe(2)
  })

  it('the UPDATE\'s own ${EVENT_CONTACT_CLASSIFICATION} (the SET target, a directly-typed column-assignment context) is deliberately left uncast — only the jsonb_build_object arguments needed the fix', () => {
    const updateBlock = src.slice(src.indexOf('UPDATE crm_contacts'), src.indexOf('RETURNING id'))
    expect(updateBlock).toContain('SET classification = ${EVENT_CONTACT_CLASSIFICATION}')
    expect(updateBlock).not.toContain('${EVENT_CONTACT_CLASSIFICATION}::text')
  })
})

describe('executeEventContactClassification — idempotency', () => {
  it('re-running against a contact whose classification the candidate query now reports as EVENT_CONTACT (i.e. already updated by a prior run) updates zero rows', async () => {
    queue([eligibleCandidate({ classification: 'EVENT_CONTACT' })])
    const result = await executeEventContactClassification('org-a', 'actor-1')
    expect(result.updatedCount).toBe(0)
    expect(result.skipped[0].outcome).toBe('skipped_already_classified')
    expect(calls).toHaveLength(1) // only the read-only candidate query — no write attempted at all
  })
})

// ─────────────────────────────────────────────────────────────────────
// ROUTE — auth/capability gate
// ─────────────────────────────────────────────────────────────────────

describe('GET /api/crm/events-backfill/classification — authorization', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await route.GET()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager (below admin) -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin without the events capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'events') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin without the crm capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'crm') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.GET()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin+ with both capabilities succeeds and returns the preview body', async () => {
    queue([])
    const res = await route.GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.crmEnabled).toBe(true)
  })

  it('super_admin also passes the role check (role hierarchy)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('super_admin'))
    queue([])
    const res = await route.GET()
    expect(res.status).toBe(200)
  })

  it('organisation_id used for the preview comes only from the session, never from any request input — the route function takes no request/query parameter at all', async () => {
    const src = read('app/api/crm/events-backfill/classification/route.ts')
    expect(src).toMatch(/export async function GET\(\)/)
    expect(src).not.toMatch(/req\.|request\.|searchParams|nextUrl/)
    expect(src).toContain('auth.session.organisationId')
  })
})

describe('POST /api/crm/events-backfill/classification — authorization (same gate as GET)', () => {
  it('unauthenticated -> 401, no DB call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await route.POST()
    expect(res.status).toBe(401)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('manager (below admin) -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('manager'))
    const res = await route.POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('viewer -> 403, no DB call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await route.POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin without the events capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'events') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin without the crm capability -> 403, no DB call', async () => {
    requireCapabilityMock.mockImplementation(async (_org: string, key: string) => {
      if (key === 'crm') throw new Error('Forbidden')
      return { key, config: {} }
    })
    const res = await route.POST()
    expect(res.status).toBe(403)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('admin+ with both capabilities executes and returns the expected summary shape, using the session\'s own userId as actor', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin', 'org-a'))
    queue(
      [eligibleCandidate()],
      [{ updated_id: 'contact-1' }],
    )
    const res = await route.POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ success: true, crmEnabled: true, eligibleAtExecution: 1, updatedCount: 1, skippedCount: 0 })
    const writeCall = calls[calls.length - 1]
    expect(writeCall.values).toContain('staff-1') // sessionAs()'s own userId — the actor, never client-supplied
  })

  it('super_admin also passes the role check (role hierarchy)', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('super_admin'))
    queue([])
    const res = await route.POST()
    expect(res.status).toBe(200)
  })
})

// ─────────────────────────────────────────────────────────────────────
// STATIC — execution path shape and safety
// ─────────────────────────────────────────────────────────────────────

describe('Execution path — static shape', () => {
  it('the route file exports both GET and POST', () => {
    const src = read('app/api/crm/events-backfill/classification/route.ts')
    expect(src).toMatch(/export async function GET/)
    expect(src).toMatch(/export async function POST/)
  })

  it('POST takes no parameter at all — no request body is ever parsed, so no client-supplied field (organisationId, candidate IDs, classification value) can influence it', () => {
    const src = read('app/api/crm/events-backfill/classification/route.ts')
    const postStart = src.indexOf('export async function POST')
    const postBody = src.slice(postStart, src.indexOf('\n}', postStart))
    expect(postBody).toMatch(/export async function POST\(\)/)
    expect(postBody).not.toMatch(/\.json\(\)|req\.|request\.|searchParams|nextUrl/)
    expect(postBody).toContain('auth.session.organisationId')
    expect(postBody).toContain('auth.session.userId')
  })

  it('executeEventContactClassification accepts only organisationId and actorUserId — no candidate-id list, no classification override', () => {
    const source = read('lib/crm/eventContactClassificationBackfill.ts')
    const fnStart = source.indexOf('export async function executeEventContactClassification')
    const fnSignatureEnd = source.indexOf('{', source.indexOf(')', fnStart))
    const signature = source.slice(fnStart, fnSignatureEnd)
    expect(signature).toContain('organisationId: string')
    expect(signature).toContain('actorUserId: string')
    expect(signature).not.toMatch(/contactIds|candidateIds|classification\s*:/i)
  })

  it('the only UPDATE anywhere in the library module targets crm_contacts guarded by "classification IS NULL", and the only INSERT targets audit_logs — never an unguarded contact write', () => {
    const src = read('lib/crm/eventContactClassificationBackfill.ts')
    const updateMatches = [...src.matchAll(/UPDATE\s+crm_contacts/gi)]
    expect(updateMatches.length).toBe(1)
    const updateIdx = updateMatches[0].index ?? 0
    const updateBlock = src.slice(updateIdx, src.indexOf('RETURNING id', updateIdx))
    expect(updateBlock).toContain('classification IS NULL')

    const insertMatches = [...src.matchAll(/INSERT INTO (\w+)/g)]
    expect(insertMatches.map(m => m[1])).toEqual(['audit_logs'])
    expect(src).not.toMatch(/INSERT INTO crm_contacts/i)
    expect(src).not.toMatch(/DELETE FROM/i)
  })

  it('the audit INSERT is chained FROM the guarded UPDATE\'s own CTE (via "FROM upd") — it structurally cannot fire unless the UPDATE actually affected a row', () => {
    const src = read('lib/crm/eventContactClassificationBackfill.ts')
    const insertIdx = src.indexOf('INSERT INTO audit_logs')
    const auditBlock = src.slice(insertIdx, src.indexOf('RETURNING id', insertIdx))
    expect(auditBlock).toMatch(/FROM upd/)
  })

  it('the audit action/resource_type are exactly the specified values', () => {
    const src = read('lib/crm/eventContactClassificationBackfill.ts')
    expect(src).toContain("'crm_contact.historical_classification_backfill'")
    expect(src).toContain("'crm_contact'")
  })
})

describe('Registration answers are never referenced', () => {
  it('neither the library module nor the route references event_registration_responses/questions or any attendee-answer field in live code (both files\' own comments legitimately NAME these tables while documenting their absence, so comments are stripped before checking for a live reference)', () => {
    for (const file of [
      'lib/crm/eventContactClassificationBackfill.ts',
      'app/api/crm/events-backfill/classification/route.ts',
    ]) {
      const src = stripComments(read(file))
      expect(src).not.toMatch(/event_registration_responses|event_registration_questions|dietary|accessibility/i)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// UI — Preview + guarded Execute
// ─────────────────────────────────────────────────────────────────────

describe('app/crm/events-backfill/page.tsx — classification section: preview + guarded execute', () => {
  const pageSrc = read('app/crm/events-backfill/page.tsx')

  it('adds the "Classify existing Events contacts" section with a Preview action', () => {
    expect(pageSrc).toContain('Classify existing Events contacts')
    expect(pageSrc).toContain('runClassificationPreview')
    expect(pageSrc).toContain("fetch('/api/crm/events-backfill/classification')")
  })

  it('states plainly that previewing alone makes no changes', () => {
    expect(pageSrc).toMatch(/This preview makes no changes/)
  })

  it('runClassificationExecute has its own POST call and confirm() dialog, bounded precisely to its own function body (not the pre-existing order-linking runExecute() defined elsewhere in the same component)', () => {
    const fnStart = pageSrc.indexOf('async function runClassificationExecute')
    const fnEnd = pageSrc.indexOf('async function runPreview')
    expect(fnStart).toBeGreaterThan(-1)
    expect(fnEnd).toBeGreaterThan(fnStart)
    const fnBody = pageSrc.slice(fnStart, fnEnd)
    expect(fnBody).toContain('confirm(')
    expect(fnBody).toMatch(/method:\s*'POST'/)
    expect(fnBody).toContain("fetch('/api/crm/events-backfill/classification'")
    // Does not call into (or reuse) the pre-existing order-linking
    // handler — a genuinely separate flow, not a wrapper around it.
    expect(fnBody).not.toMatch(/\brunExecute\(/)
  })

  it('the JSX renders an Execute button wired to runClassificationExecute', () => {
    expect(pageSrc).toMatch(/onClick=\{runClassificationExecute\}/)
  })

  it('the Execute button is only rendered when eligibleCount > 0', () => {
    const executeButtonIdx = pageSrc.indexOf('runClassificationExecute} disabled')
    const guardWindow = pageSrc.slice(Math.max(0, executeButtonIdx - 300), executeButtonIdx)
    expect(guardWindow).toContain('classificationPreview.eligibleCount > 0')
  })

  it('the confirm dialog text mentions the count, that eligibility is re-checked server-side, and that existing classifications are never overwritten', () => {
    const confirmIdx = pageSrc.indexOf('const summary =')
    const confirmText = pageSrc.slice(confirmIdx, pageSrc.indexOf('if (!confirm(summary))'))
    expect(confirmText).toMatch(/eligibleCount/)
    expect(confirmText).toMatch(/re-check/i)
    expect(confirmText).toMatch(/never overwritten|never changed|not overwritten/i)
  })

  it('after execution, updated/skipped counts are displayed and the preview is automatically refreshed', () => {
    const executeStart = pageSrc.indexOf('async function runClassificationExecute')
    const executeEnd = pageSrc.indexOf('async function runPreview')
    const executeFn = pageSrc.slice(executeStart, executeEnd)
    expect(executeFn).toContain('setClassificationExecution(body)')
    expect(executeFn).toContain('runClassificationPreview()')
    expect(pageSrc).toContain('classificationExecution.updatedCount')
    expect(pageSrc).toContain('classificationExecution.skippedCount')
  })

  it('renders the requested columns: Contact, Email, Current classification, Events evidence, Linked orders, Activities, Status', () => {
    for (const column of ['Contact', 'Email', 'Current classification', 'Events evidence', 'Linked orders', 'Activities', 'Status']) {
      expect(pageSrc).toContain(column)
    }
  })

  // Closes the diagnostic gap found in the Production incident: the
  // sibling order-linking execution summary already rendered its own
  // per-row failed outcomes with the real error message (see its own
  // 'Failed' summary row + table further up this file), but the
  // classification execution summary only ever showed aggregate counts
  // — an operator saw "Skipped: 7" with no way to see WHY any of them
  // failed, even though the API response already carried the real
  // Postgres error message on each failed row.
  it('the classification execution summary renders a per-contact table of failed outcomes with their real error message, mirroring the sibling order-linking execution summary', () => {
    const execIdx = pageSrc.indexOf('{classificationExecution && (')
    const execEnd = pageSrc.indexOf('classificationPreview && !classificationPreview.crmEnabled')
    const execBlock = pageSrc.slice(execIdx, execEnd)
    expect(execBlock).toContain("classificationExecution.skipped.some(r => r.outcome === 'failed')")
    expect(execBlock).toContain("classificationExecution.skipped.filter(r => r.outcome === 'failed')")
    expect(execBlock).toContain('r.error')
  })
})
