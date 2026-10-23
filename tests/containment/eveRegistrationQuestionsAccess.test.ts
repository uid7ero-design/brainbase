import { describe, it, expect, vi, beforeEach } from 'vitest'

// Eve registration questions (ADR 0013 §4a) — who can see answers, what the
// public Eve event read exposes, and the organiser question routes (Eve
// opt-in toggle, history-safe edits). Every dependency below the handler is
// mocked; no database, network or Stripe call happens in this file.

process.env.TICKETING_API_SECRET = 'gate-test-secret-0123456789abcdef0123456789abcdef'
process.env.EVE_SESSION_SECRET = 'eve-test-secret-0123456789abcdef0123456789abcdef'

// ── shared mocks ─────────────────────────────────────────────────────
let sqlQueue: unknown[][] = []
const sqlCalls: { text: string; params: unknown[] }[] = []
vi.mock('@/lib/db', () => ({
  default: (strings: TemplateStringsArray, ...params: unknown[]) => {
    sqlCalls.push({ text: strings.join(' '), params })
    return Promise.resolve(sqlQueue.shift() ?? [])
  },
}))

let eventsRole = 'manager'
vi.mock('@/lib/events/authorize', () => ({
  authorizeEventsRequest: async (minRole: string) => {
    const order = ['viewer', 'manager', 'admin', 'super_admin']
    if (order.indexOf(eventsRole) < order.indexOf(minRole)) return { ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) }
    return { ok: true, session: { organisationId: 'org-a', userId: 'u-1', role: eventsRole, name: 'Pat' } }
  },
}))
vi.mock('@/lib/capabilities/requireCapability', () => ({ checkCapability: async () => ({ allowed: false }) }))

let ticketingRole = 'manager'
vi.mock('@/lib/ticketing/authorize', () => ({
  authorizeTicketingApiRequest: async () => ({
    ok: true,
    context: { sessionId: 's', userId: 'u-1', organisationId: 'org-a', homeOrganisationId: 'org-a', role: ticketingRole, name: 'Pat', organisationSlug: 'acme', organisationName: 'Acme' },
  }),
}))
vi.mock('@/lib/ticketing/rateLimit', () => ({ LIMITS: {}, limit: async () => ({ allowed: true }) }))

const ANSWER = (label: string, answer: unknown, category = 'STANDARD') => ({
  id: `r-${label}`, question_id: `q-${label}`, label, field_type: typeof answer === 'boolean' ? 'YES_NO' : 'SHORT_TEXT', answer,
  help_text: null, data_category: category,
  sensitive_consent_at: category === 'SENSITIVE' || category === 'THIRD_PARTY' ? '2026-10-23T10:00:00.000Z' : null, redacted_at: null,
})
const REG_ROWS = [{
  id: 'order-1', purchaser_name: 'Jane', purchaser_email: 'jane@example.test', status: 'CONFIRMED', payment_status: 'NOT_REQUIRED',
  total_cents: 0, payment_total_cents: 0, discount_cents: 0, currency: 'aud', created_at: '2026-10-23T10:00:00Z', paid_at: null, refunded_at: null,
  ticket_type_name: 'General', session_name: null, quantity: 1, crm_contact_id: 'crm-1',
  order_responses: [ANSWER('Emergency Contact Name', 'Sam Contact', 'THIRD_PARTY'), ANSWER('Consent to event photography/videography', false, 'CONSENT')],
  attendees: [{ id: 'att-1', name: 'Jane', email: null, checked_in_at: null, checked_in_by: null, ticket_token: 'tok-secret', responses: [ANSWER('Accessibility requirements', 'Step-free access', 'SENSITIVE')] }],
}]
const listEventRegistrationRows = vi.fn(async () => REG_ROWS)
vi.mock('@/lib/events/organiserReads', () => ({
  listEventRegistrationRows: (...a: unknown[]) => listEventRegistrationRows(...(a as [])),
  listOrganisationEvents: vi.fn(async () => []),
  getOrganisationEvent: vi.fn(async () => null),
}))

const audit = vi.fn()
vi.mock('@/lib/events/auditLog', async orig => ({ ...(await orig<typeof import('@/lib/events/auditLog')>()), logEventEveQuestionsToggled: (...a: unknown[]) => audit(...a) }))

