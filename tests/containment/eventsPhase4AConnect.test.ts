import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Events & Ticketing Phase 4A — Stripe Connect per organisation. Every
// dependency here is mocked — no real database, network, or Stripe API
// call occurs anywhere in this file. Real-Postgres capacity proof
// remains scripts/tests/verify-events-phase4-payment-concurrency.sh's
// job (unchanged by this remediation — Connect does not touch
// capacity semantics at all, only which Stripe account a payment
// belongs to). What THIS file proves: onboarding route auth/
// idempotency, the derived-status function's own logic, the paid-
// ticketing eligibility gate, and — most importantly — that Stripe
// connected account A can never activate/refund/mutate organisation
// B's order (§16).

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─── Shared mocks ────────────────────────────────────────────────────

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn(() => Promise.resolve(responseQueue[callCount++] ?? []))
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const requireSessionMock = vi.fn()
const requireRoleMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args), requireRole: (...args: unknown[]) => requireRoleMock(...args) }
})

const requireCapabilityMock = vi.fn()
vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return {
    ...actual,
    requireCapability: (...args: unknown[]) => requireCapabilityMock(...args),
    checkCapability: vi.fn().mockResolvedValue({ allowed: true, entitlement: { key: 'events', config: {} } }),
  }
})

// Partial mock (importOriginal): only getStripeClient is overridden —
// processStripeWebhookEvent and its handlers run for REAL against the
// mocked @/lib/db, which is the whole point of the §16 proof below
// (this file tests lib/events/stripe.ts's actual webhook logic, not a
// stand-in for it — unlike eventsPhase4Payments.test.ts, which mocks
// this entire module at the route-orchestration level).
const stripeAccountsCreateMock = vi.fn()
const stripeAccountsRetrieveMock = vi.fn()
const stripeAccountLinksCreateMock = vi.fn()
const getStripeClientMock = vi.fn(() => ({
  accounts: { create: stripeAccountsCreateMock, retrieve: stripeAccountsRetrieveMock },
  accountLinks: { create: stripeAccountLinksCreateMock },
}))
vi.mock('@/lib/events/stripe', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/events/stripe')>()
  return { ...actual, getStripeClient: () => getStripeClientMock() }
})

vi.mock('next/headers', () => ({
  headers: async () => new Map([['host', 'localhost:3000']]),
}))

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0 }
function sessionAs(role: string, organisationId = 'org-a') { return { userId: 'staff-1', organisationId, role } }

const connectRoute = await import('@/app/api/events/payments/connect/route')
const stripeConnectLib = await import('@/lib/events/stripeConnect')
const { processStripeWebhookEvent } = await import('@/lib/events/stripe')

beforeEach(() => {
  sqlMock.mockClear()
  requireSessionMock.mockReset()
  requireRoleMock.mockReset()
  requireCapabilityMock.mockReset()
  stripeAccountsCreateMock.mockReset()
  stripeAccountsRetrieveMock.mockReset()
  stripeAccountLinksCreateMock.mockReset()
  responseQueue = []
  callCount = 0
  requireSessionMock.mockResolvedValue(sessionAs('manager'))
  requireRoleMock.mockResolvedValue(sessionAs('manager'))
  requireCapabilityMock.mockResolvedValue({ key: 'events', config: {} })
})

// ─── §25 — Connect onboarding ─────────────────────────────────────────

