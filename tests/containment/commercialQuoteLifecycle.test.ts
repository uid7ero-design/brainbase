import { describe, it, expect } from 'vitest'
import {
  QUOTE_STATUSES, isQuoteEditable, isValidQuoteTransition,
  assertQuoteTransition, assertQuoteEditable, type QuoteStatus,
} from '@/lib/commercial/quoteLifecycle'

// Phase C3 — the central quote transition authority. Every legal and
// illegal transition is enumerated explicitly here (not just a handful
// of examples) so a future edit to the transition table cannot silently
// legalise/forbid a transition without a test noticing.

describe('Phase C3 — quote lifecycle: exactly five statuses, no over-modelling', () => {
  it('has exactly DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED — no CANCELLED/VOID', () => {
    expect(QUOTE_STATUSES).toEqual(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'])
  })
})

describe('Phase C3 — isQuoteEditable(): DRAFT only', () => {
  it('DRAFT is editable', () => expect(isQuoteEditable('DRAFT')).toBe(true))
  it.each(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as QuoteStatus[])('%s is NOT editable', (status) => {
    expect(isQuoteEditable(status)).toBe(false)
  })
})

const LEGAL: [QuoteStatus, QuoteStatus][] = [
  ['DRAFT', 'SENT'],
  ['SENT', 'ACCEPTED'],
  ['SENT', 'REJECTED'],
  ['SENT', 'EXPIRED'],
]

// Every OTHER (from, to) pair among the five statuses is illegal,
// including same-status "transitions" and any move out of a terminal
// state.
const ALL_PAIRS: [QuoteStatus, QuoteStatus][] = QUOTE_STATUSES.flatMap(from =>
  QUOTE_STATUSES.map(to => [from, to] as [QuoteStatus, QuoteStatus]),
)
const ILLEGAL = ALL_PAIRS.filter(([from, to]) => !LEGAL.some(([lf, lt]) => lf === from && lt === to))

describe('Phase C3 — assertQuoteTransition(): every legal transition succeeds', () => {
  it.each(LEGAL)('%s -> %s is legal', (from, to) => {
    expect(isValidQuoteTransition(from, to)).toBe(true)
    expect(() => assertQuoteTransition(from, to)).not.toThrow()
  })
})

describe('Phase C3 — assertQuoteTransition(): every other pair is rejected, including same-status and terminal-state moves', () => {
  it.each(ILLEGAL)('%s -> %s is illegal', (from, to) => {
    expect(isValidQuoteTransition(from, to)).toBe(false)
    expect(() => assertQuoteTransition(from, to)).toThrow(`Cannot transition quote from ${from} to ${to}`)
  })

  it('a terminal status (ACCEPTED/REJECTED/EXPIRED) has zero legal outgoing transitions', () => {
    for (const terminal of ['ACCEPTED', 'REJECTED', 'EXPIRED'] as QuoteStatus[]) {
      for (const to of QUOTE_STATUSES) {
        expect(isValidQuoteTransition(terminal, to), `${terminal} -> ${to}`).toBe(false)
      }
    }
  })
})

describe('Phase C3 — assertQuoteEditable()', () => {
  it('does not throw for DRAFT', () => expect(() => assertQuoteEditable('DRAFT')).not.toThrow())
  it.each(['SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as QuoteStatus[])('throws for %s', (status) => {
    expect(() => assertQuoteEditable(status)).toThrow(`Quote is ${status} and can no longer be edited`)
  })
})
