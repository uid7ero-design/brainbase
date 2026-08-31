import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase 5 — Events -> CRM contact/activity sync (lib/crm/eventSync.ts).
// Proves: (1) the pure normalization/name-splitting helpers behave
// exactly as documented, (2) syncEventOrderContact/
// recordEventBookingActivity are best-effort — a DB failure or CRM
// being disabled never throws, (3) neither function ever references a
// registration-question answer anywhere in its own source, and (4) the
// three real call sites (free registration, paid checkout, Stripe
// webhook handlers) invoke CRM sync AFTER their own booking
// transaction/UPDATE has already committed, never from inside it. No
// Production connection or data mutation occurs anywhere in this file —
// every dependency is mocked; the real Postgres concurrency proof for
// the advisory-lock dedupe design lives in
// scripts/tests/verify-events-crm-sync-concurrency.sh.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

let responseQueue: (unknown[] | 'THROW')[] = []
let callCount = 0
let calls: { text: string }[] = []
const sqlMock = vi.fn((strings: TemplateStringsArray, ..._values: unknown[]) => {
  calls.push({ text: strings.join('?') })
  const next = responseQueue[callCount++]
  if (next === 'THROW') throw new Error('simulated DB failure')
  return Promise.resolve(next ?? [])
})
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}))

const checkCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, checkCapability: (...args: unknown[]) => checkCapabilityMock(...args) }
})

function queue(...responses: (unknown[] | 'THROW')[]) {
  responseQueue = responses
  callCount = 0
  calls = []
}

const { normalizeEmail, normalizePhone, splitPurchaserName, syncEventOrderContact, recordEventBookingActivity } =
  await import('@/lib/crm/eventSync')

beforeEach(() => {
  checkCapabilityMock.mockReset()
  sqlMock.mockClear()
  queue()
})

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Alex.Demo@Example.INVALID  ')).toBe('alex.demo@example.invalid')
  })
  it('returns null for null/undefined/whitespace-only', () => {
    expect(normalizeEmail(null)).toBeNull()
    expect(normalizeEmail(undefined)).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
  })
})

describe('normalizePhone', () => {
  it('strips everything except digits and a leading +, no country-code assumptions', () => {
    expect(normalizePhone('0412 345 678')).toBe('0412345678')
    expect(normalizePhone('+61 412 345 678')).toBe('+61412345678')
    expect(normalizePhone('(04) 12-345-678')).toBe('0412345678')
  })
  it('does NOT normalize a leading 0 vs +61 to the same value (documented conservative limitation)', () => {
    expect(normalizePhone('0412345678')).not.toBe(normalizePhone('+61412345678'))
  })
  it('returns null for null/undefined/unusable input', () => {
    expect(normalizePhone(null)).toBeNull()
    expect(normalizePhone(undefined)).toBeNull()
    expect(normalizePhone('---')).toBeNull()
  })
})

describe('splitPurchaserName', () => {
  it('splits a two-token name into first/last', () => {
    expect(splitPurchaserName('Alex Demo')).toEqual({ firstName: 'Alex', lastName: 'Demo' })
  })
  it('splits a multi-token name: first token vs the remainder joined', () => {
    expect(splitPurchaserName('Mary Jane Watson')).toEqual({ firstName: 'Mary', lastName: 'Jane Watson' })
  })
  it('a single-token name becomes first_name with an empty (never fabricated) last_name', () => {
    expect(splitPurchaserName('Madonna')).toEqual({ firstName: 'Madonna', lastName: '' })
  })
  it('collapses internal whitespace runs before splitting', () => {
    expect(splitPurchaserName('  Alex   Demo  ')).toEqual({ firstName: 'Alex', lastName: 'Demo' })
  })
  it('never returns an empty first_name even for a defensively-unreachable empty input', () => {
    const result = splitPurchaserName('')
    expect(result.firstName.length).toBeGreaterThan(0)
    expect(result.lastName.length).toBeGreaterThan(0)
  })
})

