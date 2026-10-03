import { describe, it, expect } from 'vitest'
import { FINDING_STATUSES } from '@/lib/assurance/domain'
import {
  FINDING_REGISTER_VIEWS, FINDING_REOPEN_TO, FINDING_TRANSITIONS, actionFacts, findingClosureReadiness, findingProgress,
  parseFindingView, pathToClosed, transitionNeedsReason,
} from '@/lib/assurance/findingRules'

// BrainBase Assurance — Findings & corrective Actions rules (A0.1I). Pure:
// derived progress, closure readiness, reasons, the reopen path and the
// work / verification / closure separation of an Action.

describe('finding lifecycle', () => {
  it('every status has a transition entry; terminal statuses have no ordinary exits', () => {
    for (const s of FINDING_STATUSES) expect(FINDING_TRANSITIONS[s]).toBeDefined()
    expect(FINDING_TRANSITIONS.CLOSED).toEqual([])
    expect(FINDING_TRANSITIONS.CANCELLED).toEqual([])
  })
  it('reopen is a separate operation to UNDER_REVIEW only', () => {
    expect(FINDING_REOPEN_TO).toBe('UNDER_REVIEW')
  })
  it('a reason is required for CLOSED and CANCELLED only', () => {
    expect(FINDING_STATUSES.filter(transitionNeedsReason)).toEqual(['CLOSED', 'CANCELLED'])
  })
  it('the shortest ordinary route to CLOSED', () => {
    expect(pathToClosed('UNDER_REVIEW')).toEqual(['CLOSED'])
    expect(pathToClosed('AWAITING_VERIFICATION')).toEqual(['CLOSED'])
    expect(pathToClosed('OPEN')).toEqual(['UNDER_REVIEW', 'CLOSED'])
    expect(pathToClosed('ACTION_REQUIRED')).toEqual(['UNDER_REVIEW', 'CLOSED'])
    expect(pathToClosed('ACTION_IN_PROGRESS')).toEqual(['AWAITING_VERIFICATION', 'CLOSED'])
    expect(pathToClosed('CANCELLED')).toBeNull()
  })
})

describe('derived progress (never persisted)', () => {
  const p = (status: 'OPEN' | 'CLOSED' | 'CANCELLED' | 'UNDER_REVIEW', open: number, closed: number) =>
    findingProgress({ status, open_action_count: open, closed_action_count: closed })
  it('no actions, or only cancelled ones -> needs action', () => {
    expect(p('OPEN', 0, 0)).toBe('NEEDS_ACTION')
  })
  it('any open action -> underway, even alongside closed ones', () => {
    expect(p('OPEN', 1, 0)).toBe('ACTIONS_UNDERWAY')
    expect(p('UNDER_REVIEW', 1, 3)).toBe('ACTIONS_UNDERWAY')
  })
  it('only finished actions with at least one closed -> ready for a closure decision', () => {
    expect(p('UNDER_REVIEW', 0, 1)).toBe('READY_FOR_CLOSURE')
  })
  it('terminal findings report their status', () => {
    expect(p('CLOSED', 0, 1)).toBe('CLOSED')
    expect(p('CANCELLED', 1, 0)).toBe('CANCELLED')
  })
  it('register views parse safely', () => {
    expect(FINDING_REGISTER_VIEWS).toEqual(['all', 'open', 'needs_action', 'underway', 'overdue', 'ready', 'closed'])
    expect(parseFindingView('ready')).toBe('ready')
    expect(parseFindingView("ready' OR 1=1")).toBe('all')
    expect(parseFindingView(undefined)).toBe('all')
  })
})

describe('closure readiness — factual blockers only', () => {
  const base = { openVisibleActions: [] as { reference: string }[], openHiddenActions: 0, viewerCanClose: true }
  it('nothing blocks an UNDER_REVIEW finding with no open actions', () => {
    const r = findingClosureReadiness({ ...base, status: 'UNDER_REVIEW' })
    expect(r.canCloseNow).toBe(true)
    expect(r.blockers).toEqual([])
    expect(r.notes.join(' ')).toMatch(/closure reason/)
  })
  it('names visible open actions and only says "one or more" for hidden ones', () => {
    const r = findingClosureReadiness({ ...base, status: 'UNDER_REVIEW', openVisibleActions: [{ reference: 'ACT-1' }], openHiddenActions: 2 })
    expect(r.canCloseNow).toBe(false)
    expect(r.blockers[0]).toMatch(/still open: ACT-1/)
    expect(r.blockers[1]).toBe('One or more linked actions you cannot see are still open.')
    expect(r.blockers.join(' ')).not.toMatch(/2/)
  })
  it('explains the transition path when the status cannot close directly', () => {
    const r = findingClosureReadiness({ ...base, status: 'ACTION_IN_PROGRESS' })
    expect(r.canCloseNow).toBe(false)
    expect(r.blockers[0]).toMatch(/move it to awaiting verification first/)
  })
  it('an overdue deadline and missing permission are notes, not blockers', () => {
    const r = findingClosureReadiness({ ...base, status: 'UNDER_REVIEW', viewerCanClose: false, closureOverdue: true })
    expect(r.canCloseNow).toBe(true)
    expect(r.notes.join(' ')).toMatch(/managers and admins/)
    expect(r.notes.join(' ')).toMatch(/extension/)
  })
  it('terminal findings are already finished', () => {
    expect(findingClosureReadiness({ ...base, status: 'CLOSED' }).canCloseNow).toBe(false)
  })
})

describe('action facts: work complete / verified / closed are separate', () => {
  const t0 = '2026-10-01T00:00:00Z'
  const t1 = '2026-10-02T00:00:00Z'
  it('nothing done', () => {
    expect(actionFacts({ status: 'OPEN', work_completed_at: null, verification_required: true, latest_verification_result: null }))
      .toEqual({ work: 'NOT_COMPLETE', verification: 'NOT_YET', closure: 'OPEN' })
  })
  it('work complete is not verified', () => {
    expect(actionFacts({ status: 'AWAITING_VERIFICATION', work_completed_at: t0, verification_required: true, latest_verification_result: null }))
      .toEqual({ work: 'COMPLETE', verification: 'NOT_YET', closure: 'OPEN' })
  })
  it('verified is not closed', () => {
    expect(actionFacts({ status: 'AWAITING_VERIFICATION', work_completed_at: t0, verification_required: true, latest_verification_result: 'ACCEPTED', latest_verified_at: t1 }))
      .toEqual({ work: 'COMPLETE', verification: 'VERIFIED', closure: 'OPEN' })
  })
  it('a rejection after the completion sends the work back; a later completion clears it', () => {
    expect(actionFacts({ status: 'IN_PROGRESS', work_completed_at: t0, verification_required: true, latest_verification_result: 'REJECTED', latest_verified_at: t1 }).work).toBe('REWORK_REQUIRED')
    expect(actionFacts({ status: 'AWAITING_VERIFICATION', work_completed_at: t1, verification_required: true, latest_verification_result: 'REJECTED', latest_verified_at: t0 }).work).toBe('COMPLETE')
  })
  it('more evidence and not-required verification', () => {
    expect(actionFacts({ status: 'AWAITING_EVIDENCE', work_completed_at: t0, verification_required: true, latest_verification_result: 'MORE_EVIDENCE_REQUIRED', latest_verified_at: t1 }).verification).toBe('MORE_EVIDENCE')
    expect(actionFacts({ status: 'CLOSED', work_completed_at: t0, verification_required: false, latest_verification_result: null }))
      .toEqual({ work: 'COMPLETE', verification: 'NOT_REQUIRED', closure: 'CLOSED' })
  })
})
