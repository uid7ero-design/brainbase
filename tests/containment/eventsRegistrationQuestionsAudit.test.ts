import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'

// Registration-question lifecycle audit — proves every manager mutation
// of a question writes the expected audit_logs row through the real
// routes:
//   POST  /api/events/[id]/questions                 -> .created
//   PATCH /api/events/[id]/questions/[qId]           -> .deactivated /
//         .reactivated / .category_changed / .updated (label, required,
//         scope, help text, options, sort order)
//   PATCH /api/events/[id]/questions/[qId]/reorder   -> .reordered
// and that the payload is configuration metadata only: never an answer,
// never help-text wording, never a select option's text (an option is
// exactly what an answer stores). Tenant scoping: the row is written under
// the caller's own organisation, and a refused or cross-tenant request
// writes nothing. Same sql-mock harness as eventsRegistrationQuestionsRoutes.

function asNextRequest(req: Request): NextRequest {
  return Object.assign(req, { nextUrl: new URL(req.url) }) as unknown as NextRequest
}

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/org')>()
  return { ...actual, requireSession: (...args: unknown[]) => requireSessionMock(...args) }
})

let responseQueue: unknown[][] = []
let callCount = 0
const sqlMock = vi.fn((strings: TemplateStringsArray) => {
  // Audit inserts never consume a queued response, so each test queues
  // only the route's own reads/writes.
  if (strings.join(' ').includes('INSERT INTO audit_logs')) return Promise.resolve([])
  return Promise.resolve(responseQueue[callCount++] ?? [])
})
const transactionMock = vi.fn(async () => [[], [] as unknown[]])
;(sqlMock as unknown as { transaction: typeof transactionMock }).transaction = transactionMock
vi.mock('@/lib/db', () => ({ default: sqlMock }))

vi.mock('@/lib/capabilities/requireCapability', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/capabilities/requireCapability')>()
  return { ...actual, requireCapability: vi.fn().mockResolvedValue({ key: 'events', config: {} }) }
})

const questionsRoute = await import('@/app/api/events/[id]/questions/route')
const questionIdRoute = await import('@/app/api/events/[id]/questions/[questionId]/route')
const reorderRoute = await import('@/app/api/events/[id]/questions/[questionId]/reorder/route')
const { logRegistrationQuestionCreated, logRegistrationQuestionUpdated } = await import('@/lib/events/auditLog')

function queue(...responses: unknown[][]) {
  responseQueue = responses
  callCount = 0
}
function req(method: string, body?: unknown) {
  return asNextRequest(new Request('http://localhost/x', {
    method, headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }))
}

type AuditRow = {
  id: string; organisation_id: string; user_id: string | null; action: string; resource_type: string; resource_id: string;
  before: Record<string, unknown> | null; after: Record<string, unknown> | null;
}
// insertAuditLog's VALUES order: id, organisation_id, user_id, action,
// resource_type, resource_id, before_state (JSON text), after_state.
function auditRows(): AuditRow[] {
  return sqlMock.mock.calls
    .filter(c => (c[0] as TemplateStringsArray).join(' ').includes('INSERT INTO audit_logs'))
    .map(c => {
      const v = (c as unknown as unknown[]).slice(1)
      return {
        id: v[0] as string, organisation_id: v[1] as string, user_id: v[2] as string | null, action: v[3] as string,
        resource_type: v[4] as string, resource_id: v[5] as string,
        before: v[6] ? JSON.parse(v[6] as string) : null, after: v[7] ? JSON.parse(v[7] as string) : null,
      }
    })
}

const EVENT_CTX = { params: Promise.resolve({ id: 'event-1' }) }
const QUESTION_CTX = { params: Promise.resolve({ id: 'event-1', questionId: 'q-1' }) }

// Sentinels that must never reach audit_logs: answer-equal option text and
// personal detail in organiser help text.
const OPTION_SENTINEL = 'OPTION-SENTINEL-7f3a'
const HELP_SENTINEL = 'Call Sam on 0400 000 000'
const ANSWER_SENTINEL = 'ANSWER-SENTINEL-91bc'

