import { describe, it, expect, vi, beforeEach } from 'vitest'

// Eve registration questions (ADR 0013 §4a) — the shared free/paid services
// with productSurface 'EVE': the per-event opt-in, the sensitive-answer
// acknowledgement, the new snapshots, and that the BRAINBASE surface is
// unchanged. Same mocking harness as eventsRegistrationResponsesFlow.test.ts:
// no real database, network or Stripe call anywhere in this file.

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  void strings
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
let transactionFinalResult: unknown[] = []
const transactionMock = vi.fn(async () => [[], [], [], transactionFinalResult])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

const checkPaidTicketingEligibilityMock = vi.fn()
vi.mock('@/lib/events/stripeConnect', () => ({
  checkPaidTicketingEligibility: (...args: unknown[]) => checkPaidTicketingEligibilityMock(...args),
}))
vi.mock('@/lib/events/ticketEmailDelivery', () => ({ attemptAutomaticTicketEmail: vi.fn().mockResolvedValue({ outcome: 'not_claimed' }) }))
const createCheckoutSessionMock = vi.fn()
vi.mock('@/lib/events/stripe', () => ({
  createCheckoutSession: (...args: unknown[]) => createCheckoutSessionMock(...args),
  expireCheckoutSession: vi.fn(),
  RESERVATION_WINDOW_SECONDS: 1860,
  StripeNotConfiguredError: class extends Error {},
}))

const { registerFreeOrder } = await import('@/lib/events/services/freeRegistration')
const { startPaidCheckout } = await import('@/lib/events/services/paidCheckout')
const { validatePublicRegistrationInput } = await import('@/lib/events/publicValidation')
const rq = await import('@/lib/events/registrationQuestions')

// Riverlights-style question set (test data only — never added to any real event).
const Q = {
  ecName: { id: 'q-ec-name', label: 'Emergency Contact Name', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 0, active: true, data_category: 'THIRD_PARTY', template_key: null },
  ecPhone: { id: 'q-ec-phone', label: 'Emergency Contact Phone Number', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 1, active: true, data_category: 'THIRD_PARTY', template_key: null },
  access: { id: 'q-access', label: 'Accessibility requirements', help_text: 'Tell us anything that helps you attend.', field_type: 'LONG_TEXT', required: false, scope: 'ATTENDEE', options: null, sort_order: 0, active: true, data_category: 'SENSITIVE', template_key: null },
  over18: { id: 'q-18', label: 'Are you over 18 years of age?', help_text: null, field_type: 'YES_NO', required: true, scope: 'ATTENDEE', options: null, sort_order: 1, active: true, data_category: 'STANDARD', template_key: null },
  photo: { id: 'q-photo', label: 'Consent to event photography/videography', help_text: 'Photos may be used in event promotion.', field_type: 'YES_NO', required: true, scope: 'ORDER', options: null, sort_order: 2, active: true, data_category: 'CONSENT', template_key: null },
  hear: { id: 'q-hear', label: 'How did you hear about this event?', help_text: null, field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER', options: ['Social media', 'Friend', 'Radio', 'Other'], sort_order: 3, active: true, data_category: 'STANDARD', template_key: null },
} as const
const ALL = Object.values(Q)

const EVENT = (eve: boolean) => ({
  id: 'event-1', organisation_id: 'org-a', name: 'Riverlights', slug: 'riverlights', description: null, venue: 'Park',
  artwork_url: null, starts_at: '2027-03-20T01:30:00Z', ends_at: '2027-03-20T12:30:00Z', timezone: 'Australia/Adelaide',
  eve_questions_enabled: eve,
})
const FREE_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 0, name: 'General' }]
const PAID_TYPE_ROW = [{ id: 'tt-1', active: true, price_cents: 8900, currency: 'AUD', name: 'General Admission' }]
const PADDING: unknown[][] = [[{ expires_at: '2027-01-01T00:00:00.000Z' }], [{ id: 'order-1' }], [{ id: 'order-1' }], [{ id: 'order-1' }]]

