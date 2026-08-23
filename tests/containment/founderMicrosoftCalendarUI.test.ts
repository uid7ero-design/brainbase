import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { formatEventTime } from '@/lib/founder/formatEventTime'

// Founder OS Phase E.5C — "Today's calendar", a read-only Founder OS
// consumer of the already-Production GET /api/integrations/microsoft/
// events (Phase E.5B). No API/server-side route change was made in this
// phase — this suite covers the new UI component (source-level, since
// no test in this repo renders app/admin/founder/page.tsx via React —
// every existing Founder page test is a static source-text check, and
// this suite follows that same established convention) plus a genuine,
// functional unit test of the one piece of real logic extracted into
// its own file specifically so it CAN be executed and proven correct:
// formatEventTime(). The component itself, its hooks, its fetch call,
// and its JSX all remain in app/admin/founder/page.tsx as instructed.

const FOUNDER_PAGE_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const FORMAT_TIME_SOURCE = fs.readFileSync(path.resolve(__dirname, '../../lib/founder/formatEventTime.ts'), 'utf-8')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function sliceFunction(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker)
  expect(start, `expected to find "${startMarker}" in source`).toBeGreaterThan(-1)
  const end = source.indexOf(endMarker, start + startMarker.length)
  expect(end, `expected to find "${endMarker}" after "${startMarker}"`).toBeGreaterThan(-1)
  return source.slice(start, end)
}

const CARD_BODY = sliceFunction(
  FOUNDER_PAGE_SOURCE,
  'function MicrosoftTodayCard()',
  '// ─── Context (demos + signals)',
)
const CARD_EXECUTABLE = stripComments(CARD_BODY)

// ── 1. Endpoint fetch ──────────────────────────────────────────────────

