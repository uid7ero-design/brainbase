import { describe, it, expect } from 'vitest'
import { publicOrganiserName, organiserReference, NEUTRAL_ORGANISER_REFERENCE, publicOrganiserContact, publicOrganiserEmail, publicOrganiserWebsite, displayWebsite } from '../src/publicOrganiser'

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

describe('publicOrganiserContact (organiser contact v1)', () => {
  it('nothing configured -> null (no contact block)', () => {
    for (const input of [null, undefined, {}, { publicEmail: null, website: null }, { publicEmail: '', website: '' }, { publicEmail: '   ', website: ' \t ' }]) {
      expect(publicOrganiserContact(input as never)).toBeNull()
    }
  })

  it('public email only / website only / both', () => {
    expect(publicOrganiserContact({ publicEmail: 'tickets@acme.example' })).toEqual({ email: 'tickets@acme.example', website: null })
    expect(publicOrganiserContact({ website: 'https://acme.example' })).toEqual({ email: null, website: 'https://acme.example' })
    expect(publicOrganiserContact({ publicEmail: 'tickets@acme.example', website: 'http://acme.example/events' }))
      .toEqual({ email: 'tickets@acme.example', website: 'http://acme.example/events' })
  })

  it('trims, and lower-cases the email', () => {
    expect(publicOrganiserContact({ publicEmail: '  Tickets@ACME.example ', website: '  https://acme.example  ' }))
      .toEqual({ email: 'tickets@acme.example', website: 'https://acme.example' })
  })

  it('an invalid email is dropped (never shown), the website survives', () => {
    for (const bad of ['not-an-email', 'a@b', 'two words@x.example', '<x@y.example>', 'x"y@z.example', 'a'.repeat(250) + '@x.example', 42, {}]) {
      expect(publicOrganiserEmail(bad), String(bad)).toBeNull()
      expect(publicOrganiserContact({ publicEmail: bad, website: 'https://acme.example' })).toEqual({ email: null, website: 'https://acme.example' })
    }
  })

  it('only http(s) websites with a host; every other scheme is excluded', () => {
    for (const bad of ['javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:text/html,x', 'ftp://acme.example', 'mailto:x@y.example', '//acme.example', 'acme.example', 'https://', 'http:///nohost', 'https://' + 'a'.repeat(2050)]) {
      expect(publicOrganiserWebsite(bad), bad).toBeNull()
      expect(publicOrganiserContact({ website: bad }), bad).toBeNull()
    }
  })

  it('takes only the two named fields: private-looking keys on the input are ignored', () => {
    const c = publicOrganiserContact({ publicEmail: 'tickets@acme.example', website: null, email: 'private@acme.example', phone: '0400', name: 'Internal' } as never)
    expect(c).toEqual({ email: 'tickets@acme.example', website: null })
    expect(Object.keys(c!).sort()).toEqual(['email', 'website'])
  })

  it('displayWebsite drops the scheme and a trailing slash', () => {
    expect(displayWebsite('https://acme.example/')).toBe('acme.example')
    expect(displayWebsite('http://acme.example/events')).toBe('acme.example/events')
  })
})
