import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const PAGE_SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const pageSource = fs.readFileSync(PAGE_SOURCE_PATH, 'utf-8')

const GET_ROUTE_PATH = path.resolve(__dirname, '../../app/api/dashboard/sessions/route.ts')
const getRouteSource = fs.readFileSync(GET_ROUTE_PATH, 'utf-8')

describe('GET /api/dashboard/sessions — no write side effect (regression guard)', () => {
  it('the GET function body itself contains no reconcile call — only the SELECT and its fallback', () => {
    const getStart = getRouteSource.indexOf('export async function GET(req: NextRequest)')
    const postStart = getRouteSource.indexOf('export async function POST(')
    expect(getStart).toBeGreaterThan(-1)
    expect(postStart).toBeGreaterThan(getStart)
    const getFnBody = getRouteSource.slice(getStart, postStart)
    expect(getFnBody).not.toContain('reconcileFutureInstances')
    expect(getFnBody).not.toContain('reconcileAllSessionsForOrg')
  })

  it('POST in the same file still awaits reconciliation on session create (Task 3: preserve this trigger)', () => {
    expect(getRouteSource).toContain('await reconcileFutureInstances(')
  })
})

describe('PATCH/generate-instances routes — reconciliation remains awaited (Task 3)', () => {
  it('session edit still awaits reconcileFutureInstances', () => {
    const editSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/dashboard/sessions/[id]/route.ts'), 'utf-8')
    expect(editSource).toContain('await reconcileFutureInstances(')
  })

  it('the manual "Repair future dates" action still awaits reconcileFutureInstances', () => {
    const repairSource = fs.readFileSync(path.resolve(__dirname, '../../app/api/dashboard/sessions/[id]/generate-instances/route.ts'), 'utf-8')
    expect(repairSource).toContain('await reconcileFutureInstances(')
  })
})

describe('app/dashboard/sessions/page.tsx — the automatic reconcile trigger is an explicit, awaited POST, never a side effect of a read', () => {
  it('the dashboard calls the new authenticated reconcile endpoint via POST, not by piggy-backing on the sessions GET', () => {
    expect(pageSource).toContain("fetch(`${API}/reconcile`, { method: 'POST' })")
  })

  it('the call is chained with .then()/.catch() (awaited to completion), not fired as an unhandled void call', () => {
    const block = pageSource.match(/fetch\(`\$\{API\}\/reconcile`, \{ method: 'POST' \}\)[\s\S]{0,700}/)
    expect(block).not.toBeNull()
    expect(block![0]).toContain('.then(r => r.ok ? r.json()')
    expect(block![0]).toContain('.catch(')
  })

  it('a reconcile failure sets a non-destructive warning and does not clear or hide already-loaded sessions/calendar state', () => {
    expect(pageSource).toContain('setReconcileWarning(')
    // The catch branch must not call setSessions([]) / setCalendarInstances([]) or similar clears.
    const catchBlock = pageSource.match(/\.catch\(\(\) => setReconcileWarning\([^)]*\)\)/)
    expect(catchBlock).not.toBeNull()
  })

  it('the warning banner is dismissible and rendered even when sessions/calendar data is already present (not gated behind an empty-state check)', () => {
    expect(pageSource).toContain('{reconcileWarning && (')
    expect(pageSource).toContain('onClick={() => setReconcileWarning(null)}')
  })
})
