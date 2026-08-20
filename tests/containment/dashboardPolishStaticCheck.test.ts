import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts file in this suite).

const dashSource     = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TennisDashboard.tsx'), 'utf-8')
const scheduleSource = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TodaysSchedule.tsx'), 'utf-8')
const chartSource    = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/LeadsChart.tsx'), 'utf-8')
const newsSource     = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/TennisNewsPanel.tsx'), 'utf-8')
const insightSource  = fs.readFileSync(path.resolve(__dirname, '../../components/dashboard/HlnaInsightCard.tsx'), 'utf-8')
const pageSource     = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/page.tsx'), 'utf-8')
const resolverSource = fs.readFileSync(path.resolve(__dirname, '../../lib/dashboard/clientDashboard.ts'), 'utf-8')

describe("Part A — Today's Schedule empty state is compact", () => {
  it('1. the empty-state block uses reduced padding, not the full 32px empty-panel treatment", so it does not read as an oversized blank area', () => {
    const emptyBlock = scheduleSource.slice(
      scheduleSource.indexOf('instances.length === 0'),
      scheduleSource.indexOf('No sessions scheduled today') + 40,
    )
    expect(emptyBlock).toContain("padding: '18px 22px'")
    expect(emptyBlock).not.toContain("padding: '32px 22px'")
  })

  it('does not invent a "next session" line — no new query was added for it', () => {
    // Matches the brief's own example label format ("Next session: ...")
    // specifically, not this file's explanatory comment about why it was
    // deliberately left out (which itself mentions the phrase).
    expect(scheduleSource).not.toMatch(/Next session:/i)
    expect(pageSource).not.toMatch(/next session/i)
  })

  it('the panel header and "View Sessions" link are preserved', () => {
    expect(scheduleSource).toContain("Today&apos;s Schedule")
    expect(scheduleSource).toContain('View Sessions')
    expect(scheduleSource).toContain('href="/dashboard/sessions"')
  })
})

describe('Part B — Lead Trend empty state', () => {
  it('2. renders a compact, intentional empty state when total leads for the period is zero, instead of an empty chart canvas', () => {
    expect(chartSource).toContain('total === 0')
    expect(chartSource).toContain('No new leads this week')
    expect(chartSource).toContain('New enquiries will appear here')
  })

  it('3. still renders the normal chart (ResponsiveContainer/BarChart) when data exists — the empty state only replaces the canvas, not the whole component', () => {
    expect(chartSource).toContain('<ResponsiveContainer')
    expect(chartSource).toContain('<BarChart')
    // Both branches exist off the same total === 0 condition.
    expect(chartSource).toMatch(/total === 0 \? \(/)
  })

  it('chart calculations and date range are unchanged — buildChartData still walks the same 7-day window', () => {
    expect(chartSource).toContain('for (let i = 6; i >= 0; i--)')
  })
})

describe('Part C — "Active Clients" renamed to "Open Leads", calculation untouched', () => {
  it('4. "Active Clients" is no longer rendered as a KPI label', () => {
    expect(dashSource).not.toContain('label="Active Clients"')
  })

  it('5. the replacement label "Open Leads" is rendered in its place, same subtitle', () => {
    expect(dashSource).toContain('label="Open Leads"')
    expect(dashSource).toContain('sub="New or contacted"')
  })

  it('6. the underlying calculation is unchanged — same stats field, same SQL status filter', () => {
    // Same page.tsx -> TennisDashboard wiring as before the rename.
    expect(dashSource).toContain('value={stats.activeLeads}')
    expect(pageSource).toContain("COUNT(*) FILTER (WHERE status IN ('new', 'contacted'))::int          AS active_leads")
    expect(pageSource).toContain('activeLeads:    s.active_leads   ?? 0,')
  })
})

describe('Part D — Tennis News capped to 4 visible items', () => {
  it('7. defaults to showing at most 4 items, via a display-only slice — the feed fetch itself is untouched', () => {
    expect(newsSource).toContain('const VISIBLE_ITEM_COUNT = 4')
    expect(newsSource).toContain('.slice(0, VISIBLE_ITEM_COUNT)')
    // fetchTennisNews's own internal cap (how many it pulls from the feed)
    // is a separate, pre-existing number — unchanged by this round.
    expect(newsSource).toContain('itemBlocks.slice(0, 6)')
  })

  it('8. source attribution is preserved', () => {
    expect(newsSource).toContain('via BBC Sport')
  })

  it('no expand/collapse state was added — this component has no "use client" directive and none was introduced', () => {
    expect(newsSource).not.toContain("'use client'")
    expect(newsSource).not.toContain('useState')
  })
})

describe('Part E — HLNA Insight prominence + honest empty-state copy', () => {
  it('9. HLNA Insight still renders above Tennis News in the page (matches the requested hierarchy, unchanged from the previous round)', () => {
    const insightIdx = dashSource.indexOf('<HlnaInsightCard')
    const newsIdx     = dashSource.indexOf('<TennisNewsPanel')
    expect(insightIdx).toBeGreaterThan(-1)
    expect(newsIdx).toBeGreaterThan(-1)
    expect(insightIdx).toBeLessThan(newsIdx)
  })

  it('10. the zero-data empty state uses specific, honest copy instead of the old weak message — never pretending insight exists', () => {
    expect(insightSource).toContain('No insight available yet')
    expect(insightSource).toContain('HLNA will surface priorities here as lead and contact activity builds.')
    expect(insightSource).not.toContain('No data yet. Add contacts and leads to unlock AI insights.')
  })

  it('the empty state is padded like a real panel, not a bare one-line paragraph, so it does not collapse into a thin strip', () => {
    const emptyBlockStart = insightSource.indexOf('!briefing?.hasData')
    const emptyBlockEnd   = insightSource.indexOf(') : (', emptyBlockStart)
    const block = insightSource.slice(emptyBlockStart, emptyBlockEnd)
    expect(block).toMatch(/padding: '10px 0 24px'/)
  })

  it('header emphasis was strengthened (larger/bolder label) without changing the panel structure', () => {
    expect(insightSource).toContain("fontWeight: 700, letterSpacing: '.06em'")
  })

  it('the AI backend itself was not touched this round', () => {
    expect(insightSource).toContain("fetch('/api/hlna/briefing', { method: 'POST' })")
  })
})

describe('Part F — Recent Activity untouched', () => {
  it('11. Recent Activity panel remains present with its existing title and data wiring', () => {
    expect(dashSource).toContain('title="Recent Activity"')
    expect(dashSource).toContain('recentLeads.map(')
  })
})

describe('Part H item 12 — dashboard resolution / tenant scoping unchanged by this polish round', () => {
  it('the slug-based resolver is untouched — same map, same lookup', () => {
    expect(resolverSource).toContain("'ld-tennis': 'ld-tennis'")
    expect(resolverSource).toContain('WHERE id = ${organisationId}')
  })

  it('app/dashboard/page.tsx still resolves via resolveDashboardVariant and stays organisation-scoped', () => {
    expect(pageSource).toContain('resolveDashboardVariant(session.organisationId, session.role)')
    expect(pageSource).toContain('s.organisation_id = ${oid}')
    expect(pageSource).not.toContain('LD_TENNIS_ORG_ID')
  })
})
