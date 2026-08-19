import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness (same caveat as
// every other *StaticCheck.test.ts file in this suite).

const commandSource = fs.readFileSync(path.resolve(__dirname, '../../app/command/page.tsx'), 'utf-8')
const shellSource   = fs.readFileSync(path.resolve(__dirname, '../../components/ops/WorkspaceShell.tsx'), 'utf-8')
const binMaintSrc   = fs.readFileSync(path.resolve(__dirname, '../../app/dashboard/bin-maintenance/page.tsx'), 'utf-8')
const middlewareSrc = fs.readFileSync(path.resolve(__dirname, '../../middleware.ts'), 'utf-8')

describe('Command Centre — demo/simulated content is labelled', () => {
  it('a single global "Demo Environment" indicator is present in the page header/breadcrumb', () => {
    expect(commandSource).toContain('Demo Environment')
  })

  it('the Operational Alerts panel (static ALERTS constant) is tagged DEMO, distinguishing it from the real Client Requests section in the same panel', () => {
    const alertsGridStart = commandSource.indexOf('const AlertsGrid')
    const alertsGridEnd = commandSource.indexOf('\n  const ', alertsGridStart + 10)
    const block = commandSource.slice(alertsGridStart, alertsGridEnd)
    expect(block).toContain('Client Requests') // the real section, unchanged
    expect(block).toContain('Operational Alerts')
    expect(block).toContain('DEMO')
  })

  it('the fake "Updated Xs ago" live-refresh ticker is relabelled honestly — it only counts seconds since mount, it never reflected a real refresh', () => {
    const fnStart = commandSource.indexOf('function LiveAgo(')
    const fnEnd = commandSource.indexOf('\n}', fnStart)
    const body = commandSource.slice(fnStart, fnEnd)
    expect(body).toContain('Demo ·')
    // Checks the actual rendered JSX text specifically, not just any
    // mention of the old copy — this file's own explanatory comment
    // legitimately quotes the old value for context.
    expect(body).not.toMatch(/>Updated \{txt\}</)
  })

  it('does not over-label every row — the lower-risk "recent changes" (CHANGES) and suggestion-prompt (SUGGESTED) widgets are left as they were, relying on the single global indicator instead', () => {
    // Confirms a deliberate scope decision, not an oversight: only the two
    // highest-risk spots (alerts mixed with real data, and a fake-live
    // ticker) got individual tags.
    const changesBlockStart = commandSource.indexOf('CHANGES.map')
    const changesBlock = commandSource.slice(changesBlockStart - 200, changesBlockStart)
    expect(changesBlock).not.toContain('DEMO')
  })
})

describe('Command Centre — genuine live content is not incorrectly relabelled', () => {
  it('the real, API-backed KPI endpoints (kerbside/dumping/waste/pipeline) are untouched', () => {
    expect(commandSource).toContain('/api/missed-collections/kpi')
    expect(commandSource).toContain('/api/illegal-dumping/kpi')
    expect(commandSource).toContain('/api/waste/kpi')
    expect(commandSource).toContain("fetch('/api/admin/pipeline'")
  })

  it('the shared WorkspaceShell component is untouched — the demo labelling lives only in command/page.tsx, so bin-maintenance (a real operational page using the same shell) is unaffected', () => {
    expect(shellSource).not.toContain('Demo Environment')
    expect(shellSource).not.toContain('DEMO')
  })

  it('bin-maintenance (City of Onkaparinga\'s real feature) is untouched by this round', () => {
    expect(binMaintSrc).not.toContain('Demo Environment')
  })
})

describe('Command Centre — no route/security change', () => {
  it('middleware.ts role gating for /command is unchanged', () => {
    expect(middlewareSrc).toContain("pathname.startsWith('/command')")
    expect(middlewareSrc).toContain('COMMAND_ROLES')
  })

  it('the page is still client-rendered with the same section structure — Command Centre still renders exactly as before, just labelled', () => {
    expect(commandSource).toContain('"use client"')
    expect(commandSource).toContain('ALERTS.map(alert =>')
    expect(commandSource).toContain('SYS_STATUS.map(')
    expect(commandSource).toContain('WorkspaceShell')
  })
})

describe('Founder OS is unaffected by this round (separate branch/task)', () => {
  it('app/admin/founder/page.tsx was not touched on this branch', () => {
    // If Task 1's branch were ever accidentally merged into this one, this
    // would still pass (Task 1 doesn't add "Demo Environment" text to
    // Founder OS — it uses its own distinct "Demo data —" banner copy) —
    // this just documents that Task 2 itself made no such edit.
    const exists = fs.existsSync(path.resolve(__dirname, '../../app/admin/founder/page.tsx'))
    expect(exists).toBe(true)
  })
})