const EXISTING = {
  id: 'q-1', label: 'How did you hear about this event?', help_text: null as string | null, field_type: 'SINGLE_SELECT', required: false,
  scope: 'ORDER', options: ['Google', OPTION_SENTINEL] as string[] | null, sort_order: 0, active: true,
  data_category: 'STANDARD', template_key: null as string | null, answered: false,
}
// The UPDATE ... RETURNING row: the question columns, without `answered`.
const updatedFrom = (patch: Partial<typeof EXISTING>) => {
  const row: Record<string, unknown> = { ...EXISTING, ...patch }
  delete row.answered
  return row
}

beforeEach(() => {
  requireSessionMock.mockReset().mockResolvedValue({ userId: 'u1', organisationId: 'org-a', role: 'manager' })
  sqlMock.mockClear()
  transactionMock.mockReset().mockImplementation(async () => [[], []])
  queue()
})

describe('created', () => {
  it('POST writes event_registration_question.created with the safe shape, actor and the caller\'s organisation', async () => {
    const body = { label: 'How did you hear about this event?', help_text: HELP_SENTINEL, field_type: 'SINGLE_SELECT', scope: 'ORDER', options: ['Google', OPTION_SENTINEL] }
    queue([{ id: 'event-1' }], [{ ...updatedFrom({ help_text: HELP_SENTINEL }), id: 'q-new' }])
    const res = await questionsRoute.POST(req('POST', body), EVENT_CTX)
    expect(res.status).toBe(201)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      organisation_id: 'org-a', user_id: 'u1', action: 'event_registration_question.created',
      resource_type: 'event_registration_question', resource_id: 'q-new', before: null,
    })
    expect(rows[0].after).toEqual({
      event_id: 'event-1', label: 'How did you hear about this event?', field_type: 'SINGLE_SELECT', required: false, scope: 'ORDER',
      sort_order: 0, data_category: 'STANDARD', help_text_set: true, option_count: 2, active: true, template_key: null,
    })
    expect(JSON.stringify(rows)).not.toContain(OPTION_SENTINEL)
    expect(JSON.stringify(rows)).not.toContain(HELP_SENTINEL)
  })

  it('a rejected create (invalid body) writes no audit row', async () => {
    queue([{ id: 'event-1' }])
    const res = await questionsRoute.POST(req('POST', { label: 'x', field_type: 'NOPE', scope: 'ORDER' }), EVENT_CTX)
    expect(res.status).toBe(400)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('edited — one PATCH route, distinct actions', () => {
  async function patch(existing: typeof EXISTING, body: Record<string, unknown>, updated: Record<string, unknown>) {
    queue([{ id: 'event-1' }], [existing], [updated])
    const res = await questionIdRoute.PATCH(req('PATCH', body), QUESTION_CTX)
    return { res, rows: auditRows() }
  }

  it('deactivated: active true -> false', async () => {
    const { res, rows } = await patch(EXISTING, { active: false }, updatedFrom({ active: false }))
    expect(res.status).toBe(200)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'event_registration_question.deactivated', resource_id: 'q-1', organisation_id: 'org-a', user_id: 'u1' })
    expect(rows[0].before).toEqual({ event_id: 'event-1', active: true })
    expect(rows[0].after).toEqual({ event_id: 'event-1', active: false })
  })

  it('reactivated: active false -> true', async () => {
    const { rows } = await patch({ ...EXISTING, active: false }, { active: true }, updatedFrom({ active: true }))
    expect(rows.map(r => r.action)).toEqual(['event_registration_question.reactivated'])
  })

  it('category changed: STANDARD -> SENSITIVE is its own action, with the diff', async () => {
    const { rows } = await patch(EXISTING, { data_category: 'SENSITIVE' }, updatedFrom({ data_category: 'SENSITIVE' }))
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('event_registration_question.category_changed')
    expect(rows[0].before).toEqual({ event_id: 'event-1', data_category: 'STANDARD' })
    expect(rows[0].after).toEqual({ event_id: 'event-1', data_category: 'SENSITIVE' })
  })

  it('required/optional changed', async () => {
    const { rows } = await patch(EXISTING, { required: true }, updatedFrom({ required: true }))
    expect(rows.map(r => r.action)).toEqual(['event_registration_question.updated'])
    expect(rows[0].before).toEqual({ event_id: 'event-1', required: false })
    expect(rows[0].after).toEqual({ event_id: 'event-1', required: true })
  })

  it('scope changed (allowed while unanswered)', async () => {
    const { rows } = await patch(EXISTING, { scope: 'ATTENDEE' }, updatedFrom({ scope: 'ATTENDEE' }))
    expect(rows[0].action).toBe('event_registration_question.updated')
    expect(rows[0].after).toEqual({ event_id: 'event-1', scope: 'ATTENDEE' })
  })

  it('label (wording) edited — the organiser\'s question wording is logged before/after', async () => {
    const { rows } = await patch(EXISTING, { label: 'Where did you hear about us?' }, updatedFrom({ label: 'Where did you hear about us?' }))
    expect(rows[0].before).toEqual({ event_id: 'event-1', label: 'How did you hear about this event?' })
    expect(rows[0].after).toEqual({ event_id: 'event-1', label: 'Where did you hear about us?' })
  })

  it('help text and options edits are recorded as markers only — never their text', async () => {
    const { rows } = await patch(
      EXISTING,
      { help_text: HELP_SENTINEL, options: ['Google', OPTION_SENTINEL, 'Radio'] },
      updatedFrom({ help_text: HELP_SENTINEL, options: ['Google', OPTION_SENTINEL, 'Radio'] }),
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('event_registration_question.updated')
    expect(rows[0].before).toEqual({ event_id: 'event-1', help_text_set: false, option_count: 2 })
    expect(rows[0].after).toEqual({ event_id: 'event-1', help_text_set: true, option_count: 3, help_text_changed: true, options_changed: true })
    const text = JSON.stringify(rows)
    expect(text).not.toContain(HELP_SENTINEL)
    expect(text).not.toContain(OPTION_SENTINEL)
    expect(text).not.toContain('Radio')
  })

  it('a combined PATCH (deactivate + required) writes the transition row then the configuration row', async () => {
    const { rows } = await patch(EXISTING, { active: false, required: true }, updatedFrom({ active: false, required: true }))
    expect(rows.map(r => r.action)).toEqual(['event_registration_question.deactivated', 'event_registration_question.updated'])
  })

  it('a no-op PATCH (nothing changed) writes no audit row', async () => {
    const { res, rows } = await patch(EXISTING, { active: true }, updatedFrom({}))
    expect(res.status).toBe(200)
    expect(rows).toHaveLength(0)
  })

  it('answered-question immutability still holds: a type change is 409 and writes no audit row', async () => {
    queue([{ id: 'event-1' }], [{ ...EXISTING, answered: true }])
    const res = await questionIdRoute.PATCH(req('PATCH', { field_type: 'SHORT_TEXT', options: null }), QUESTION_CTX)
    expect(res.status).toBe(409)
    expect(auditRows()).toHaveLength(0)
  })

  it('answered-question immutability still holds: removing an existing option is 409 and writes no audit row', async () => {
    queue([{ id: 'event-1' }], [{ ...EXISTING, answered: true }])
    const res = await questionIdRoute.PATCH(req('PATCH', { options: ['Google'] }), QUESTION_CTX)
    expect(res.status).toBe(409)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('reordered', () => {
  it('a successful swap writes one .reordered row on the moved question', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-1' }])
    transactionMock.mockImplementationOnce(async () => [[], [{ id: 'q-1', sort_order: 0 }, { id: 'q-0', sort_order: 1 }]])
    const res = await reorderRoute.PATCH(req('PATCH', { direction: 'up' }), QUESTION_CTX)
    expect(res.status).toBe(200)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'event_registration_question.reordered', resource_type: 'event_registration_question', resource_id: 'q-1', organisation_id: 'org-a', user_id: 'u1' })
    expect(rows[0].before).toEqual({ event_id: 'event-1', sort_order: 1 })
    expect(rows[0].after).toEqual({ event_id: 'event-1', sort_order: 0, direction: 'up', swapped_with: 'q-0' })
  })

  it('no neighbour (already at the top) writes nothing', async () => {
    queue([{ id: 'event-1' }], [{ id: 'q-1' }])
    transactionMock.mockImplementationOnce(async () => [[], []])
    const res = await reorderRoute.PATCH(req('PATCH', { direction: 'up' }), QUESTION_CTX)
    expect(res.status).toBe(400)
    expect(auditRows()).toHaveLength(0)
  })
})

describe('tenant isolation', () => {
  it('another organisation\'s event: create, edit and reorder are 404 and write no audit row', async () => {
    queue([])
    expect((await questionsRoute.POST(req('POST', { label: 'x', field_type: 'SHORT_TEXT', scope: 'ORDER' }), EVENT_CTX)).status).toBe(404)
    queue([])
    expect((await questionIdRoute.PATCH(req('PATCH', { active: false }), QUESTION_CTX)).status).toBe(404)
    queue([])
    expect((await reorderRoute.PATCH(req('PATCH', { direction: 'up' }), QUESTION_CTX)).status).toBe(404)
    expect(auditRows()).toHaveLength(0)
  })

  it('a viewer cannot mutate, so no audit row is written', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u2', organisationId: 'org-a', role: 'viewer' })
    expect((await questionIdRoute.PATCH(req('PATCH', { active: false }), QUESTION_CTX)).status).toBe(403)
    expect(auditRows()).toHaveLength(0)
  })

  it('the row is written under the session organisation and actor, never a body-supplied one', async () => {
    requireSessionMock.mockResolvedValue({ userId: 'u-b', organisationId: 'org-b', role: 'admin' })
    queue([{ id: 'event-1' }], [EXISTING], [updatedFrom({ active: false })])
    await questionIdRoute.PATCH(req('PATCH', { active: false, organisation_id: 'org-a', user_id: 'u1' }), QUESTION_CTX)
    const rows = auditRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].organisation_id).toBe('org-b')
    expect(rows[0].user_id).toBe('u-b')
  })
})

