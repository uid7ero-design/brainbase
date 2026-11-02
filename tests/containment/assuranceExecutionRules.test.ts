import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { executionReadiness, matchesExecutionView, parseExecutionView } from '@/lib/assurance/executionRules'

// Inspection / Audit execution readiness (pure). The same function drives the
// register, the detail page and the completion guard, so these pin the rule.

const items = [
  { key: 'a', required: true },
  { key: 'b', required: true },
  { key: 'c', required: false },
]

describe('executionReadiness', () => {
  it('a planned record is not ready and says it has not been started', () => {
    const r = executionReadiness({ status: 'PLANNED', adHoc: false, items, answeredKeys: [], noun: 'inspection' })
    expect(r.ready).toBe(false)
    expect(r.incomplete).toBe(false)
    expect(r.blockers[0]).toMatch(/not been started/)
    expect(r).toMatchObject({ total: 3, answered: 0, requiredTotal: 2, requiredAnswered: 0 })
  })
  it('in progress with required items missing is incomplete, with a counted blocker', () => {
    const r = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: ['a', 'c'], noun: 'inspection' })
    expect(r.ready).toBe(false)
    expect(r.incomplete).toBe(true)
    expect(r.blockers).toEqual(['1 required item has no response yet.'])
    expect(r).toMatchObject({ answered: 2, requiredAnswered: 1 })
  })
  it('optional items never block; all required answered = ready', () => {
    const r = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: ['a', 'b'], noun: 'audit' })
    expect(r.ready).toBe(true)
    expect(r.blockers).toEqual([])
  })
  it('audit wording uses criteria', () => {
    const r = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: [], noun: 'audit' })
    expect(r.blockers).toEqual(['2 required criteria have no response yet.'])
  })
  it('responses for keys outside the version are not counted as answered items', () => {
    const r = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: ['a', 'zzz'], noun: 'inspection' })
    expect(r.answered).toBe(1)
    expect(r.ready).toBe(false)
  })
  it('ad hoc: needs at least one recorded item, then is ready', () => {
    expect(executionReadiness({ status: 'IN_PROGRESS', adHoc: true, items: [], answeredKeys: [], noun: 'inspection' }).blockers)
      .toEqual(['Record at least one item before completing an ad hoc inspection.'])
    const r = executionReadiness({ status: 'IN_PROGRESS', adHoc: true, items: [], answeredKeys: ['adhoc-x'], noun: 'inspection' })
    expect(r).toMatchObject({ ready: true, total: 1, answered: 1, requiredTotal: 0 })
  })
  it('completed and cancelled records are never ready (completion is not repeatable)', () => {
    for (const status of ['COMPLETED', 'CANCELLED'] as const) {
      const r = executionReadiness({ status, adHoc: false, items, answeredKeys: ['a', 'b'], noun: 'inspection' })
      expect(r.ready, status).toBe(false)
      expect(r.incomplete, status).toBe(false)
    }
  })
  it('Findings, Actions and evidence are not inputs: they cannot block completion', () => {
    // The signature has no such inputs — pinned so a future edit cannot add an implicit rule.
    const src = fs.readFileSync(path.join(process.cwd(), 'lib/assurance/executionRules.ts'), 'utf8')
    const sig = src.slice(src.indexOf('export function executionReadiness('), src.indexOf('): ExecutionReadiness'))
    expect(sig).not.toMatch(/finding|action|evidence/i)
  })
})

describe('register views', () => {
  const ready = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: ['a', 'b'], noun: 'inspection' })
  const incomplete = executionReadiness({ status: 'IN_PROGRESS', adHoc: false, items, answeredKeys: [], noun: 'inspection' })
  it('parses only known views', () => {
    expect(parseExecutionView('ready')).toBe('ready')
    expect(parseExecutionView('due')).toBe('due')
    expect(parseExecutionView('overdue-score')).toBe('all')
    expect(parseExecutionView(undefined)).toBe('all')
  })
  it('matches rows by real status and readiness', () => {
    expect(matchesExecutionView('ready', { status: 'IN_PROGRESS', finding_count: 0, readiness: ready })).toBe(true)
    expect(matchesExecutionView('ready', { status: 'IN_PROGRESS', finding_count: 0, readiness: incomplete })).toBe(false)
    expect(matchesExecutionView('incomplete', { status: 'IN_PROGRESS', finding_count: 0, readiness: incomplete })).toBe(true)
    expect(matchesExecutionView('findings', { status: 'COMPLETED', finding_count: 2, readiness: ready })).toBe(true)
    expect(matchesExecutionView('findings', { status: 'COMPLETED', finding_count: 0, readiness: ready })).toBe(false)
    expect(matchesExecutionView('cancelled', { status: 'CANCELLED', finding_count: 0, readiness: incomplete })).toBe(true)
  })
})