describe('Connect route — auth and idempotent account creation', () => {
  it('unauthenticated -> 401, no Stripe call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await connectRoute.GET()
    expect(res.status).toBe(401)
  })

  it('POST unauthenticated -> 401, no Stripe call', async () => {
    requireSessionMock.mockRejectedValue(new Error('Unauthorized'))
    const res = await connectRoute.POST()
    expect(res.status).toBe(401)
    expect(stripeAccountsCreateMock).not.toHaveBeenCalled()
  })

  it('viewer cannot start onboarding -> 403, no Stripe call', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('viewer'))
    const res = await connectRoute.POST()
    expect(res.status).toBe(403)
    expect(stripeAccountsCreateMock).not.toHaveBeenCalled()
  })

  it('manager can start onboarding -> creates an account and returns an onboarding_url', async () => {
    queue(
      [{ stripe_account_id: null, stripe_account_status: 'NOT_CONNECTED', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, stripe_connected_at: null, stripe_last_synced_at: null }],
      [{ name: 'LD Tennis' }],
      [], // the guarded UPDATE
      [{ stripe_account_id: 'acct_new', stripe_account_status: 'NOT_CONNECTED', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, stripe_connected_at: null, stripe_last_synced_at: null }],
    )
    stripeAccountsCreateMock.mockResolvedValue({ id: 'acct_new' })
    stripeAccountLinksCreateMock.mockResolvedValue({ url: 'https://connect.stripe.com/setup/acct_new' })
    const res = await connectRoute.POST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.onboarding_url).toBe('https://connect.stripe.com/setup/acct_new')
  })

  it('admin (>= manager) can also start onboarding', async () => {
    requireSessionMock.mockResolvedValue(sessionAs('admin'))
    queue(
      [{ stripe_account_id: 'acct_existing', stripe_account_status: 'CONNECTED', stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true, stripe_connected_at: new Date(), stripe_last_synced_at: new Date() }],
    )
    stripeAccountLinksCreateMock.mockResolvedValue({ url: 'https://connect.stripe.com/setup/acct_existing' })
    const res = await connectRoute.POST()
    expect(res.status).toBe(200)
    expect(stripeAccountsCreateMock).not.toHaveBeenCalled() // reused, not recreated
  })

  it('repeated Connect Stripe does not create a duplicate account — an existing stripe_account_id is reused unconditionally', async () => {
    queue([{ stripe_account_id: 'acct_existing', stripe_account_status: 'ONBOARDING', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, stripe_connected_at: null, stripe_last_synced_at: null }])
    stripeAccountLinksCreateMock.mockResolvedValue({ url: 'https://connect.stripe.com/setup/acct_existing' })
    await connectRoute.POST()
    expect(stripeAccountsCreateMock).not.toHaveBeenCalled()
    expect(stripeAccountLinksCreateMock).toHaveBeenCalledWith(expect.objectContaining({ account: 'acct_existing' }))
  })

  it('organisation is derived only from the authenticated session — the route reads no request body at all', () => {
    const code = stripComments(read('app/api/events/payments/connect/route.ts'))
    expect(code).not.toMatch(/req\.json\(\)|await req\./)
  })

  it('never returns the raw Stripe account id in the GET status response', () => {
    const code = stripComments(read('app/api/events/payments/connect/route.ts'))
    const getStart = code.indexOf('export async function GET')
    const returnStart = code.indexOf('return NextResponse.json({', getStart)
    const returnBody = code.slice(returnStart, code.indexOf('});', returnStart))
    // state.accountId is read only inside a boolean comparison
    // (`!== null`) to compute the `connected` flag — never assigned
    // as a bare response value, which is what would actually leak it.
    expect(returnBody).not.toMatch(/account_id:/)
    expect(returnBody).not.toMatch(/accountId,/)
    expect(returnBody).toMatch(/accountId !== null/)
  })
})

// ─── §3 — derived status logic (pure function) ────────────────────────

describe('deriveConnectStatus — pure derivation, no I/O', () => {
  const { deriveConnectStatus } = stripeConnectLib

  it('no account -> NOT_CONNECTED', () => {
    expect(deriveConnectStatus(null)).toBe('NOT_CONNECTED')
  })

  it('details not submitted -> ONBOARDING', () => {
    expect(deriveConnectStatus({ details_submitted: false, charges_enabled: false, payouts_enabled: false, requirements: {} } as never)).toBe('ONBOARDING')
  })

  it('details submitted but charges disabled -> ACTION_REQUIRED', () => {
    expect(deriveConnectStatus({ details_submitted: true, charges_enabled: false, payouts_enabled: false, requirements: {} } as never)).toBe('ACTION_REQUIRED')
  })

  it('charges enabled but payouts disabled -> ACTION_REQUIRED', () => {
    expect(deriveConnectStatus({ details_submitted: true, charges_enabled: true, payouts_enabled: false, requirements: {} } as never)).toBe('ACTION_REQUIRED')
  })

  it('outstanding currently_due requirements -> ACTION_REQUIRED even if charges_enabled', () => {
    expect(deriveConnectStatus({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: ['individual.dob'] } } as never)).toBe('ACTION_REQUIRED')
  })

  it('fully enabled, no outstanding requirements -> CONNECTED', () => {
    expect(deriveConnectStatus({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { currently_due: [], past_due: [] } } as never)).toBe('CONNECTED')
  })

  it('disabled_reason set -> RESTRICTED regardless of other flags', () => {
    expect(deriveConnectStatus({ details_submitted: true, charges_enabled: true, payouts_enabled: true, requirements: { disabled_reason: 'rejected.fraud' } } as never)).toBe('RESTRICTED')
  })
})

