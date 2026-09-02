import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisSessionManagementUiStaticCheck.test.ts for the same caveat spelled
// out in full.
//
// Events UX polish, Part B — every existing event already has a public
// URL at /e/[organisationSlug]/[eventSlug] (app/e/**), but nothing in the
// staff-facing Events UI linked to it. This suite proves: the list and
// detail screens now expose "View public page" / "Copy public link", the
// URL is built from the event's OWN organisation+event slug (never a
// hardcoded org name), no new public route was created, the existing
// public route itself is untouched, and the link is never gated on
// event.status (draft/publish semantics are the public route's own
// concern, not this UI's).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8')

const eventsPage = read('app/events/page.tsx')
const eventDetailPage = read('app/events/[id]/page.tsx')
const listClient = read('app/events/EventsListClient.tsx')
const detailClient = read('app/events/[id]/EventDetailClient.tsx')

describe('Public event link — no new route, no changes to the existing public route', () => {
  it('the existing public route files are untouched by this pass (no new public/preview route was invented)', () => {
    expect(fs.existsSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]/page.tsx'))).toBe(true)
    // No sibling "preview" or "bypass" route was added next to it.
    const siblingEntries = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]'))
    expect(siblingEntries).not.toContain('preview')
    expect(siblingEntries).not.toContain('bypass')
  })

  it('neither the list nor detail client defines a second/alternate public route path', () => {
    expect(listClient).not.toMatch(/\/e-preview|\/public-preview|\/events-public/)
    expect(detailClient).not.toMatch(/\/e-preview|\/public-preview|\/events-public/)
  })
})

describe('Public event link — organisation slug is fetched, never hardcoded', () => {
  it('app/events/page.tsx fetches the organisation slug via a small additive read-only query, scoped to the caller\'s own session organisation', () => {
    expect(eventsPage).toMatch(/SELECT slug FROM organisations WHERE id = \$\{session\.organisationId\}/)
    expect(eventsPage).toContain('organisationSlug')
  })

  it('app/events/[id]/page.tsx does the same', () => {
    expect(eventDetailPage).toMatch(/SELECT slug FROM organisations WHERE id = \$\{session\.organisationId\}/)
    expect(eventDetailPage).toContain('organisationSlug')
  })

  it('neither existing Events API route (GET /api/events, GET /api/events/[id]) was modified to add this — it stays a page-level concern', () => {
    const eventsApi = read('app/api/events/route.ts')
    const eventApi = read('app/api/events/[id]/route.ts')
    expect(eventsApi).not.toContain('organisations')
    expect(eventApi).not.toMatch(/organisations\b/)
  })

  it('no known organisation name is hardcoded anywhere in the touched files (School Test Organisation / LD Tennis / Brainbase)', () => {
    for (const src of [eventsPage, eventDetailPage, listClient, detailClient]) {
      expect(src).not.toMatch(/School Test Organisation/i)
      expect(src).not.toMatch(/LD Tennis/i)
      expect(src).not.toMatch(/thebrainbase\.com\.au/i)
    }
  })
})

describe('Public event link — event list exposes "View public page"', () => {
  it('EventsListClient accepts organisationSlug and renders a public-page link per event row using the event\'s own slug', () => {
    expect(listClient).toContain('organisationSlug')
    expect(listClient).toMatch(/href=\{`\/e\/\$\{organisationSlug\}\/\$\{ev\.slug\}`\}/)
    expect(listClient).toContain('View public page')
  })

  it('the link opens in a new tab and is hidden (not disabled) when organisationSlug is unavailable, so /e/null/... can never be constructed', () => {
    expect(listClient).toMatch(/target="_blank"/)
    expect(listClient).toMatch(/organisationSlug && \(/)
  })

  it('the link is never gated on event status (draft/publish semantics stay the public route\'s own concern)', () => {
    // Anchored on the actual href expression, not the label text, since
    // that same phrase also appears earlier in an explanatory comment.
    const anchorStart = listClient.indexOf('href={`/e/${organisationSlug}/${ev.slug}`}')
    expect(anchorStart).toBeGreaterThan(-1)
    const anchorBlock = listClient.slice(Math.max(0, anchorStart - 400), anchorStart)
    expect(anchorBlock).not.toMatch(/ev\.status ===/)
  })
})

describe('Public event link — event detail exposes "View public page" and "Copy public link"', () => {
  it('EventDetailClient / EventOverview accepts organisationSlug and threads it through', () => {
    expect(detailClient).toContain('organisationSlug')
    expect(detailClient).toMatch(/<EventOverview[\s\S]{0,200}organisationSlug=\{organisationSlug\}/)
  })

  it('the absolute public URL is built from window.location.origin (the same established pattern as ticket links), not a hardcoded domain or a server env var', () => {
    expect(detailClient).toContain('function publicEventUrl(): string')
    expect(detailClient).toMatch(/\$\{window\.location\.origin\}\/e\/\$\{organisationSlug\}\/\$\{event\.slug\}/)
    expect(detailClient).not.toContain('NEXT_PUBLIC_APP_URL')
  })

  it('exposes both a "View public page" link and a "Copy public link" action', () => {
    expect(detailClient).toContain('View public page')
    expect(detailClient).toContain('Copy public link')
    expect(detailClient).toContain('async function copyPublicLink()')
    expect(detailClient).toContain('navigator.clipboard.writeText(publicEventUrl())')
  })

  it('View public page opens in a new tab, preserving the organiser\'s own tab/session', () => {
    // Anchored on the actual <a> element's own href expression, not the
    // literal label text, since that same phrase also appears earlier in
    // an explanatory comment.
    const idx = detailClient.indexOf('href={publicEventUrl()}')
    expect(idx).toBeGreaterThan(-1)
    const nearby = detailClient.slice(idx, idx + 300)
    expect(nearby).toContain('target="_blank"')
    expect(nearby).toContain('rel="noopener noreferrer"')
    expect(nearby).toContain('View public page')
  })

  it('neither action is gated on event.status', () => {
    const actionsBlockStart = detailClient.indexOf('href={publicEventUrl()}')
    const actionsBlockEnd = detailClient.indexOf('Copy public link') + 40
    const block = detailClient.slice(Math.max(0, actionsBlockStart - 200), actionsBlockEnd)
    expect(block).not.toMatch(/event\.status ===/)
  })
})

describe('Public event link — action hierarchy (Part C)', () => {
  it('View public page / Copy public link use the shared secondaryBtnStyle, not primaryBtnStyle, in both the list and detail screens', () => {
    const listAnchorIdx = listClient.indexOf('href={`/e/${organisationSlug}/${ev.slug}`}')
    expect(listAnchorIdx).toBeGreaterThan(-1)
    const listNearby = listClient.slice(listAnchorIdx, listAnchorIdx + 300)
    expect(listNearby).toContain('secondaryBtnStyle')
    expect(listNearby).not.toContain('primaryBtnStyle')

    const detailStart = detailClient.indexOf('href={publicEventUrl()}')
    const detailEnd = detailClient.indexOf('Copy public link') + 60
    const detailBlock = detailClient.slice(Math.max(0, detailStart - 100), detailEnd)
    expect(detailBlock).toContain('secondaryBtnStyle')
    expect(detailBlock).not.toContain('primaryBtnStyle')
  })
})
