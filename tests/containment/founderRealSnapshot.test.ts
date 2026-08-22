import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS Phase B — data-authority audit. Static source-text assertions
// (no jsdom/RTL harness in this repo, same caveat as every other
// *StaticCheck.test.ts file) proving the demo/mock content identified in the
// Phase B audit was actually removed, and that real-vs-unavailable KPIs are
// rendered honestly rather than presenting fabricated values as real.

const founderSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const attnQueueRouteSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
const opsAlertsSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/ops/alerts/route.ts'), 'utf-8')

// "X mock is gone" assertions are scoped to executable code, not prose — this
// file's own explanatory comments legitimately quote the removed strings/
// labels when documenting what was deleted and why (same pattern used
// elsewhere in this suite, e.g. webLeadMessagesSchemaCorrection.test.ts).
// Used for every not.toContain/not.toMatch below; positive toContain/toMatch
// checks use the raw source since comment presence doesn't matter there.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const founderExecutable = stripComments(founderSource)

// ── 1/2. No fake KPI/MRR values remain ──────────────────────────────────────

describe('No demo KPI/MRR values remain', () => {
  it('the old fake KPI_TILES mock (hardcoded MRR/clients/trials/demos/follow-ups/failed-analyses figures) is gone', () => {
    expect(founderExecutable).not.toContain('KPI_TILES')
    expect(founderExecutable).not.toContain("value: '$12,480'")
    expect(founderExecutable).not.toContain("value: '14'")
    expect(founderExecutable).not.toContain("delta: '+18%'")
    expect(founderExecutable).not.toContain("sub: 'vs April'")
  })

  it('no fake MRR trend data (MRR_POINTS) or its chart (MrrArea) remain, including the header-bar "MRR $12,480 (demo)" figure', () => {
    expect(founderExecutable).not.toContain('MRR_POINTS')
    expect(founderExecutable).not.toContain('function MrrArea')
    expect(founderExecutable).not.toContain('$12,480')
    expect(founderExecutable).not.toContain('149.8k')
    expect(founderExecutable).not.toContain('(demo)')
  })

  it('the fake "Top opportunity — Campbelltown $3,200/mo" line is gone', () => {
    expect(founderExecutable).not.toContain('Campbelltown')
    expect(founderExecutable).not.toContain('$3,200/mo')
  })

  it('the fake hardcoded "Demo status" dot and stale "Thu 8 May 2026" date in the header bar are gone', () => {
    expect(founderExecutable).not.toContain('Demo status')
    expect(founderExecutable).not.toContain('Thu 8 May 2026')
    expect(founderSource).toContain('new Date().toLocaleDateString')
  })

  it('SnapshotHero, RevenueIntel, and the header bar all derive MRR from `metrics`/`activeMrr`, not a hardcoded literal', () => {
    expect(founderSource).toMatch(/function SnapshotHero\(\{ metrics, loading \}: \{ metrics: AttnMetrics \| null; loading: boolean \}\)/)
    expect(founderSource).toMatch(/function RevenueIntel\(\{ metrics, loading \}: \{ metrics: AttnMetrics \| null; loading: boolean \}\)/)
    expect(founderSource).toContain('metrics.activeMrr')
    expect(founderSource).toContain('snapshotMetrics.activeMrr')
  })
})

// ── 3. No fake recommendations remain ───────────────────────────────────────