describe('syncEventOrderContact — best-effort behavior', () => {
  it('does nothing at all (no sql call) when CRM capability is not allowed', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'ENTITLEMENT_DISABLED' })
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('resolves (never throws/rejects) when the capability check itself throws', async () => {
    checkCapabilityMock.mockRejectedValue(new Error('capability lookup blew up'))
    await expect(
      syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null }),
    ).resolves.toBeUndefined()
  })

  it('resolves (never throws/rejects) when the dedupe/insert SQL throws', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue('THROW')
    await expect(
      syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null }),
    ).resolves.toBeUndefined()
  })

  it('when allowed, resolves/reuses a contact and links event_orders.crm_contact_id', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue([{ id: 'contact-123' }], [])
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'Alex Demo', purchaserEmail: 'alex@example.invalid', purchaserPhone: null })
    expect(sqlMock).toHaveBeenCalledTimes(2)
    expect(calls[0].text).toContain('pg_advisory_xact_lock')
    expect(calls[0].text).toContain('crm_contacts')
    expect(calls[1].text).toContain('UPDATE event_orders')
    expect(calls[1].text).toContain('crm_contact_id')
  })

  it('with neither email nor phone usable, skips the lock/dedupe path and always creates a fresh contact', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue([{ id: 'contact-456' }], [])
    await syncEventOrderContact({ organisationId: 'org-a', orderId: 'order-1', purchaserName: 'No Contact Method', purchaserEmail: null, purchaserPhone: null })
    expect(calls[0].text).not.toContain('pg_advisory_xact_lock')
    expect(calls[0].text).toContain('INSERT INTO crm_contacts')
  })
})

describe('recordEventBookingActivity — best-effort behavior, never writes registration answers', () => {
  it('does nothing when CRM is not allowed', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: false, reason: 'ENTITLEMENT_DISABLED' })
    await recordEventBookingActivity({ organisationId: 'org-a', orderId: 'order-1', eventName: 'Fete', quantity: 2, totalCents: 6000, currency: 'AUD', paymentStatus: 'PAID' })
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('does nothing when the order has no linked contact yet', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue([{ crm_contact_id: null }])
    await recordEventBookingActivity({ organisationId: 'org-a', orderId: 'order-1', eventName: 'Fete', quantity: 2, totalCents: 6000, currency: 'AUD', paymentStatus: 'PAID' })
    expect(sqlMock).toHaveBeenCalledTimes(1) // only the crm_contact_id lookup, no activity write
  })

  it('resolves (never throws) when the activity upsert SQL fails', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue([{ crm_contact_id: 'contact-123' }], 'THROW')
    await expect(
      recordEventBookingActivity({ organisationId: 'org-a', orderId: 'order-1', eventName: 'Fete', quantity: 2, totalCents: 6000, currency: 'AUD', paymentStatus: 'PAID' }),
    ).resolves.toBeUndefined()
  })

  it('writes an activity using only type=note (the existing CHECK-constrained vocabulary), never a new type', async () => {
    checkCapabilityMock.mockResolvedValue({ allowed: true, entitlement: { key: 'crm', config: {} } })
    queue([{ crm_contact_id: 'contact-123' }], [{ id: 'activity-1' }])
    await recordEventBookingActivity({ organisationId: 'org-a', orderId: 'order-1', eventName: 'Fete', quantity: 2, totalCents: 6000, currency: 'AUD', paymentStatus: 'PAID' })
    expect(calls[1].text).toContain("'note'")
    expect(calls[1].text).toContain('pg_advisory_xact_lock')
  })
})