describe('no answer text can reach the audit payload', () => {
  // The loggers' inputs are question rows only — there is no parameter an
  // answer could travel through. Even when every free-form field of the
  // question carries answer-like or personal text, only the label (the
  // organiser's own question wording) is written verbatim.
  it('created / updated payloads never contain option text, help text, or an answer smuggled onto the row', async () => {
    const row = {
      label: 'Dietary requirements', help_text: HELP_SENTINEL, field_type: 'SINGLE_SELECT', required: true, scope: 'ATTENDEE',
      options: [ANSWER_SENTINEL, OPTION_SENTINEL], sort_order: 0, active: true, data_category: 'SENSITIVE', template_key: null,
    }
    const smuggled = { ...row, answer: ANSWER_SENTINEL, responses: [{ answer: ANSWER_SENTINEL }] }
    await logRegistrationQuestionCreated({ organisationId: 'org-a', userId: 'u1', eventId: 'event-1', questionId: 'q-1', after: smuggled })
    await logRegistrationQuestionUpdated({
      organisationId: 'org-a', userId: 'u1', eventId: 'event-1', questionId: 'q-1',
      before: smuggled, after: { ...smuggled, options: [ANSWER_SENTINEL, OPTION_SENTINEL, 'Other'], help_text: `${HELP_SENTINEL}!`, active: false },
    })
    const text = JSON.stringify(auditRows())
    expect(auditRows().map(r => r.action)).toEqual([
      'event_registration_question.created', 'event_registration_question.deactivated', 'event_registration_question.updated',
    ])
    for (const s of [ANSWER_SENTINEL, OPTION_SENTINEL, HELP_SENTINEL, '"answer"', '"responses"']) expect(text).not.toContain(s)
  })
})
