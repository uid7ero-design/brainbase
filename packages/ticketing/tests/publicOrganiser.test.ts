import { describe, it, expect } from 'vitest'
import { publicOrganiserName, organiserReference, NEUTRAL_ORGANISER_REFERENCE } from '../src/publicOrganiser'

describe('publicOrganiserName', () => {
  it('returns the configured display name, trimmed', () => {
    expect(publicOrganiserName('Riverlights Collective')).toBe('Riverlights Collective')
    expect(publicOrganiserName('  Riverlights Collective  ')).toBe('Riverlights Collective')
  })

  it('no usable value -> null (never a fallback name)', () => {
    for (const v of [null, undefined, '', '   ', '\n\t', 42, {}, []]) expect(publicOrganiserName(v)).toBeNull()
  })
})

describe('organiserReference', () => {
  it('configured name is used exactly, never re-cased', () => {
    expect(organiserReference('eBay Events')).toBe('eBay Events')
    expect(organiserReference('eBay Events', { sentenceStart: true })).toBe('eBay Events')
  })

  it('neutral wording when nothing is configured; capitalised only at a sentence start', () => {
    expect(NEUTRAL_ORGANISER_REFERENCE).toBe('the event organiser')
    expect(organiserReference(null)).toBe('the event organiser')
    expect(organiserReference('   ')).toBe('the event organiser')
    expect(organiserReference(undefined, { sentenceStart: true })).toBe('The event organiser')
  })
})