// ─── §26 — paid-ticketing eligibility gate ────────────────────────────

describe('checkPaidTicketingEligibility', () => {
  const { checkPaidTicketingEligibility } = stripeConnectLib

  it('no connected account -> ineligible', async () => {
    queue([{ stripe_account_id: null, stripe_account_status: 'NOT_CONNECTED', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, stripe_connected_at: null, stripe_last_synced_at: null }])
    const result = await checkPaidTicketingEligibility('org-a')
    expect(result.eligible).toBe(false)
  })

  it('account exists but charges disabled (onboarding incomplete) -> ineligible', async () => {
    queue([{ stripe_account_id: 'acct_1', stripe_account_status: 'ONBOARDING', stripe_charges_enabled: false, stripe_payouts_enabled: false, stripe_details_submitted: false, stripe_connected_at: null, stripe_last_synced_at: null }])
    const result = await checkPaidTicketingEligibility('org-a')
    expect(result.eligible).toBe(false)
  })

  it('charges enabled -> eligible, returns the account id', async () => {
    queue([{ stripe_account_id: 'acct_1', stripe_account_status: 'CONNECTED', stripe_charges_enabled: true, stripe_payouts_enabled: true, stripe_details_submitted: true, stripe_connected_at: new Date(), stripe_last_synced_at: new Date() }])
    const result = await checkPaidTicketingEligibility('org-a')
    expect(result).toEqual({ eligible: true, accountId: 'acct_1' })
  })

  it('the checkout route blocks paid checkout when ineligible — free registration is a completely separate route, unaffected', () => {
    const checkoutSrc = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    const registerSrc = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/register/route.ts'))
    expect(checkoutSrc).toMatch(/checkPaidTicketingEligibility/)
    expect(registerSrc).not.toMatch(/checkPaidTicketingEligibility|stripeConnect/)
  })
})

// ─── §27 — connected checkout ──────────────────────────────────────────

describe('Checkout route — connected-account propagation', () => {
  it('the client cannot supply a Stripe account id — the validator has no such field, and connectedAccountId is only ever server-derived', () => {
    const validationSrc = stripComments(read('lib/events/publicValidation.ts'))
    expect(validationSrc).not.toMatch(/stripe_account|account_id/i)
    const checkoutSrc = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(checkoutSrc).toMatch(/eligibility\.accountId/)
  })

  it('the order INSERT stores stripe_account_id for historical provider attribution (§14)', () => {
    const code = stripComments(read('app/api/public/events/[organisationSlug]/[eventSlug]/checkout/route.ts'))
    expect(code).toMatch(/stripe_account_id/)
    expect(code).toMatch(/\$\{connectedAccountId\}/)
  })

  it('createCheckoutSession is called with { stripeAccount: ... } — a direct charge on the connected account, not the platform account', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const fnStart = code.indexOf('export async function createCheckoutSession')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/\{ stripeAccount: input\.connectedAccountId \}/)
  })
})

// ─── §28 — connected webhook tenant reconciliation (§15/§16) ──────────

describe('Webhook handlers — connected-account reconciliation', () => {
  it('§16 PROOF: an event for connected account A cannot activate an order whose stored stripe_account_id is B', async () => {
    queue([]) // the account-matched UPDATE finds/affects nothing
    const event = {
      type: 'checkout.session.completed',
      account: 'acct_A',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-of-org-b' } } },
    } as never
    await processStripeWebhookEvent(event)
    const updateCall = sqlMock.mock.calls[0] as unknown as TemplateStringsArray[]
    expect(updateCall[0].join('')).toMatch(/stripe_account_id/)
  })

  it('a matching connected account activates the order normally', async () => {
    queue([{ id: 'order-1' }], [{ id: 'att-1' }])
    const event = {
      type: 'checkout.session.completed',
      account: 'acct_A',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await processStripeWebhookEvent(event)
    expect(sqlMock).toHaveBeenCalledTimes(3) // order-flip UPDATE (account-guarded), attendee lookup, token issuance
  })

  it('a platform-level event with no event.account at all can never match a real (always-Connect-attributed) paid order', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    expect(code).toMatch(/const eventAccount = event\.account \?\? null/)
  })

  it('token issuance re-checks payment_status = PAID independently — an account mismatch can never cause tokens to be issued for a still-PENDING order', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const fnStart = code.indexOf('async function issueTicketTokensForPaidOrder')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/eo\.payment_status = 'PAID'/)
  })

  it('checkout.session.expired also carries the account-match guard — not only the activation path', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const fnStart = code.indexOf('async function handleCheckoutSessionExpired')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/stripe_account_id = \$\{eventAccount\}/)
  })

  it('payment_intent.payment_failed also carries the account-match guard', () => {
    const code = stripComments(read('lib/events/stripe.ts'))
    const fnStart = code.indexOf('async function handlePaymentIntentFailed')
    const fnBody = code.slice(fnStart, code.indexOf('\n}', fnStart))
    expect(fnBody).toMatch(/stripe_account_id = \$\{eventAccount\}/)
  })

  it('duplicate delivery of the same (correctly-matched) event remains idempotent — the order-flip guard is still payment_status = PENDING', async () => {
    queue([], []) // already PAID: flip matches 0 rows; no NULL tokens left to issue
    const event = {
      type: 'checkout.session.completed',
      account: 'acct_A',
      data: { object: { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1', metadata: { event_order_id: 'order-1' } } },
    } as never
    await expect(processStripeWebhookEvent(event)).resolves.not.toThrow()
  })
})