describe('lib/crm/eventSync.ts — static source boundary proof', () => {
  const source = read('lib/crm/eventSync.ts')

  it('never reads or writes any registration-question answer table/column — the one place "dietary/accessibility" appears is this file\'s own explanatory prose stating the boundary, not a functional reference', () => {
    expect(source).not.toContain('event_registration_responses')
    expect(source).not.toContain('event_registration_questions')
    expect(source).not.toMatch(/question_label_snapshot|field_type_snapshot|answer_json/)
  })

  it('never imports from or references the separate tennis-vertical contacts table or its normalizeEmail()', () => {
    expect(source).not.toMatch(/from ['"]@\/lib\/tennisRecurrence['"]/)
    expect(source).not.toContain('tennisRecurrence')
    // No SQL statement in this file targets the bare `contacts` table —
    // every actual table reference is crm_contacts / crm_activities /
    // event_orders.
    expect(source).not.toMatch(/FROM contacts\b|INTO contacts\b|UPDATE contacts\b/)
  })

  it('the crm_activities INSERT writes type=\'note\' only — never a new/unsupported activity type', () => {
    const insertIdx = source.indexOf('INSERT INTO crm_activities')
    expect(insertIdx).toBeGreaterThan(-1)
    // The VALUES/SELECT list immediately following the INSERT column
    // list is where the literal type value is written.
    const nearby = source.slice(insertIdx, insertIdx + 400)
    expect(nearby).toContain("'note'")
    expect(nearby).not.toMatch(/'call'|'meeting'/)
  })
})

describe('call sites — CRM sync happens AFTER the booking transaction/UPDATE, never inside it', () => {
  it('free registration route: syncEventOrderContact is called after the transaction try/catch block, using orderId from insertResult', () => {
    const source = read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts')
    const transactionCatchIdx = source.indexOf("console.error('[public register] transaction failed'")
    const syncCallIdx = source.indexOf('await syncEventOrderContact(')
    expect(transactionCatchIdx).toBeGreaterThan(-1)
    expect(syncCallIdx).toBeGreaterThan(transactionCatchIdx)
  })

  it('paid checkout route: syncEventOrderContact is called after the reservation transaction and after responses are written, before the Stripe Checkout Session call', () => {
    const source = read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts')
    const responsesWrittenIdx = source.indexOf('await writeRegistrationResponses(')
    const syncCallIdx = source.indexOf('await syncEventOrderContact(')
    const stripeSessionIdx = source.indexOf('await createCheckoutSession(')
    expect(responsesWrittenIdx).toBeGreaterThan(-1)
    expect(syncCallIdx).toBeGreaterThan(responsesWrittenIdx)
    expect(stripeSessionIdx).toBeGreaterThan(syncCallIdx)
  })

  it('lib/events/stripe.ts: recordEventBookingActivityForOrder is called after each webhook handler\'s own UPDATE statement, not before', () => {
    const source = read('lib/events/stripe.ts')
    const completedUpdateIdx = source.indexOf("SET status = 'CONFIRMED', payment_status = 'PAID'")
    const completedSyncIdx = source.indexOf('await recordEventBookingActivityForOrder(orderId);\n}')
    expect(completedSyncIdx).toBeGreaterThan(completedUpdateIdx)

    const expiredUpdateIdx = source.indexOf("SET status = 'CANCELLED', payment_status = 'EXPIRED'")
    const expiredSyncIdx = source.indexOf('await recordEventBookingActivityForOrder(orderId);\n}', expiredUpdateIdx)
    expect(expiredSyncIdx).toBeGreaterThan(expiredUpdateIdx)
  })

  it('cancel and refund routes call recordEventBookingActivityForOrder only after their own conditional UPDATE has matched a row', () => {
    const cancelSource = read('app/api/events/[id]/orders/[orderId]/cancel/route.ts')
    const cancelUpdateIdx = cancelSource.indexOf("SET status = 'CANCELLED', payment_status = 'EXPIRED'")
    const cancelSyncIdx = cancelSource.indexOf('await recordEventBookingActivityForOrder(')
    expect(cancelSyncIdx).toBeGreaterThan(cancelUpdateIdx)

    const refundSource = read('app/api/events/[id]/orders/[orderId]/refund/route.ts')
    const refundUpdateIdx = refundSource.indexOf("SET payment_status = 'REFUNDED'")
    const refundSyncIdx = refundSource.indexOf('await recordEventBookingActivityForOrder(')
    expect(refundSyncIdx).toBeGreaterThan(refundUpdateIdx)
  })
})

describe('manager UI — "View CRM Contact" gating', () => {
  const source = read('app/events/[id]/RegistrationsPanel.tsx')

  it('is gated on canManage AND crmEnabled AND a non-null crm_contact_id, all three together', () => {
    expect(source).toMatch(/canManage\s*&&\s*crmEnabled\s*&&\s*o\.crm_contact_id\s*&&/)
  })

  it('links to the existing /crm/contacts/[id] route, no new CRM route introduced', () => {
    expect(source).toMatch(/\/crm\/contacts\/\$\{o\.crm_contact_id\}/)
  })
})

describe('orders API — crm_enabled is decided server-side from the real capability check, never trusted from the client', () => {
  const source = read('app/api/events/[id]/orders/route.ts')

  it('calls checkCapability with the session-derived organisationId, not any client-supplied value', () => {
    expect(source).toMatch(/checkCapability\(session\.organisationId,\s*'crm'\)/)
  })

  it('this route remains staff-authenticated (authorizeEventsRequest) — never exposed on a public endpoint', () => {
    expect(source).toContain("authorizeEventsRequest('viewer')")
  })
})
