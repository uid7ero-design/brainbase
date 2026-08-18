// Pure, framework-free greeting resolution for the Client Day Overview
// header — split out from app/dashboard/page.tsx specifically so the
// time-of-day bucketing and name handling get real unit-test coverage
// rather than only static source-text checks.

// Same three-way bucket as app/api/hlna/briefing/route.ts's greeting field
// (hour < 12 / < 17 / else), kept consistent with that existing convention
// — just computed from an explicit Australia/Adelaide hour rather than the
// server process's own (frequently UTC, on Vercel) local time.
export function greetingForHour(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

// The authenticated user's own first name only — never derived from any
// client-provided input. Returns null (not a made-up name) when the stored
// name is blank, so callers can fall back to a neutral greeting.
export function firstNameOf(name: string | null | undefined): string | null {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return null
  return trimmed.split(/\s+/)[0]
}

// Wraps the two above into the exact header string: "Good evening, Luke"
// when a first name is available, or a neutral "Good evening" when it
// isn't — never "Good evening, undefined" or similar.
export function greetingLine(hour: number, name: string | null | undefined): string {
  const greeting = greetingForHour(hour)
  const first = firstNameOf(name)
  return first ? `${greeting}, ${first}` : greeting
}

// Current hour in Australia/Adelaide, independent of the server process's
// own timezone (Vercel functions typically run in UTC, which would
// otherwise misfire the morning/afternoon/evening bucket by up to 10.5
// hours). Matches the Australia/Adelaide convention already used
// throughout the sessions/leads features in this codebase.
export function currentAdelaideHour(now: Date = new Date()): number {
  // hourCycle: 'h23' (not hour12: false) — some Intl implementations return
  // "24" for midnight under hour12: false, which would wrongly fail the
  // `hour < 12` check below and misfire "Good afternoon" at midnight.
  const hourStr = now.toLocaleString('en-AU', { timeZone: 'Australia/Adelaide', hour: 'numeric', hourCycle: 'h23' })
  return Number(hourStr) % 24
}