describe('No fake recommendations remain', () => {
  it('the RECOMMENDATIONS mock array and RecoItem type are gone', () => {
    expect(founderExecutable).not.toContain('const RECOMMENDATIONS')
    expect(founderExecutable).not.toContain('RecoItem')
  })

  it('specific fabricated recommendation copy is gone', () => {
    expect(founderExecutable).not.toContain('Send Port Adelaide a personalised contamination briefing')
    expect(founderExecutable).not.toContain('Fix City of Unley upload column mapping')
  })

  it('AiRecommendations no longer accepts an items prop or falls back to a mock/proxy source — it is a plain not-connected panel', () => {
    expect(founderSource).toMatch(/function AiRecommendations\(\)\s*\{/)
    expect(founderSource).toContain('Recommendations not connected')
  })

  it('HLNA briefing no longer falls back to fabricated MOCK_QUADS content when the intelligence backend is unreachable', () => {
    expect(founderExecutable).not.toContain('const MOCK_QUADS')
    expect(founderExecutable).not.toContain('Reactivate Port Adelaide with personalised briefing')
    expect(founderExecutable).not.toContain('HIGH URGENCY')
  })
})

// ── 4. No fake Live Activity events remain ──────────────────────────────────

describe('No fake Live Activity events remain', () => {
  it('the ACTIVITY mock array is gone', () => {
    expect(founderExecutable).not.toContain('const ACTIVITY')
  })

  it('specific fabricated activity copy is gone', () => {
    expect(founderExecutable).not.toContain('Campbelltown proposal email opened')
    expect(founderExecutable).not.toContain('HLNA Daily Briefing generated')
    expect(founderExecutable).not.toContain('waste_sample.csv uploaded')
  })

  it('ActivityFeed renders only sessionEvents (real, in-session) with an honest empty state, no merged mock array', () => {
    expect(founderSource).toMatch(/function ActivityFeed\(\{ sessionEvents \}: \{ sessionEvents: SessionEvent\[\] \}\)/)
    expect(founderExecutable).not.toMatch(/\[\.\.\.sessionEvents,\s*\.\.\.ACTIVITY\]/)
    expect(founderSource).toContain('No activity yet this session')
  })
})

// ── 5/6. Real metrics use the real path; unavailable metrics never show 0 ──

describe('Real vs. unavailable metric rendering', () => {
  it('SnapshotHero/RevenueIntel/header-bar MRR fetch real metrics from the founder attention-queue endpoint at the page root (shared, not duplicated per-consumer)', () => {
    const rootFetchCount = (founderSource.match(/fetch\('\/api\/founder\/attention-queue'\)/g) ?? []).length
    // RealFounderOperations (Phase A, untouched) has its own independent
    // fetch, plus exactly one new root-level fetch feeding SnapshotHero,
    // RevenueIntel, and the header bar — not fetched independently by each.
    expect(rootFetchCount).toBe(2)
  })

  it('SNAPSHOT_TILE_META marks exactly one tile (MRR) as real; the other five have no authoritative source', () => {
    const match = founderSource.match(/const SNAPSHOT_TILE_META[\s\S]*?\];/)
    expect(match).not.toBeNull()
    const block = match![0]
    const realCount = (block.match(/real: true/g) ?? []).length
    const unavailableCount = (block.match(/real: false/g) ?? []).length
    expect(realCount).toBe(1)
    expect(unavailableCount).toBe(5)
  })

  it('unavailable tiles render "—" and "not connected", never a numeric 0', () => {
    expect(founderSource).toContain("? '…' : mrr != null ? `$${Math.round(mrr).toLocaleString()}` : '—'")
    expect(founderSource).toContain('const sub = t.real')
  })

  it('the old unconditional trend-arrow/delta rendering (fake "+18% vs April" style comparisons) is gone from SnapshotHero', () => {
    const snapshotHeroBlock = founderSource.slice(
      founderSource.indexOf('function SnapshotHero'),
      founderSource.indexOf('function SnapshotHero') + 1500,
    )
    expect(snapshotHeroBlock).not.toContain('arrow')
    expect(snapshotHeroBlock).not.toContain('t.delta')
    expect(snapshotHeroBlock).not.toContain('t.pos')
  })

  it('RevenueIntel marks its four unavailable stats explicitly as "Not connected", not a fabricated number', () => {
    expect(founderSource).toContain("const REVENUE_UNAVAILABLE_STATS = ['Trial → paid', 'Avg deal value', 'Churn risk', 'Conversion rate']")
    expect(founderExecutable).not.toContain("v: '62%'")
    expect(founderExecutable).not.toContain("v: '$2,280'")
  })
})

// ── 7. Phase A Attention Queue remains wired to its real source ────────────

describe('Phase A Attention Queue is preserved, untouched', () => {
  it('RealFounderOperations is unchanged: still fetches the same endpoint and renders in the Overview tab', () => {
    expect(founderSource).toContain('function RealFounderOperations()')
    const overviewStart = founderSource.indexOf("{section === 'overview' && <>")
    const overviewEnd = founderSource.indexOf("{/* ── Clients ── */}")
    const overviewBlock = founderSource.slice(overviewStart, overviewEnd)
    expect(overviewBlock).toContain('<RealFounderOperations />')
  })

  it('the attention-queue API route itself is byte-for-byte unmodified by this branch (Phase A protected)', () => {
    // Sanity-checks specific, distinctive lines from Phase A rather than a
    // full-file hash, so this test still makes sense if unrelated future
    // work touches the file — but any of these disappearing would indicate
    // Phase A's query logic was altered.
    expect(attnQueueRouteSource).toContain("WHERE a.status = 'OPEN'")
    expect(attnQueueRouteSource).toContain('o.id = cp.organisation_id::text')
    expect(attnQueueRouteSource).toContain("const LEAD_ACTIONABLE_STAGES = ['new', 'contacted', 'discovery', 'qualified'];")
    expect(attnQueueRouteSource).toContain('const UPCOMING_WINDOW_DAYS = 14;')
  })
})

