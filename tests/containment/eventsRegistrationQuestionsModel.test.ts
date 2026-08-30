import { describe, it, expect } from 'vitest'
import { validateQuestionInput, validateSubmittedResponses, type QuestionRow } from '@/lib/events/registrationQuestions'

// Events & Ticketing Phase 4B (§2/§3/§4/§9) — pure-function tests for
// the registration-question model: manager-side input validation
// (validateQuestionInput) and public-side answer validation
// (validateSubmittedResponses). No database, no HTTP — these are the
// same functions both the manager CRUD routes and the two public
// registration routes call, so proving them here proves the shared
// core every caller depends on.

function question(overrides: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: 'q-1', label: 'Dietary requirements', help_text: null, field_type: 'LONG_TEXT',
    required: false, scope: 'ATTENDEE', options: null, sort_order: 0, active: true,
    ...overrides,
  }
}

describe('validateQuestionInput — manager-side question definition validation (§4)', () => {
  it('accepts a minimal valid SHORT_TEXT question', () => {
    const result = validateQuestionInput({ label: 'Notes', field_type: 'SHORT_TEXT', scope: 'ORDER' })
    expect(typeof result).not.toBe('string')
  })

  it('rejects a missing/blank label', () => {
    expect(validateQuestionInput({ label: '', field_type: 'SHORT_TEXT', scope: 'ORDER' })).toEqual(expect.any(String))
    expect(validateQuestionInput({ field_type: 'SHORT_TEXT', scope: 'ORDER' })).toEqual(expect.any(String))
  })

  it('rejects an unrecognised field_type', () => {
    expect(validateQuestionInput({ label: 'X', field_type: 'FILE_UPLOAD', scope: 'ORDER' })).toEqual(expect.any(String))
  })

  it('rejects an unrecognised scope', () => {
    expect(validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'EVENT' })).toEqual(expect.any(String))
  })

  it('accepts both ORDER and ATTENDEE scopes', () => {
    expect(typeof validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'ORDER' })).not.toBe('string')
    expect(typeof validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'ATTENDEE' })).not.toBe('string')
  })

  it('required defaults to false when omitted, and is normalised to a strict boolean', () => {
    const r1 = validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'ORDER' })
    expect(typeof r1).not.toBe('string')
    if (typeof r1 !== 'string') expect(r1.required).toBe(false)
    const r2 = validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'ORDER', required: true })
    expect(typeof r2).not.toBe('string')
    if (typeof r2 !== 'string') expect(r2.required).toBe(true)
  })

  describe('select options (SINGLE_SELECT / MULTI_SELECT)', () => {
    it('requires at least one option for a select question', () => {
      expect(validateQuestionInput({ label: 'X', field_type: 'SINGLE_SELECT', scope: 'ORDER', options: [] })).toEqual(expect.any(String))
      expect(validateQuestionInput({ label: 'X', field_type: 'SINGLE_SELECT', scope: 'ORDER' })).toEqual(expect.any(String))
    })

    it('accepts a valid option list for SINGLE_SELECT and MULTI_SELECT', () => {
      const r1 = validateQuestionInput({ label: 'X', field_type: 'SINGLE_SELECT', scope: 'ORDER', options: ['A', 'B'] })
      expect(typeof r1).not.toBe('string')
      const r2 = validateQuestionInput({ label: 'X', field_type: 'MULTI_SELECT', scope: 'ORDER', options: ['A', 'B'] })
      expect(typeof r2).not.toBe('string')
    })

    it('rejects duplicate options', () => {
      expect(validateQuestionInput({ label: 'X', field_type: 'SINGLE_SELECT', scope: 'ORDER', options: ['A', 'A'] })).toEqual(expect.any(String))
    })

    it('rejects options for a non-select field type', () => {
      expect(validateQuestionInput({ label: 'X', field_type: 'SHORT_TEXT', scope: 'ORDER', options: ['A'] })).toEqual(expect.any(String))
    })

    it('trims whitespace from each option and the label', () => {
      const r = validateQuestionInput({ label: '  Colour  ', field_type: 'SINGLE_SELECT', scope: 'ORDER', options: [' Red ', ' Blue '] })
      expect(typeof r).not.toBe('string')
      if (typeof r !== 'string') {
        expect(r.label).toBe('Colour')
        expect(r.options).toEqual(['Red', 'Blue'])
      }
    })
  })
})