// Public read dependencies (same isolation as evePaidCheckoutKillSwitch.test.ts).
const getPublicEventDetail = vi.fn()
vi.mock('@/lib/events/publicEventDetail', () => ({ getPublicEventDetail: (...a: unknown[]) => getPublicEventDetail(...a) }))
vi.mock('@/lib/events/publicResolve', () => ({ resolvePublicEvent: vi.fn() }))
vi.mock('@/lib/events/services/paidCheckout', () => ({ startPaidCheckout: vi.fn() }))
vi.mock('@/lib/events/services/freeRegistration', () => ({ registerFreeOrder: vi.fn() }))
vi.mock('@/lib/events/publicTicket', () => ({ getPublicTicketDetail: vi.fn() }))
vi.mock('@/lib/events/publicBooking', () => ({ getPublicBookingDetail: vi.fn() }))
vi.mock('@/lib/events/qr', () => ({ generateTicketQrSvg: vi.fn() }))
vi.mock('@/lib/crm/eventSync', () => ({ syncEventOrderContact: vi.fn(), recordEventBookingActivity: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/quote/route', () => ({ POST: vi.fn() }))
vi.mock('@/app/api/public/events/[organisationSlug]/[eventSlug]/checkout/status/route', () => ({ GET: vi.fn() }))

const organiserApi = await import('@/lib/ticketing/organiserApi')
const publicApi = await import('@/lib/ticketing/publicApi')
const ordersRoute = await import('@/app/api/events/[id]/orders/route')
const questionsRoute = await import('@/app/api/events/[id]/questions/route')
const questionRoute = await import('@/app/api/events/[id]/questions/[questionId]/route')
const holdRoute = await import('@/app/api/events/[id]/answers-legal-hold/route')
const responseRoute = await import('@/app/api/events/[id]/orders/[orderId]/responses/[responseId]/route')
const cronRoute = await import('@/app/api/cron/registration-answer-retention/route')

const GATE = { 'x-ticketing-api-key': process.env.TICKETING_API_SECRET! }
const SECRET_ANSWER_TEXT = /Sam Contact|Step-free access|Emergency Contact|Accessibility requirements|photography/

beforeEach(() => {
  sqlQueue = []; sqlCalls.length = 0; audit.mockReset(); getPublicEventDetail.mockReset(); listEventRegistrationRows.mockClear()
  eventsRole = 'manager'; ticketingRole = 'manager'
})

describe('Eve organiser API: answers are manager+ only', () => {
  const orgReq = () => new Request('http://bb.test/x', { headers: GATE })

  it.each(['manager', 'admin', 'super_admin'])('%s sees order and attendee answers as recorded (snapshot fields only, no ids, no ticket token)', async role => {
    ticketingRole = role
    const orders = await (await organiserApi.handleOrganiserOrders(orgReq(), 'event-1')).json()
    expect(orders.orders[0].answers).toEqual([
      { label: 'Emergency Contact Name', field_type: 'SHORT_TEXT', help_text: null, answer: 'Sam Contact', data_category: 'THIRD_PARTY', sensitive_consent_at: '2026-10-23T10:00:00.000Z', redacted_at: null },
      { label: 'Consent to event photography/videography', field_type: 'YES_NO', help_text: null, answer: false, data_category: 'CONSENT', sensitive_consent_at: null, redacted_at: null },
    ])
    const attendees = await (await organiserApi.handleOrganiserAttendees(orgReq(), 'event-1')).json()
    expect(attendees.attendees[0].answers[0]).toMatchObject({ label: 'Accessibility requirements', answer: 'Step-free access', data_category: 'SENSITIVE' })
    const text = JSON.stringify([orders, attendees])
    expect(text).not.toMatch(/"question_id"|"r-|tok-secret|crm-1/)
  })

  it.each(['viewer', 'analyst'])('%s gets no answers at all — the key is absent, not empty', async role => {
    ticketingRole = role
    const orders = await (await organiserApi.handleOrganiserOrders(orgReq(), 'event-1')).json()
    const attendees = await (await organiserApi.handleOrganiserAttendees(orgReq(), 'event-1')).json()
    for (const o of orders.orders ?? []) expect(o).not.toHaveProperty('answers')
    for (const a of attendees.attendees ?? []) expect(a).not.toHaveProperty('answers')
    expect(JSON.stringify([orders, attendees])).not.toMatch(SECRET_ANSWER_TEXT)
  })

  it('tenant isolation: the reader is always called with the organisation from the verified context', async () => {
    await organiserApi.handleOrganiserOrders(orgReq(), 'event-1')
    expect((listEventRegistrationRows.mock.calls[0] as unknown[])[0]).toBe('org-a')
  })
})

describe('BrainBase registrations route: answers are manager+ only', () => {
  const get = () => ordersRoute.GET(new Request('http://bb.test/api/events/event-1/orders'), { params: Promise.resolve({ id: 'event-1' }) })

  it('manager sees answers', async () => {
    const body = await (await get()).json()
    expect(body.orders[0].order_responses).toHaveLength(2)
    expect(body.orders[0].attendees[0].responses).toHaveLength(1)
  })

  it('viewer: order and attendee answers removed entirely; everything else unchanged', async () => {
    eventsRole = 'viewer'
    const body = await (await get()).json()
    expect(body.orders[0]).not.toHaveProperty('order_responses')
    expect(body.orders[0].attendees[0]).not.toHaveProperty('responses')
    expect(body.orders[0].attendees[0].name).toBe('Jane')
    expect(body.orders[0].purchaser_name).toBe('Jane')
    expect(JSON.stringify(body)).not.toMatch(SECRET_ANSWER_TEXT)
  })
})

describe('public Eve event read: question definitions only when the event is opted in', () => {
  const Qs = [
    { id: 'q1', label: 'Emergency Contact Name', help_text: null, field_type: 'SHORT_TEXT', required: true, scope: 'ORDER', options: null, sort_order: 0, data_category: 'THIRD_PARTY' },
    { id: 'q2', label: 'How did you hear about this event?', help_text: null, field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER', options: ['Radio'], sort_order: 1, data_category: 'STANDARD' },
  ]
  const read = async (eveQuestionsEnabled: boolean, questions = Qs) => {
    getPublicEventDetail.mockResolvedValue({ ok: true, detail: { event: { name: 'E' }, ticket_types: [], questions, has_promotions: false, organisationName: 'Acme' }, eveQuestionsEnabled })
    return (await publicApi.handleTicketingPublicEvent(new Request('http://bb.test/x', { headers: GATE }), { organisationSlug: 'acme', eventSlug: 'e' })).json()
  }

  it('opted in: definitions (incl. category) are returned; never answers, never the opt-in value itself', async () => {
    const body = await read(true)
    expect(body.questions).toEqual(Qs)
    expect(body.questions_block_booking).toBe(false)
    expect(JSON.stringify(body)).not.toMatch(/eve_questions_enabled|eveQuestionsEnabled|"answer"|responses/)
  })

  it('not opted in: no definitions; a required question sets questions_block_booking', async () => {
    const body = await read(false)
    expect(body.questions).toEqual([])
    expect(body.questions_block_booking).toBe(true)
  })

  it('not opted in with only optional questions (LD Tennis / School Test shape): no definitions, booking not blocked', async () => {
    const body = await read(false, [Qs[1]])
    expect(body.questions).toEqual([])
    expect(body.questions_block_booking).toBe(false)
  })
})

describe('organiser question routes', () => {
  const ctx = { params: Promise.resolve({ id: 'event-1' }) }
  const patchEve = (body: unknown) => questionsRoute.PATCH(new Request('http://bb.test/x', { method: 'PATCH', body: JSON.stringify(body) }) as never, ctx)

  it('Eve opt-in toggle: manager+ only, boolean only, tenant-scoped UPDATE, audited only when it changes', async () => {
    eventsRole = 'viewer'
    expect((await patchEve({ eve_questions_enabled: true })).status).toBe(403)

    eventsRole = 'manager'
    sqlQueue = [[{ id: 'event-1', eve_questions_enabled: false }]]
    expect((await patchEve({ eve_questions_enabled: 'true' })).status).toBe(400)

    sqlQueue = [[{ id: 'event-1', eve_questions_enabled: false }], []]
    const res = await patchEve({ eve_questions_enabled: true })
    expect(res.status).toBe(200)
    const update = sqlCalls.find(c => c.text.includes('UPDATE events'))!
    expect(update.text).toMatch(/organisation_id =/)
    expect(update.params).toEqual(expect.arrayContaining([true, 'event-1', 'org-a']))
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'event-1', before: false, after: true, organisationId: 'org-a' }))

    audit.mockReset()
    sqlQueue = [[{ id: 'event-1', eve_questions_enabled: true }], []]
    await patchEve({ eve_questions_enabled: true })
    expect(audit).not.toHaveBeenCalled()
  })

  it('another organisation\'s event -> 404, nothing updated', async () => {
    sqlQueue = [[]]
    expect((await patchEve({ eve_questions_enabled: true })).status).toBe(404)
    expect(sqlCalls.some(c => c.text.includes('UPDATE'))).toBe(false)
  })

  const patchQ = (body: unknown) => questionRoute.PATCH(
    new Request('http://bb.test/x', { method: 'PATCH', body: JSON.stringify(body) }) as never,
    { params: Promise.resolve({ id: 'event-1', questionId: 'q-1' }) },
  )
  const EXISTING = (answered: boolean) => [{ id: 'q-1', label: 'How did you hear?', help_text: null, field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER', options: ['Radio', 'Friend'], sort_order: 0, active: true, data_category: 'STANDARD', template_key: null, answered }]

  it('answered question: type and scope changes are refused (409), nothing written', async () => {
    for (const change of [{ field_type: 'MULTI_SELECT' }, { scope: 'ATTENDEE' }]) {
      sqlQueue = [[{ id: 'event-1' }], EXISTING(true)]; sqlCalls.length = 0
      const res = await patchQ(change)
      expect(res.status, JSON.stringify(change)).toBe(409)
      expect(sqlCalls.some(c => c.text.includes('UPDATE'))).toBe(false)
    }
  })

  it('answered question: removing or renaming an option is refused; adding one is allowed', async () => {
    sqlQueue = [[{ id: 'event-1' }], EXISTING(true)]
    expect((await patchQ({ options: ['Radio'] })).status).toBe(409)
    sqlQueue = [[{ id: 'event-1' }], EXISTING(true)]
    expect((await patchQ({ options: ['Radio', 'A friend'] })).status).toBe(409)
    sqlQueue = [[{ id: 'event-1' }], EXISTING(true), [{ id: 'q-1' }]]
    expect((await patchQ({ options: ['Radio', 'Friend', 'Poster'] })).status).toBe(200)
  })

  it('answered question: wording, required and category edits are allowed (answers keep their own snapshots)', async () => {
    sqlQueue = [[{ id: 'event-1' }], EXISTING(true), [{ id: 'q-1' }]]
    const res = await patchQ({ label: 'How did you hear about us?', data_category: 'SENSITIVE' })
    expect(res.status).toBe(200)
    const update = sqlCalls.find(c => c.text.includes('UPDATE event_registration_questions'))!
    expect(update.params).toEqual(expect.arrayContaining(['How did you hear about us?', 'SENSITIVE']))
  })

  it('a built-in protected question cannot be lowered, and its template link can never be changed or removed', async () => {
    const TEMPLATED = [{ ...EXISTING(false)[0], label: 'Accessibility or support requirements', field_type: 'LONG_TEXT', scope: 'ATTENDEE', options: null, data_category: 'SENSITIVE', template_key: 'ACCESSIBILITY' }]
    sqlQueue = [[{ id: 'event-1' }], TEMPLATED]; sqlCalls.length = 0
    let res = await patchQ({ data_category: 'STANDARD' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/cannot be changed/)
    for (const template_key of [null, 'SPECIAL_REQUESTS']) {
      sqlQueue = [[{ id: 'event-1' }], TEMPLATED]
      res = await patchQ({ template_key, data_category: 'STANDARD' })
      expect(res.status, String(template_key)).toBe(400)
    }
    expect(sqlCalls.some(c => c.text.includes('UPDATE'))).toBe(false)
    sqlQueue = [[{ id: 'event-1' }], EXISTING(false)]
    expect((await patchQ({ template_key: 'ACCESSIBILITY' })).status).toBe(400) // can't attach a template afterwards either
  })

  it('unanswered question: type and scope can still change', async () => {
    sqlQueue = [[{ id: 'event-1' }], EXISTING(false), [{ id: 'q-1' }]]
    expect((await patchQ({ field_type: 'MULTI_SELECT', scope: 'ATTENDEE' })).status).toBe(200)
  })

  it('question list: definitions only, never answers; answer COUNTS are manager+ only (a viewer\'s query never computes them)', async () => {
    eventsRole = 'viewer'
    sqlQueue = [[{ id: 'event-1', eve_questions_enabled: false }], [{ id: 'q-1', label: 'L' }]]
    let res = await questionsRoute.GET(new Request('http://bb.test/x') as never, ctx)
    expect(await res.json()).toEqual({ questions: [{ id: 'q-1', label: 'L' }], eve_questions_enabled: false })
    let sel = sqlCalls.find(c => c.text.includes('FROM event_registration_questions'))!
    expect(sel.text).not.toMatch(/response_count|event_registration_responses|r\.answer/)

    eventsRole = 'manager'; sqlCalls.length = 0
    sqlQueue = [[{ id: 'event-1', eve_questions_enabled: false }], [{ id: 'q-1', label: 'L', response_count: 3 }]]
    res = await questionsRoute.GET(new Request('http://bb.test/x') as never, ctx)
    expect((await res.json()).questions[0].response_count).toBe(3)
    sel = sqlCalls.find(c => c.text.includes('FROM event_registration_questions'))!
    expect(sel.text).toMatch(/response_count/)
    expect(sel.text).not.toMatch(/r\.answer/)
  })
})

describe('answer retention controls', () => {
  const hold = (body: unknown) => holdRoute.PATCH(new Request('http://bb.test/x', { method: 'PATCH', body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: 'event-1' }) })

  it('legal hold: admin+ only; reason codes only; tenant-scoped; audited as a code, never free text', async () => {
    eventsRole = 'manager'
    expect((await hold({ reason: 'COMPLAINT' })).status).toBe(403)
    eventsRole = 'admin'
    expect((await hold({ reason: 'because Jane complained about X' })).status).toBe(400)
    sqlQueue = [[]]
    expect((await hold({ reason: 'COMPLAINT' })).status).toBe(404) // not this organisation's event

    sqlQueue = [[{ answers_legal_hold: null }], []]; sqlCalls.length = 0
    const res = await hold({ reason: 'INCIDENT' })
    expect(res.status).toBe(200)
    const upd = sqlCalls.find(c => c.text.includes('UPDATE events'))!
    expect(upd.text).toMatch(/answers_legal_hold/)
    expect(upd.params).toEqual(expect.arrayContaining(['INCIDENT', 'event-1', 'org-a']))

    sqlQueue = [[{ answers_legal_hold: null }], []]; sqlCalls.length = 0
    expect((await hold({ reason: 'DISPUTE', order_id: 'order-1' })).status).toBe(200)
    expect(sqlCalls.find(c => c.text.includes('UPDATE event_orders'))!.params).toEqual(expect.arrayContaining(['DISPUTE', 'order-1', 'event-1', 'org-a']))
  })

  it('an answer removed under the retention policy cannot be re-entered by editing', async () => {
    sqlQueue = [[{ id: 'r-1', question_id: 'q-1', field_type_snapshot: 'LONG_TEXT', redacted_at: '2027-01-01T00:00:00Z' }]]; sqlCalls.length = 0
    const res = await responseRoute.PATCH(
      new Request('http://bb.test/x', { method: 'PATCH', body: JSON.stringify({ answer: 'restored text' }) }) as never,
      { params: Promise.resolve({ id: 'event-1', orderId: 'order-1', responseId: 'r-1' }) },
    )
    expect(res.status).toBe(409)
    expect(sqlCalls.some(c => c.text.includes('UPDATE'))).toBe(false)
  })

  it('retention cron: CRON_SECRET required; report-only unless EVE_ANSWER_RETENTION_ENFORCE is exactly "true"', async () => {
    const call = (auth?: string) => cronRoute.GET(new Request('http://bb.test/x', { headers: auth ? { authorization: auth } : {} }))
    delete process.env.CRON_SECRET
    expect((await call('Bearer x')).status).toBe(401)
    process.env.CRON_SECRET = 'cron-test-secret'
    expect((await call('Bearer wrong')).status).toBe(401)
    for (const v of [undefined, 'false', 'TRUE', ' true', '1']) {
      if (v === undefined) delete process.env.EVE_ANSWER_RETENTION_ENFORCE; else process.env.EVE_ANSWER_RETENTION_ENFORCE = v
      sqlQueue = [[{ event_id: 'event-1', category: 'SENSITIVE', held: false, n: 2 }]]; sqlCalls.length = 0
      const body = await (await call('Bearer cron-test-secret')).json()
      expect(body, String(v)).toMatchObject({ mode: 'dry-run', due: 2, redacted: 0 })
      expect(sqlCalls.some(c => /UPDATE/.test(c.text)), String(v)).toBe(false)
    }
    process.env.EVE_ANSWER_RETENTION_ENFORCE = 'true'
    sqlQueue = [[{ event_id: 'event-1', category: 'SENSITIVE', held: false, n: 1 }], [{ id: 'r-9', organisation_id: 'org-a', event_id: 'event-1', category: 'SENSITIVE' }]]; sqlCalls.length = 0
    const body = await (await call('Bearer cron-test-secret')).json()
    expect(body).toMatchObject({ mode: 'enforce', redacted: 1 })
    expect(sqlCalls.some(c => /UPDATE event_registration_responses/.test(c.text))).toBe(true)
    delete process.env.EVE_ANSWER_RETENTION_ENFORCE; delete process.env.CRON_SECRET
  })
})