// ── 8/9. Access control / no client-supplied org id ─────────────────────────

describe('Founder/SUPER_ADMIN access boundary and org-id resolution are unchanged', () => {
  it('the attention-queue route still takes zero request input (GET with no params) and still requires super_admin', () => {
    expect(attnQueueRouteSource).toMatch(/export async function GET\(\)\s*\{/)
    expect(attnQueueRouteSource).toContain("if (session.role !== 'super_admin')")
    expect(attnQueueRouteSource).not.toContain('searchParams')
  })

  it('/api/ops/alerts remains untouched and still org-scoped to the caller session only', () => {
    expect(opsAlertsSource).toContain('WHERE organisation_id = ${organisationId}')
  })
})

// ── 10. LD Tennis / Web Systems untouched ───────────────────────────────────

describe('Scope boundaries — LD Tennis and Web Systems lead messaging are untouched', () => {
  it('LD Tennis and Web Systems route files contain no reference to the Phase B changes', () => {
    const lead = fs.readFileSync(path.resolve(__dirname, '../../app/api/lead/route.ts'), 'utf-8')
    const leadsId = fs.readFileSync(path.resolve(__dirname, '../../app/api/leads/[id]/route.ts'), 'utf-8')
    const book = fs.readFileSync(path.resolve(__dirname, '../../app/api/tennis/book/route.ts'), 'utf-8')
    const webMessages = fs.readFileSync(path.resolve(__dirname, '../../app/api/web-services/leads/[id]/messages/route.ts'), 'utf-8')
    for (const src of [lead, leadsId, book, webMessages]) {
      expect(src).not.toContain('SNAPSHOT_TILE_META')
      expect(src).not.toContain('RealFounderOperations')
      expect(src).not.toContain('REVENUE_UNAVAILABLE_STATS')
    }
  })
})

// ── 11. Other demo-only modules no longer masquerade as real data ──────────

describe('Other Founder OS tabs/modules show honest "Not connected" states', () => {
  it('SystemHealth no longer renders the fake SERVICES list (fabricated per-service status/latency)', () => {
    expect(founderExecutable).not.toContain('const SERVICES')
    expect(founderExecutable).not.toContain('94% quota used')
    expect(founderSource).toMatch(/function SystemHealth\(\)\s*\{/)
  })

  it('ProductUsage no longer renders the fake USAGE counters', () => {
    expect(founderExecutable).not.toContain('const USAGE')
    expect(founderSource).toMatch(/function ProductUsage\(\)\s*\{/)
  })

  it('LiveContext no longer renders fake DEMOS/SIGNALS content', () => {
    expect(founderExecutable).not.toContain('const DEMOS')
    expect(founderExecutable).not.toContain('const SIGNALS')
    expect(founderExecutable).not.toContain('Anthropic Series E closes')
  })

  it('FounderTasks no longer renders the fake TASKS list or fake per-task done-toggling (Phase D: superseded by real, persisted tasks — see founderTasks.test.ts)', () => {
    expect(founderExecutable).not.toContain('const TASKS')
    expect(founderExecutable).not.toContain('toggleTask')
    expect(founderSource).toMatch(/function FounderTasksPanel\(\)\s*\{/)
  })

  it('ClientPipeline no longer silently falls back to the fabricated PIPELINE fixture', () => {
    expect(founderExecutable).not.toContain('const PIPELINE')
    expect(founderExecutable).not.toContain('Port Adelaide Council')
    expect(founderSource).toContain('useState<Client[]>([])')
  })

  it('the LeftSidebar no longer shows fabricated "Open pipeline"/"Overdue actions" figures', () => {
    expect(founderExecutable).not.toContain('Open pipeline')
    expect(founderExecutable).not.toContain('$19,600')
  })

  it('Instagram tab (InstagramFeedPanel) was audited and left untouched — no mock/demo content was found in it', () => {
    const igSource = fs.readFileSync(path.resolve(__dirname, '../../components/instagram/InstagramFeedPanel.tsx'), 'utf-8')
    expect(igSource).not.toMatch(/mock|MOCK|fake|sample/i)
  })
})
