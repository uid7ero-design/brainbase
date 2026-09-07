import { describe, it, expect, afterEach } from 'vitest'
import { formatCommercialDate, formatCommercialDateOrNull } from '@/lib/commercial/dates'

// Phase C3-POLISH-R §3 — Australian date formatting for Commercial.
// formatCommercialDate() is built on lib/date.ts's existing
// parseLocalDate(), which parses a bare 'YYYY-MM-DD' string by field
// extraction (never via Date.parse()/`new Date(isoString)`, which treats
// a bare date as UTC midnight) — that is what makes this correct
// regardless of which timezone Node itself is configured to. This suite
// runs the same assertions under two different process timezones to
// prove that: the default (whatever CI/dev machine timezone happens to
// be) and an explicit Australia/Adelaide, per the brief's own "test
// Australia/Adelaide specifically" instruction.

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  process.env.TZ = ORIGINAL_TZ
})

describe('Phase C3-POLISH-R — formatCommercialDate()', () => {
  it('formats a DATE-column string as "7 Sep 2026" — day numeric, month short, year numeric', () => {
    expect(formatCommercialDate('2026-09-07')).toBe('7 Sep 2026')
  })

  it('never emits a raw ISO timestamp string', () => {
    const out = formatCommercialDate('2026-09-07T00:00:00.000Z')
    expect(out).not.toContain('T00:00:00')
    expect(out).not.toContain('Z')
  })

  it('returns "—" for null/undefined/empty input, never throws', () => {
    expect(formatCommercialDate(null)).toBe('—')
    expect(formatCommercialDate(undefined)).toBe('—')
    expect(formatCommercialDate('')).toBe('—')
  })

  it('does not shift by one day under Australia/Adelaide (UTC+9:30/+10:30, ahead of UTC)', () => {
    process.env.TZ = 'Australia/Adelaide'
    expect(formatCommercialDate('2026-09-07')).toBe('7 Sep 2026')
    expect(formatCommercialDate('2026-01-01')).toBe('1 Jan 2026') // also covers the DST-adjacent Adelaide summer offset
  })

  it('does not shift by one day under a timezone behind UTC (the classic bare-date bug this must not reintroduce)', () => {
    process.env.TZ = 'America/Los_Angeles'
    expect(formatCommercialDate('2026-09-07')).toBe('7 Sep 2026')
  })

  it('is stable across a month/year boundary regardless of process timezone', () => {
    for (const tz of ['UTC', 'Australia/Adelaide', 'America/Los_Angeles']) {
      process.env.TZ = tz
      expect(formatCommercialDate('2026-12-31')).toBe('31 Dec 2026')
      expect(formatCommercialDate('2027-01-01')).toBe('1 Jan 2027')
    }
  })
})

describe('Phase C3-POLISH-R — formatCommercialDateOrNull()', () => {
  it('returns null (not "—") for empty input, for callers that omit the whole row', () => {
    expect(formatCommercialDateOrNull(null)).toBeNull()
    expect(formatCommercialDateOrNull(undefined)).toBeNull()
  })

  it('formats the same as formatCommercialDate for real input', () => {
    expect(formatCommercialDateOrNull('2026-09-07')).toBe('7 Sep 2026')
  })
})
