import { describe, it, expect } from 'vitest'
import { formatEventSchedule } from '../src/eventSchedule'

// Every case names an explicit zone, so the result is the same on a UTC CI
// runner and an Adelaide laptop.

const ADL = 'Australia/Adelaide'

describe('formatEventSchedule', () => {
  it('Riverlights: Saturday 20 March 2027, 12:00 pm – 11:00 pm ACDT (Adelaide summer, DST)', () => {
    // 20 Mar 2027 12:00 ACDT = 01:30Z; 23:00 ACDT = 12:30Z.
    expect(formatEventSchedule('2027-03-20T01:30:00.000Z', '2027-03-20T12:30:00.000Z', ADL)).toEqual({
      kind: 'single', date: 'Saturday, 20 March 2027', time: '12:00 pm – 11:00 pm ACDT',
    })
  })

  it('Adelaide winter (no DST) shows ACST', () => {
    // 10 Jul 2027 19:00 ACST = 09:30Z; 21:30 ACST = 12:00Z.
    expect(formatEventSchedule('2027-07-10T09:30:00Z', '2027-07-10T12:00:00Z', ADL)).toEqual({
      kind: 'single', date: 'Saturday, 10 July 2027', time: '7:00 pm – 9:30 pm ACST',
    })
  })

  it('accepts Date values as the database driver returns them', () => {
    expect(formatEventSchedule(new Date('2027-03-20T01:30:00Z'), new Date('2027-03-20T12:30:00Z'), ADL)).toEqual({
      kind: 'single', date: 'Saturday, 20 March 2027', time: '12:00 pm – 11:00 pm ACDT',
    })
  })

  it('uses the event zone, never UTC: 10:30 pm UTC on Friday is Saturday morning in Adelaide', () => {
    // 2027-03-19T22:30Z = Sat 20 Mar 09:00 ACDT.
    const s = formatEventSchedule('2027-03-19T22:30:00Z', '2027-03-20T01:30:00Z', ADL)
    expect(s).toEqual({ kind: 'single', date: 'Saturday, 20 March 2027', time: '9:00 am – 12:00 pm ACDT' })
  })

  it('overnight: both local dates are shown in full so the date change is clear', () => {
    // Sat 20 Mar 22:00 ACDT = 11:30Z; Sun 21 Mar 02:00 ACDT = 15:30Z.
    expect(formatEventSchedule('2027-03-20T11:30:00Z', '2027-03-20T15:30:00Z', ADL)).toEqual({
      kind: 'span',
      start: 'Saturday, 20 March 2027, 10:00 pm ACDT',
      end: 'Sunday, 21 March 2027, 2:00 am ACDT',
    })
  })

  it('DST ends during the event (Sun 4 Apr 2027, 3:00 am ACDT -> 2:00 am ACST): each end shows its own zone', () => {
    expect(formatEventSchedule('2027-04-03T14:00:00Z', '2027-04-03T17:30:00Z', ADL)).toEqual({
      kind: 'single', date: 'Sunday, 4 April 2027', time: '12:30 am ACDT – 3:00 am ACST',
    })
  })

  it('no end, an unparseable end, or an end not after the start: start time only', () => {
    const only = { kind: 'single', date: 'Saturday, 20 March 2027', time: '12:00 pm ACDT' }
    expect(formatEventSchedule('2027-03-20T01:30:00Z', null, ADL)).toEqual(only)
    expect(formatEventSchedule('2027-03-20T01:30:00Z', undefined, ADL)).toEqual(only)
    expect(formatEventSchedule('2027-03-20T01:30:00Z', 'not a date', ADL)).toEqual(only)
    expect(formatEventSchedule('2027-03-20T01:30:00Z', '2027-03-20T01:30:00Z', ADL)).toEqual(only)
    expect(formatEventSchedule('2027-03-20T01:30:00Z', '2027-03-19T01:30:00Z', ADL)).toEqual(only)
  })

  it('other zones render in their own offset', () => {
    // 2027-03-20T01:30Z = 12:30 pm AEDT in Sydney, 9:30 am AWST in Perth.
    expect(formatEventSchedule('2027-03-20T01:30:00Z', null, 'Australia/Sydney')).toEqual({ kind: 'single', date: 'Saturday, 20 March 2027', time: '12:30 pm AEDT' })
    expect(formatEventSchedule('2027-03-20T01:30:00Z', null, 'Australia/Perth')).toEqual({ kind: 'single', date: 'Saturday, 20 March 2027', time: '9:30 am AWST' })
  })

  it('an unusable zone is labelled UTC rather than guessed', () => {
    expect(formatEventSchedule('2027-03-20T01:30:00Z', null, 'Not/AZone')).toEqual({ kind: 'single', date: 'Saturday, 20 March 2027', time: '1:30 am UTC' })
    expect(formatEventSchedule('2027-03-20T01:30:00Z', null, null)).toEqual({ kind: 'single', date: 'Saturday, 20 March 2027', time: '1:30 am UTC' })
  })

  it('no usable start: no lines at all', () => {
    expect(formatEventSchedule(null, '2027-03-20T12:30:00Z', ADL)).toBeNull()
    expect(formatEventSchedule('garbage', '2027-03-20T12:30:00Z', ADL)).toBeNull()
  })

  it('plain spaces only (no narrow/no-break spaces from ICU)', () => {
    const s = formatEventSchedule('2027-03-20T11:30:00Z', '2027-03-20T15:30:00Z', ADL)
    expect(JSON.stringify(s)).not.toMatch(/[  ]/)
  })
})