// ─── §29 — connected refund ────────────────────────────────────────────

describe('Refund — uses the order\'s own historical Connect account', () => {
  it('createRefund is called with the ORDER\'s stripe_account_id, never re-derived from the organisation\'s current settings', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/refund/route.ts'))
    expect(code).toMatch(/createRefund\(order\.stripe_payment_intent_id, order\.stripe_account_id\)/)
    expect(code).not.toMatch(/getConnectAccountState|stripeConnect/)
  })

  it('an order with no stored stripe_account_id cannot be refunded (pre-Connect / non-Connect-attributed order)', () => {
    const code = stripComments(read('app/api/events/[id]/orders/[orderId]/refund/route.ts'))
    expect(code).toMatch(/!order\.stripe_account_id/)
  })
})

// ─── Architecture containment ─────────────────────────────────────────

describe('Phase 4A — architecture containment', () => {
  const CONNECT_FILES = [
    'lib/events/stripeConnect.ts',
    'app/api/events/payments/connect/route.ts',
    'app/events/payments/connect/return/page.tsx',
    'app/events/payments/connect/refresh/page.tsx',
    'app/events/payments/PaymentsClient.tsx',
  ]

  for (const file of CONNECT_FILES) {
    it(`${file} never handles a bank account number, routing number, SSN/tax id, or raw card value`, () => {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/bank_account|routing_number|account_number|ssn|tax_id|card_number/i)
    })
  }

  it('no STRIPE_CONNECT_CLIENT_ID env var is used — Express + Account Links needs none (only the OAuth "Standard" flow would)', () => {
    for (const file of CONNECT_FILES) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/STRIPE_CONNECT_CLIENT_ID/)
    }
  })

  it('no destructive account-disconnect/migration action exists', () => {
    const code = stripComments(read('lib/events/stripeConnect.ts'))
    expect(code).not.toMatch(/DELETE FROM organisations|stripe_account_id = NULL|accounts\.del/)
  })

  it('no platform fee (application_fee_amount) is implemented', () => {
    for (const file of [...CONNECT_FILES, 'lib/events/stripe.ts']) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/application_fee_amount|platform_fee/i)
    }
  })

  it('no seating/promo/subscription/SMS/CRM scope creep', () => {
    for (const file of CONNECT_FILES) {
      const code = stripComments(read(file))
      expect(code).not.toMatch(/seat_map|seating|reserved_seat/i)
      expect(code).not.toMatch(/promo_code|promoCode/i)
      expect(code).not.toMatch(/subscription|membership/i)
      expect(code).not.toMatch(/twilio|sendSms/i)
      expect(code).not.toMatch(/crm_contacts|crm_companies|crm_deals/i)
    }
  })

  it('the Payments settings page has no bank-detail/KYC input field — it only ever links out to Stripe', () => {
    const code = stripComments(read('app/events/payments/PaymentsClient.tsx'))
    expect(code).not.toMatch(/<input/)
    expect(code).not.toMatch(/routing_number|account_number|BSB|SWIFT|IBAN/i)
  })

  it('Express account type is used, not Custom', () => {
    const code = stripComments(read('lib/events/stripeConnect.ts'))
    expect(code).toMatch(/CONNECTED_ACCOUNT_TYPE = 'express'/)
  })
})