describe('MicrosoftTodayCard — endpoint (Phase E.5C)', () => {
  it('fetches GET /api/integrations/microsoft/events and nothing else', () => {
    expect(CARD_EXECUTABLE).toContain("fetch('/api/integrations/microsoft/events')")
    const fetchCalls = [...CARD_EXECUTABLE.matchAll(/fetch\(/g)]
    expect(fetchCalls).toHaveLength(1)
  })

  it('component is defined entirely inside app/admin/founder/page.tsx (only the pure time-formatting helper was extracted)', () => {
    expect(FOUNDER_PAGE_SOURCE).toContain("import { formatEventTime } from '@/lib/founder/formatEventTime';")
    expect(FOUNDER_PAGE_SOURCE).toContain('function MicrosoftTodayCard()')
  })
})

// ── 2. Loading / 401 / failure / zero-event states ───────────────────────

describe('MicrosoftTodayCard — required UI states (tests 2-4 of the approved plan)', () => {
  it('loading state renders "Loading…"', () => {
    const start = CARD_BODY.indexOf('if (loading)')
    const end = CARD_BODY.indexOf('\n  }', start)
    const body = CARD_BODY.slice(start, end)
    expect(body).toContain('Loading…')
  })

  it('load failure / not-connected state renders "Not connected", collapsing both cases identically', () => {
    const start = CARD_BODY.indexOf('if (loadError || !data)')
    const end = CARD_BODY.indexOf('\n  }', start)
    const body = CARD_BODY.slice(start, end)
    expect(body).toContain('Not connected')
  })

  it('zero-event state renders a DISTINCT "No events today" message, not reused "Not connected" text', () => {
    const start = CARD_BODY.indexOf('data.events.length === 0')
    const end = CARD_BODY.indexOf('\n  }', start)
    const body = CARD_BODY.slice(start, end)
    expect(body).toContain('No events today')
    expect(body).not.toContain('Not connected')
  })

  it('the label is exactly "Today\'s calendar" in every state, and never repurposes/renames "Upcoming demos"', () => {
    const labelMatches = [...CARD_BODY.matchAll(/<Lbl s="([^"]+)"/g)].map(m => m[1])
    expect(labelMatches.length).toBeGreaterThan(0)
    for (const label of labelMatches) expect(label).toBe("Today's calendar")
    expect(CARD_BODY).not.toContain('Upcoming demos')
  })
})

// ── 3. Event rendering: time, title, location ─────────────────────────────

describe('MicrosoftTodayCard — event rendering', () => {
  it('renders title, a formatted time (or "All day"), and conditionally renders location only when present', () => {
    const start = CARD_BODY.indexOf('data.events.map')
    expect(start).toBeGreaterThan(-1)
    const body = CARD_BODY.slice(start)
    expect(body).toContain('event.title')
    expect(body).toContain("event.allDay ? 'All day'")
    expect(body).toContain('formatEventTime(event.start)')
    expect(body).toContain('formatEventTime(event.end)')
    expect(body).toMatch(/\{event\.location\s*&&/)
  })

  it('the raw Graph event id is used only as the React list key, never rendered as visible text', () => {
    const start = CARD_BODY.indexOf('data.events.map')
    const body = CARD_BODY.slice(start)
    // Exactly one reference to event.id, and it must be the key= attribute.
    const idRefs = [...body.matchAll(/event\.id/g)]
    expect(idRefs).toHaveLength(1)
    expect(body).toContain('key={event.id}')
    // No JSX text node anywhere renders {event.id} on its own.
    expect(body).not.toMatch(/>\{event\.id\}</)
  })
})

// ── 4. Timestamp normalization — functional, using the real Production shape ──

describe('formatEventTime — functional correctness against the real Production timestamp shape', () => {
  it('a Z-less Graph timestamp (exact Production shape) is treated as UTC, not local time', () => {
    // Real shape confirmed from Production: Prefer: outlook.timezone="UTC"
    // returns e.g. "2026-08-23T09:30:00.0000000" — no Z, no offset — even
    // though the value IS UTC. 09:30 UTC on 23 Aug 2026 is 19:00 in
    // Australia/Adelaide (UTC+9:30, ACST — August is outside the Oct-Apr
    // ACDT window), and this is the exact scenario the real Production
    // "Test" event exercised.
    const result = formatEventTime('2026-08-23T09:30:00.0000000')
    // Format the same instant independently (via the correct, Z-suffixed
    // parse) and compare, rather than asserting a hardcoded locale string
    // that could vary by test-runner locale/ICU data.
    const expected = new Date('2026-08-23T09:30:00.0000000Z').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    expect(result).toBe(expected)
  })

  it('a naive (incorrect) parse of the same Z-less string would NOT equal the corrected result — proving the Z-append is load-bearing, not a no-op', () => {
    const corrected = formatEventTime('2026-08-23T09:30:00.0000000')
    const naive = new Date('2026-08-23T09:30:00.0000000').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    // These differ whenever the test runner's local timezone has a
    // non-zero UTC offset (true for this repo's own environment); if the
    // runner ever executes in true UTC this assertion would be vacuous,
    // so it's a supplementary check, not the primary proof (test 1 above
    // is the primary proof, and holds regardless of runner timezone).
    if (new Date().getTimezoneOffset() !== 0) {
      expect(corrected).not.toBe(naive)
    }
  })

  it('a timestamp that already carries a Z suffix is not double-corrected', () => {
    const withZ = formatEventTime('2026-08-23T09:30:00.000Z')
    const expected = new Date('2026-08-23T09:30:00.000Z').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    expect(withZ).toBe(expected)
  })

  it('a timestamp with an explicit numeric offset is not double-corrected', () => {
    const withOffset = formatEventTime('2026-08-23T19:00:00+09:30')
    const expected = new Date('2026-08-23T19:00:00+09:30').toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    expect(withOffset).toBe(expected)
  })

  it('null/undefined/empty input returns an empty string rather than throwing or rendering "Invalid Date"', () => {
    expect(formatEventTime(null)).toBe('')
    expect(formatEventTime(undefined)).toBe('')
    expect(formatEventTime('')).toBe('')
  })

  it('an unparseable string returns an empty string rather than "Invalid Date"', () => {
    expect(formatEventTime('not-a-real-timestamp')).toBe('')
  })

  it('formatEventTime is a small, pure, framework-free function — no React, no fetch, no side effects', () => {
    const executable = stripComments(FORMAT_TIME_SOURCE)
    expect(executable).not.toContain('fetch(')
    expect(executable).not.toContain("from 'react'")
    expect(executable).not.toContain('useState')
    expect(executable).not.toContain('useEffect')
  })
})

// ── 5. No scope creep ──────────────────────────────────────────────────────

describe('No Mail/Bookings/Contacts/Files/Teams scope creep, no calendar write, no API/scope change (tests per approved plan)', () => {
  it('the new component and helper reference no Microsoft Graph endpoint beyond the existing events route', () => {
    expect(CARD_EXECUTABLE).not.toMatch(/graph\.microsoft\.com|\/me\/messages|\/me\/events\b|bookingBusinesses|\/me\/contacts|\/me\/drive|OneDrive|\/teams\b/i)
    expect(FORMAT_TIME_SOURCE).not.toMatch(/graph\.microsoft\.com/i)
  })

  it('no write/create/update/delete verb or fetch method is used anywhere in the new component', () => {
    expect(CARD_EXECUTABLE).not.toMatch(/method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
  })

  it('the API route itself (Phase E.5B, already Production) was not modified by this phase', () => {
    // This suite only asserts the CURRENT committed route shape — the
    // absence of a diff is proven by the git-level review in the
    // pre-push report, not by this test file.
    const routeSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/integrations/microsoft/events/route.ts'), 'utf-8')
    expect(routeSource).toContain("await fetch(`${GRAPH_BASE}/me/calendarView?${params}`")
  })
})

// ── 6. Upcoming demos unchanged ─────────────────────────────────────────────

describe('"Upcoming demos" (LiveContext) is unchanged by this phase', () => {
  it('LiveContext() still exists, still labelled "Upcoming demos", still a static Not-connected placeholder with no fetch', () => {
    const start = FOUNDER_PAGE_SOURCE.indexOf('function LiveContext()')
    const end = FOUNDER_PAGE_SOURCE.indexOf('// ─── Client drawer', start)
    const body = FOUNDER_PAGE_SOURCE.slice(start, end)
    expect(body).toContain('Upcoming demos')
    expect(body).toContain('Not connected')
    expect(body).not.toContain('fetch(')
  })

  it('MicrosoftTodayCard is defined before LiveContext in source order, keeping the existing LiveContext test-slice boundary clean', () => {
    expect(FOUNDER_PAGE_SOURCE.indexOf('function MicrosoftTodayCard()'))
      .toBeLessThan(FOUNDER_PAGE_SOURCE.indexOf('function LiveContext()'))
  })
})
