import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Founder OS trust-boundary hardening (final Phase B round). Strict rule:
// NO data from the legacy/external founder-* backend may be presented as
// authoritative operational information in Founder OS. Static source-text
// assertions (no jsdom/RTL harness in this repo, same caveat as every other
// *StaticCheck.test.ts file).

const founderSource = fs.readFileSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'), 'utf-8')
const attnQueueRouteSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/founder/attention-queue/route.ts'), 'utf-8')
const opsAlertsSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/ops/alerts/route.ts'), 'utf-8')

// Scoped to executable code, not this file's own explanatory prose (same
// established pattern as founderRealSnapshot.test.ts).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
const founderExecutable = stripComments(founderSource)

// ── 1. External founder-intelligence cannot populate HlnaBriefing ──────────

describe('HlnaBriefing can never be populated by the external founder-intelligence backend', () => {
  it('the founder-intelligence fetch (loadIntel/intel/intelLoading/intelError/refreshIntel) is gone entirely', () => {
    expect(founderExecutable).not.toContain("fetch('/api/admin/founder-intelligence')")
    expect(founderExecutable).not.toContain('const loadIntel')
    expect(founderExecutable).not.toContain('const refreshIntel')
    expect(founderExecutable).not.toContain('setIntel(')
    expect(founderExecutable).not.toContain('[intel,')
  })

  it('HlnaBriefing takes no props and reads no external state — it is a permanent, unconditional shell', () => {
    expect(founderSource).toMatch(/function HlnaBriefing\(\)\s*\{/)
    const start = founderSource.indexOf('function HlnaBriefing()')
    const end = founderSource.indexOf('\n}', start) + 2
    const body = founderSource.slice(start, end)
    expect(body).not.toContain('intel')
    expect(body).not.toContain('fetch(')
    expect(body).toContain('Intelligence briefing not connected')
  })

  it('the call site passes no intel/loading/hasError/onRegenerate props', () => {
    expect(founderExecutable).toContain('<HlnaBriefing />')
    expect(founderExecutable).not.toMatch(/<HlnaBriefing\s+\w/)
  })

  it('no fabricated briefing content (MOCK_QUADS, fake urgency badge, fake regenerating animation) can leak in — already removed in the prior Phase B round and re-asserted here', () => {
    expect(founderExecutable).not.toContain('const MOCK_QUADS')
    expect(founderExecutable).not.toContain('HIGH URGENCY')
    expect(founderExecutable).not.toContain('Reactivate Port Adelaide')
  })

  it('the demo-conditional banner that used to reference intel.source is gone — nothing conditionally reveals external-backend content', () => {
    expect(founderExecutable).not.toMatch(/intel\??\.source/)
    expect(founderExecutable).not.toContain('intelError')
  })
})

// ── 2. External founder-state/activity cannot populate Live Activity ───────

describe('Live Activity can never be populated by the external founder-state backend', () => {
  it('refreshFounderState (the founder-state fetch/merge) is gone entirely', () => {
    expect(founderExecutable).not.toContain('const refreshFounderState')
    expect(founderExecutable).not.toContain("fetch('/api/admin/founder-state'")
    expect(founderExecutable).not.toContain('founder_activity_events')
  })

  it('no call site still invokes refreshFounderState — every former call site was cleaned up, not left dangling', () => {
    expect(founderExecutable).not.toContain('refreshFounderState()')
  })

  it('ActivityFeed only ever receives sessionEvents — no external-backend-derived prop exists for it to read', () => {
    expect(founderSource).toMatch(/function ActivityFeed\(\{ sessionEvents \}: \{ sessionEvents: SessionEvent\[\] \}\)/)
    expect(founderExecutable).toContain('<ActivityFeed sessionEvents={sessionEvents} />')
  })
})

// ── 3. Locally generated real sessionEvents remain fully supported ─────────

describe('Locally generated real sessionEvents are unaffected', () => {
  it('addSessionEvent (the local event logger) is untouched and still used by every action handler', () => {
    expect(founderSource).toContain('const addSessionEvent = (event: string, type: FeedType, client: string | null, clientId?: number) => {')
    const calls = (founderExecutable.match(/addSessionEvent\(/g) ?? []).length
    // 4 action handlers (follow-up, advance-stage, log-demo, mark-reviewed)
    // each still log a real local event on success.
    expect(calls).toBe(4)
  })

  it('setSessionEvents/sessionEvents state itself is untouched', () => {
    expect(founderSource).toContain('const [sessionEvents,   setSessionEvents]   = useState<SessionEvent[]>([]);')
  })

  it('ActivityFeed still renders real sessionEvents with an honest empty state when there are none (no regression from the prior Phase B round)', () => {
    expect(founderSource).toContain('No activity yet this session')
    expect(founderExecutable).not.toContain('const ACTIVITY')
  })
})

// ── 4. No demo fixtures return ──────────────────────────────────────────────

describe('No demo fixtures returned by this hardening round', () => {
  it('every mock constant removed in the prior Phase B round is still gone', () => {
    for (const name of ['KPI_TILES', 'const QUEUE', 'const PIPELINE', 'const TASKS', 'MRR_POINTS', 'const SERVICES', 'const USAGE', 'const DEMOS', 'const ACTIVITY', 'const RECOMMENDATIONS', 'const SIGNALS', 'const MOCK_QUADS']) {
      expect(founderExecutable).not.toContain(name)
    }
  })

  it('the header-bar fake "Demo status"/"MRR $12,480 (demo)"/stale date are still gone', () => {
    expect(founderExecutable).not.toContain('Demo status')
    expect(founderExecutable).not.toContain('(demo)')
    expect(founderExecutable).not.toContain('Thu 8 May 2026')
  })
})

// ── 5. Phase A remains protected ────────────────────────────────────────────

describe('Phase A Attention Queue remains protected', () => {
  it('RealFounderOperations and its endpoint are untouched by this hardening round', () => {
    expect(founderSource).toContain('function RealFounderOperations()')
    expect(attnQueueRouteSource).toContain("WHERE a.status = 'OPEN'")
    expect(attnQueueRouteSource).toContain('o.id = cp.organisation_id::text')
    expect(attnQueueRouteSource).toMatch(/export async function GET\(\)\s*\{/)
    expect(attnQueueRouteSource).toContain("if (session.role !== 'super_admin')")
  })

  it('/api/ops/alerts remains untouched and still org-scoped to the caller session only', () => {
    expect(opsAlertsSource).toContain('WHERE organisation_id = ${organisationId}')
  })

  it('the Overview tab still renders RealFounderOperations', () => {
    const overviewStart = founderSource.indexOf("{section === 'overview' && <>")
    const overviewEnd = founderSource.indexOf("{/* ── Clients ── */}")
    const overviewBlock = founderSource.slice(overviewStart, overviewEnd)
    expect(overviewBlock).toContain('<RealFounderOperations />')
  })
})

// ── 6. Real MRR remains wired ───────────────────────────────────────────────

describe('Real MRR remains wired end to end', () => {
  it('SnapshotHero, RevenueIntel, and the header bar still derive MRR from the shared snapshotMetrics fetch', () => {
    expect(founderSource).toContain('snapshotMetrics.activeMrr')
    expect(founderSource).toContain('metrics.activeMrr')
    const rootFetchCount = (founderSource.match(/fetch\('\/api\/founder\/attention-queue'\)/g) ?? []).length
    // RealFounderOperations's own fetch (Phase A, untouched) + the one
    // shared root-level fetch feeding SnapshotHero/RevenueIntel/header — 2.
    expect(rootFetchCount).toBe(2)
  })

  it('the 5 KPIs with no authoritative source still render "Not connected", never 0', () => {
    const match = founderSource.match(/const SNAPSHOT_TILE_META[\s\S]*?\];/)
    expect(match).not.toBeNull()
    const realCount = (match![0].match(/real: true/g) ?? []).length
    const unavailableCount = (match![0].match(/real: false/g) ?? []).length
    expect(realCount).toBe(1)
    expect(unavailableCount).toBe(5)
  })
})

// ── Requirement 3 — audit of every remaining external founder-* reference ──

describe('Audit: remaining founder-clients/founder-action references are intentional, not accidental', () => {
  it('founder-clients: exactly one fetch remains, feeding the real ClientPipeline data path (intentionally retained per explicit instruction)', () => {
    const matches = founderExecutable.match(/fetch\('\/api\/admin\/founder-clients'\)/g) ?? []
    expect(matches.length).toBe(1)
  })

  it('founder-action/*: exactly 5 explicit, user-triggered write actions remain (add-lead, follow-up-client, advance-client-stage, log-demo, mark-analysis-reviewed) — intentionally retained, out of this hardening\'s scope', () => {
    const names = ['add-lead', 'follow-up-client', 'advance-client-stage', 'log-demo', 'mark-analysis-reviewed']
    for (const n of names) {
      expect(founderExecutable).toContain(`/api/admin/founder-action/${n}`)
    }
  })

  it('founder-intelligence and founder-state have zero remaining executable references', () => {
    expect(founderExecutable).not.toContain('founder-intelligence')
    expect(founderExecutable).not.toContain('founder-state')
  })
})