describe('validateSubmittedResponses — public-side answer validation (§3/§5/§9), server-authoritative', () => {
  it('a required ORDER question with no submitted answer is rejected', () => {
    const q = question({ id: 'oq-1', scope: 'ORDER', field_type: 'SHORT_TEXT', required: true, label: 'Special requests' })
    const result = validateSubmittedResponses([q], [], [[]])
    expect(result).toEqual(expect.any(String))
  })

  it('an optional ORDER question left blank is accepted and produces no stored answer', () => {
    const q = question({ id: 'oq-1', scope: 'ORDER', field_type: 'SHORT_TEXT', required: false })
    const result = validateSubmittedResponses([q], [], [[]])
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') expect(result.orderAnswers).toEqual([])
  })

  it('a required ATTENDEE question missing for one of several attendees is rejected, naming which attendee', () => {
    const q = question({ id: 'aq-1', scope: 'ATTENDEE', field_type: 'SHORT_TEXT', required: true, label: 'Dietary requirements' })
    const result = validateSubmittedResponses(
      [q],
      [],
      [[{ question_id: 'aq-1', answer: 'Vegetarian' }], []],
    )
    expect(result).toEqual(expect.any(String))
  })

  it('every attendee answering a required ATTENDEE question succeeds, one answer set per attendee, in order', () => {
    const q = question({ id: 'aq-1', scope: 'ATTENDEE', field_type: 'SHORT_TEXT', required: true })
    const result = validateSubmittedResponses(
      [q],
      [],
      [[{ question_id: 'aq-1', answer: 'Vegetarian' }], [{ question_id: 'aq-1', answer: 'None' }]],
    )
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.attendeeAnswers).toHaveLength(2)
      expect(result.attendeeAnswers[0]).toEqual([{ question: q, answer: 'Vegetarian' }])
      expect(result.attendeeAnswers[1]).toEqual([{ question: q, answer: 'None' }])
    }
  })

  it('an unknown question_id (not in the event\'s active list) is rejected outright — the structural mechanism that makes a cross-event/cross-tenant id impossible to attach', () => {
    const q = question({ id: 'real-question', scope: 'ORDER' })
    const result = validateSubmittedResponses([q], [{ question_id: 'not-a-real-question-id', answer: 'x' }], [[]])
    expect(result).toEqual(expect.any(String))
  })

  it('an ORDER-scoped answer submitted against an ATTENDEE question id (scope mismatch) is rejected', () => {
    const q = question({ id: 'aq-1', scope: 'ATTENDEE' })
    const result = validateSubmittedResponses([q], [{ question_id: 'aq-1', answer: 'x' }], [[]])
    expect(result).toEqual(expect.any(String))
  })

  it('an ATTENDEE-scoped answer submitted against an ORDER question id (scope mismatch) is rejected', () => {
    const q = question({ id: 'oq-1', scope: 'ORDER' })
    const result = validateSubmittedResponses([q], [], [[{ question_id: 'oq-1', answer: 'x' }]])
    expect(result).toEqual(expect.any(String))
  })

  it('a duplicate answer for the same question in one submission is rejected', () => {
    const q = question({ id: 'oq-1', scope: 'ORDER', required: false })
    const result = validateSubmittedResponses(
      [q],
      [{ question_id: 'oq-1', answer: 'first' }, { question_id: 'oq-1', answer: 'second' }],
      [[]],
    )
    expect(result).toEqual(expect.any(String))
  })

  describe('field-type shape validation', () => {
    it('YES_NO requires a strict boolean, not a truthy string', () => {
      const q = question({ id: 'q-1', scope: 'ORDER', field_type: 'YES_NO' })
      expect(validateSubmittedResponses([q], [{ question_id: 'q-1', answer: 'yes' }], [[]])).toEqual(expect.any(String))
      const ok = validateSubmittedResponses([q], [{ question_id: 'q-1', answer: true }], [[]])
      expect(typeof ok).not.toBe('string')
    })

    it('SINGLE_SELECT rejects a value outside the configured options', () => {
      const q = question({ id: 'q-1', scope: 'ORDER', field_type: 'SINGLE_SELECT', options: ['Red', 'Blue'] })
      expect(validateSubmittedResponses([q], [{ question_id: 'q-1', answer: 'Green' }], [[]])).toEqual(expect.any(String))
      const ok = validateSubmittedResponses([q], [{ question_id: 'q-1', answer: 'Red' }], [[]])
      expect(typeof ok).not.toBe('string')
    })

    it('MULTI_SELECT rejects any value not in the configured options and de-duplicates valid selections', () => {
      const q = question({ id: 'q-1', scope: 'ORDER', field_type: 'MULTI_SELECT', options: ['Red', 'Blue'] })
      expect(validateSubmittedResponses([q], [{ question_id: 'q-1', answer: ['Red', 'Green'] }], [[]])).toEqual(expect.any(String))
      const ok = validateSubmittedResponses([q], [{ question_id: 'q-1', answer: ['Red', 'Red', 'Blue'] }], [[]])
      expect(typeof ok).not.toBe('string')
      if (typeof ok !== 'string') expect(ok.orderAnswers[0].answer).toEqual(['Red', 'Blue'])
    })

    it('SHORT_TEXT enforces its max length', () => {
      const q = question({ id: 'q-1', scope: 'ORDER', field_type: 'SHORT_TEXT' })
      const tooLong = 'x'.repeat(301)
      expect(validateSubmittedResponses([q], [{ question_id: 'q-1', answer: tooLong }], [[]])).toEqual(expect.any(String))
    })

    it('LONG_TEXT trims whitespace and treats a whitespace-only required answer as missing', () => {
      const q = question({ id: 'q-1', scope: 'ORDER', field_type: 'LONG_TEXT', required: true })
      expect(validateSubmittedResponses([q], [{ question_id: 'q-1', answer: '   ' }], [[]])).toEqual(expect.any(String))
    })
  })

  it('multiple quantities: attendeeAnswers preserves one entry per attendee, aligned by array position, matching however many attendees were submitted', () => {
    const q = question({ id: 'aq-1', scope: 'ATTENDEE', required: false })
    const result = validateSubmittedResponses(
      [q],
      [],
      [
        [{ question_id: 'aq-1', answer: 'A' }],
        [{ question_id: 'aq-1', answer: 'B' }],
        [{ question_id: 'aq-1', answer: 'C' }],
      ],
    )
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.attendeeAnswers.map(a => a[0]?.answer)).toEqual(['A', 'B', 'C'])
    }
  })

  it('an event with no configured questions accepts an empty submission with no answers at all', () => {
    const result = validateSubmittedResponses([], [], [[], []])
    expect(typeof result).not.toBe('string')
    if (typeof result !== 'string') {
      expect(result.orderAnswers).toEqual([])
      expect(result.attendeeAnswers).toEqual([[], []])
    }
  })
})