const FULL_ANSWERS = {
  order_responses: [
    { question_id: 'q-ec-name', answer: 'Sam Contact' }, { question_id: 'q-ec-phone', answer: '0400 000 000' },
    { question_id: 'q-photo', answer: false }, { question_id: 'q-hear', answer: 'Radio' },
  ],
  attendeeResponses: [{ question_id: 'q-18', answer: true }, { question_id: 'q-access', answer: 'Step-free access' }],
}

function body(extra: Record<string, unknown> = {}, withAnswers = true) {
  return {
    items: [{ ticket_type_id: 'tt-1', quantity: 1 }], purchaser_name: 'Jane', purchaser_email: 'jane@example.test',
    attendees: [{ name: 'Jane', ticket_type_id: 'tt-1', ...(withAnswers ? { responses: FULL_ANSWERS.attendeeResponses } : {}) }],
    ...(withAnswers ? { order_responses: FULL_ANSWERS.order_responses } : {}),
    ...extra,
  }
}
function validated(b: Record<string, unknown>) {
  const v = validatePublicRegistrationInput(b as never)
  if (typeof v === 'string') throw new Error(v)
  return v
}
const responsesStatement = () => sqlMock.mock.calls.map(c => c as unknown as unknown[]).find(c => (c[0] as TemplateStringsArray).join(' ').includes('event_registration_responses'))

beforeEach(() => {
  sqlMock.mockClear(); transactionMock.mockClear(); createCheckoutSessionMock.mockReset()
  responseQueue = []; callCount = 0
  transactionFinalResult = [{ id: 'att-1', order_id: 'order-1', attendee_name: 'Jane', ticket_token: 'tok-1' }]
  transactionMock.mockImplementation(async () => [[], [], [], transactionFinalResult])
  checkPaidTicketingEligibilityMock.mockResolvedValue({ eligible: true, accountId: 'acct_connected' })
  createCheckoutSessionMock.mockResolvedValue({ sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' })
})

const free = (eve: boolean, b: Record<string, unknown>, surface: 'EVE' | 'BRAINBASE' = 'EVE') =>
  registerFreeOrder({ organisationId: 'org-a', event: EVENT(eve) as never, validated: validated(b), productSurface: surface })
const paid = (eve: boolean, b: Record<string, unknown>) =>
  startPaidCheckout({
    organisationId: 'org-a', event: EVENT(eve) as never, validated: validated(b), productSurface: 'EVE',
    buildReturnUrls: async () => ({ successUrl: 'https://eve.example/s', cancelUrl: 'https://eve.example/c' }),
  } as never)

describe('pure policy: checkEveAnswerPolicy', () => {
  const v = (answers: { q: (typeof ALL)[number]; a: unknown }[]) => ({ orderAnswers: answers.map(x => ({ question: x.q as never, answer: x.a })), attendeeAnswers: [] })
  it('opt-in off: no answers -> allowed; any submitted answer -> refused (even to an optional, non-sensitive question)', () => {
    expect(rq.checkEveAnswerPolicy({ orderResponses: [], attendeeResponses: [[]] }, v([]), { eveQuestionsEnabled: false, sensitiveConsent: false })).toBeNull()
    expect(rq.checkEveAnswerPolicy({ orderResponses: [{ question_id: 'q-hear', answer: 'Radio' }], attendeeResponses: [[]] }, v([{ q: Q.hear, a: 'Radio' }]), { eveQuestionsEnabled: false, sensitiveConsent: true }))
      .toBe('This event is not collecting registration answers here.')
    expect(rq.checkEveAnswerPolicy({ orderResponses: [], attendeeResponses: [[{ question_id: 'q-18', answer: true }]] }, v([]), { eveQuestionsEnabled: false, sensitiveConsent: false })).not.toBeNull()
  })
  it('opt-in on: SENSITIVE and THIRD_PARTY answers need explicit agreement; STANDARD and CONSENT answers, and unanswered questions, do not', () => {
    const sub = (id: string) => ({ orderResponses: [{ question_id: id, answer: 'x' }], attendeeResponses: [] })
    for (const q of [Q.ecName, Q.access]) {
      expect(rq.checkEveAnswerPolicy(sub(q.id), v([{ q, a: 'x' }]), { eveQuestionsEnabled: true, sensitiveConsent: false }), q.data_category).toMatch(/confirm you agree/)
      expect(rq.checkEveAnswerPolicy(sub(q.id), v([{ q, a: 'x' }]), { eveQuestionsEnabled: true, sensitiveConsent: true })).toBeNull()
    }
    for (const [q, a] of [[Q.hear, 'Radio'], [Q.photo, false], [Q.over18, true]] as const) {
      expect(rq.checkEveAnswerPolicy(sub(q.id), v([{ q, a }]), { eveQuestionsEnabled: true, sensitiveConsent: false }), q.data_category).toBeNull()
    }
    expect(rq.checkEveAnswerPolicy({ orderResponses: [], attendeeResponses: [] }, v([]), { eveQuestionsEnabled: true, sensitiveConsent: false })).toBeNull()
  })
})

describe('category model and templates (ADR 0013 §4b)', () => {
  const base = { label: 'x', field_type: 'SHORT_TEXT', scope: 'ORDER' }
  it('category defaults to STANDARD; only the four categories are accepted', () => {
    expect((rq.validateQuestionInput(base) as { data_category: string }).data_category).toBe('STANDARD')
    for (const c of ['STANDARD', 'SENSITIVE', 'THIRD_PARTY', 'CONSENT']) {
      expect((rq.validateQuestionInput({ ...base, data_category: c }) as { data_category: string }).data_category).toBe(c)
    }
    for (const bad of ['sensitive', 'HEALTH', true, 1]) expect(rq.validateQuestionInput({ ...base, data_category: bad })).toMatch(/data_category must be one of/)
  })
  it('a template sets its category; protected templates cannot be lowered, unknown templates are refused', () => {
    const t = (template_key: string, extra: Record<string, unknown> = {}) => rq.validateQuestionInput({ label: 'L', field_type: 'LONG_TEXT', scope: 'ATTENDEE', template_key, ...extra })
    expect((t('ACCESSIBILITY') as { data_category: string }).data_category).toBe('SENSITIVE')
    expect((t('DIETARY') as { data_category: string }).data_category).toBe('SENSITIVE')
    expect((t('EMERGENCY_CONTACT_NAME') as { data_category: string }).data_category).toBe('THIRD_PARTY')
    expect((t('PHOTO_CONSENT') as { data_category: string }).data_category).toBe('CONSENT')
    expect(t('ACCESSIBILITY', { data_category: 'STANDARD' })).toMatch(/cannot be changed/)
    expect(t('EMERGENCY_CONTACT_PHONE', { data_category: 'SENSITIVE' })).toMatch(/cannot be changed/)
    expect(t('PHOTO_CONSENT', { data_category: 'STANDARD' })).toMatch(/cannot be changed/)
    // A STANDARD template may be raised (more protection), never forced down.
    expect((t('SPECIAL_REQUESTS', { data_category: 'SENSITIVE' }) as { data_category: string }).data_category).toBe('SENSITIVE')
    expect(t('NOT_A_TEMPLATE')).toBe('Unknown question template.')
    expect(rq.lockedCategoryFor('ACCESSIBILITY')).toBe('SENSITIVE')
    expect(rq.lockedCategoryFor('HOW_DID_YOU_HEAR')).toBeNull()
    expect(rq.lockedCategoryFor(null)).toBeNull()
  })
})

describe('request + definition validation', () => {
  it('sensitive_consent counts only as the literal boolean true', () => {
    for (const x of [undefined, 'true', 1, 'yes', {}, null, false]) expect(validated(body({ sensitive_consent: x })).sensitive_consent, String(x)).toBe(false)
    expect(validated(body({ sensitive_consent: true })).sensitive_consent).toBe(true)
  })
  it('each supported type: valid shapes accepted, tampered shapes refused (server is authoritative)', () => {
    const val = (q: (typeof ALL)[number], answer: unknown) => rq.validateSubmittedResponses(ALL as never, q.scope === 'ORDER' ? [{ question_id: q.id, answer }] : [], q.scope === 'ATTENDEE' ? [[{ question_id: q.id, answer }]] : [[]])
    const ok = (r: unknown) => typeof r !== 'string'
    // Required answers elsewhere are missing in these single-question probes, so check the specific message instead.
    expect(val(Q.photo, 'yes')).toBe(`${Q.photo.label} must be yes or no.`)
    expect(val(Q.hear, 'Television')).toBe(`${Q.hear.label} must be one of the provided options.`)
    expect(val(Q.ecName, 123)).toBe(`${Q.ecName.label} must be text.`)
    expect(val(Q.ecName, 'x'.repeat(301))).toBe(`${Q.ecName.label} must be 300 characters or fewer.`)
    const multi = { id: 'q-m', label: 'Interests', help_text: null, field_type: 'MULTI_SELECT', required: false, scope: 'ORDER', options: ['Music', 'Art'], sort_order: 9, active: true, data_category: 'STANDARD', template_key: null }
    expect(ok(rq.validateSubmittedResponses([multi] as never, [{ question_id: 'q-m', answer: ['Music', 'Art'] }], []))).toBe(true)
    expect(rq.validateSubmittedResponses([multi] as never, [{ question_id: 'q-m', answer: ['Music', 'Cooking'] }], [])).toBe('Interests contains an invalid option.')
    expect(rq.validateSubmittedResponses([multi] as never, [{ question_id: 'other-event-q', answer: 'x' }], [])).toBe('Invalid response — unknown question.')
  })
  it('flatteners carry the help-text and category snapshots', () => {
    const f = rq.flattenOrderAnswers([{ question: Q.ecName as never, answer: 'Sam' }, { question: Q.photo as never, answer: false }])
    expect(f.helpTexts).toEqual(['', 'Photos may be used in event promotion.'])
    expect(f.categories).toEqual(['THIRD_PARTY', 'CONSENT'])
    expect(f.answersJson).toEqual(['"Sam"', 'false'])
  })
})

describe('free registration through Eve', () => {
  it('opt-in OFF: answers are refused before anything is written', async () => {
    responseQueue = [FREE_TYPE_ROW, ALL as never]
    const r = await free(false, body({ sensitive_consent: true }))
    expect(r).toEqual({ ok: false, code: 'RESPONSES_INVALID', message: 'This event is not collecting registration answers here.' })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('opt-in OFF, no answers, only optional questions: books exactly as before (no-question behaviour unchanged)', async () => {
    responseQueue = [FREE_TYPE_ROW, [Q.hear] as never]
    const r = await free(false, body({}, false))
    expect(r.ok).toBe(true)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it('opt-in ON: a required question left out is refused before anything is written', async () => {
    responseQueue = [FREE_TYPE_ROW, ALL as never]
    const b = body({ sensitive_consent: true })
    b.order_responses = FULL_ANSWERS.order_responses.filter(r => r.question_id !== 'q-photo')
    const r = await free(true, b)
    expect(r).toMatchObject({ ok: false, code: 'RESPONSES_INVALID', message: `${Q.photo.label} is required.` })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('opt-in ON: sensitive answers without the acknowledgement are refused before anything is written', async () => {
    responseQueue = [FREE_TYPE_ROW, ALL as never]
    const r = await free(true, body())
    expect(r).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it('opt-in ON with agreement: every answer is written atomically with snapshots; agreement time only on SENSITIVE/THIRD_PARTY rows; "No" stays false', async () => {
    responseQueue = [FREE_TYPE_ROW, ALL as never]
    const before = Date.now()
    const r = await free(true, body({ sensitive_consent: true }))
    expect(r.ok).toBe(true)
    expect(transactionMock).toHaveBeenCalledTimes(1)
    const call = responsesStatement()!
    const text = (call[0] as TemplateStringsArray).join(' ')
    expect(text).toMatch(/question_help_text_snapshot, data_category_snapshot, sensitive_consent_at/)
    expect(text).toMatch(/CASE WHEN r\.category IN \('SENSITIVE', 'THIRD_PARTY'\) THEN/)
    expect(JSON.stringify(call.slice(1))).toContain('THIRD_PARTY')
    const params = call.slice(1)
    const consentAt = params.find(p => typeof p === 'string' && /^\d{4}-\d\d-\d\dT/.test(p)) as string
    expect(new Date(consentAt).getTime()).toBeGreaterThanOrEqual(before - 1000)
    const flat = JSON.stringify(params)
    expect(flat).toContain('"false"') // photo consent "No" serialised as JSON false, not dropped or defaulted
    expect(flat).toContain('Photos may be used in event promotion.') // help-text snapshot
    expect(flat).toContain('Step-free access')
  })

  it('BRAINBASE surface is unchanged: no opt-in check, no acknowledgement needed, no consent time recorded', async () => {
    responseQueue = [FREE_TYPE_ROW, ALL as never]
    const r = await free(false, body(), 'BRAINBASE')
    expect(r.ok).toBe(true)
    const params = responsesStatement()!.slice(1)
    expect(params).toContain(null) // sensitiveConsentAt bound as null
    expect(params.some(p => typeof p === 'string' && /^\d{4}-\d\d-\d\dT\d\d:/.test(p))).toBe(false)
  })
})

describe('paid checkout through Eve', () => {
  it('opt-in OFF: answers refused before any reservation or Stripe call', async () => {
    responseQueue = [PAID_TYPE_ROW, ALL as never]
    const r = await paid(false, body({ sensitive_consent: true }))
    expect(r).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('opt-in ON without acknowledgement: refused before any reservation or Stripe call', async () => {
    responseQueue = [PAID_TYPE_ROW, ALL as never]
    const r = await paid(true, body())
    expect(r).toMatchObject({ ok: false, code: 'RESPONSES_INVALID' })
    expect(transactionMock).not.toHaveBeenCalled()
    expect(createCheckoutSessionMock).not.toHaveBeenCalled()
  })

  it('opt-in ON with acknowledgement: answers (with consent time) are written BEFORE the Stripe session is created', async () => {
    responseQueue = [PAID_TYPE_ROW, ALL as never, ...PADDING]
    const order: string[] = []
    sqlMock.mockImplementation(((strings: TemplateStringsArray) => {
      if (strings.join(' ').includes('INSERT INTO event_registration_responses')) order.push('responses')
      return Promise.resolve(responseQueue[callCount++] ?? [])
    }) as never)
    createCheckoutSessionMock.mockImplementation(async () => { order.push('stripe'); return { sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/pay/cs_test_1' } })
    transactionFinalResult = [{ id: 'order-1' }]
    transactionMock.mockImplementation(async () => [[], [], [], [{ id: 'order-1' }], [{ id: 'att-1' }]] as never)
    await paid(true, body({ sensitive_consent: true }))
    expect(order[0]).toBe('responses')
    const params = responsesStatement()!.slice(1)
    expect(params.some(p => typeof p === 'string' && /^\d{4}-\d\d-\d\dT/.test(p))).toBe(true)
    sqlMock.mockImplementation(((strings: TemplateStringsArray) => { void strings; return Promise.resolve(responseQueue[callCount++] ?? []) }) as never)
  })
})
