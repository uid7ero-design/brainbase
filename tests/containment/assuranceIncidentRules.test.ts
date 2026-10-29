import { describe, it, expect } from 'vitest'
import { INCIDENT_STATUSES, INVESTIGATION_STATUSES } from '@/lib/assurance/domain'
import {
  INCIDENT_REGISTER_VIEWS, INCIDENT_TRANSITIONS, INVESTIGATION_REGISTER_VIEWS, INVESTIGATION_TRANSITIONS,
  incidentClosureReadiness, incidentTriageFacts, investigationCompletionReadiness, parseIncidentView,
  parseInvestigationView, transitionPath,
} from '@/lib/assurance/incidentRules'

// BrainBase Assurance — Incidents & Investigations rules. Pure: transition
// maps, register views, triage facts and readiness mirror the existing
// closure rules; nothing here decides or writes anything.

describe('lifecycles', () => {
  it('every status has an entry; terminal statuses have no exits (no reopen)', () => {
    for (const s of INCIDENT_STATUSES) expect(INCIDENT_TRANSITIONS[s]).toBeDefined()
    for (const s of INVESTIGATION_STATUSES) expect(INVESTIGATION_TRANSITIONS[s]).toBeDefined()
    expect(INCIDENT_TRANSITIONS.CLOSED).toEqual([])
    expect(INCIDENT_TRANSITIONS.CANCELLED).toEqual([])
    expect(INVESTIGATION_TRANSITIONS.COMPLETED).toEqual([])
    expect(INVESTIGATION_TRANSITIONS.CANCELLED).toEqual([])
  })
  it('shortest paths', () => {
    expect(transitionPath(INCIDENT_TRANSITIONS, 'REPORTED', 'CLOSED', ['CANCELLED'])).toEqual(['UNDER_REVIEW', 'CLOSED'])
    expect(transitionPath(INCIDENT_TRANSITIONS, 'UNDER_INVESTIGATION', 'CLOSED', ['CANCELLED'])).toEqual(['AWAITING_VERIFICATION', 'CLOSED'])
    expect(transitionPath(INVESTIGATION_TRANSITIONS, 'OPEN', 'COMPLETED', ['CANCELLED'])).toEqual(['IN_PROGRESS', 'AWAITING_REVIEW', 'COMPLETED'])
    expect(transitionPath(INCIDENT_TRANSITIONS, 'CLOSED', 'UNDER_REVIEW')).toBeNull()
  })
})

describe('register views parse safely', () => {
  it('incidents', () => {
    expect(INCIDENT_REGISTER_VIEWS).toEqual(['all', 'open', 'needs_triage', 'investigation_required', 'under_investigation', 'findings_open', 'ready', 'closed'])
    expect(parseIncidentView('ready')).toBe('ready')
    expect(parseIncidentView("ready'--")).toBe('all')
    expect(parseIncidentView(undefined)).toBe('all')
  })
  it('investigations', () => {
    expect(INVESTIGATION_REGISTER_VIEWS).toContain('awaiting_review')
    expect(parseInvestigationView('finished')).toBe('finished')
    expect(parseInvestigationView({})).toBe('all')
  })
})

describe('triage facts are facts, not a score', () => {
  it('reports what is and is not set', () => {
    const t = incidentTriageFacts({ status: 'REPORTED', risk_name: null, owner_name: 'Olly', immediate_response: null, investigation_count: 0, finding_count: 2 })
    expect(Object.fromEntries(t.map(x => [x.key, x.done]))).toEqual({ risk: false, owner: true, immediate: false, investigation: false, findings: true })
  })
  it('a "needs investigation" decision counts as decided, with honest wording', () => {
    const t = incidentTriageFacts({ status: 'INVESTIGATION_REQUIRED', risk_name: 'High', owner_name: null, immediate_response: 'x', investigation_count: 0, finding_count: 0 })
    const inv = t.find(x => x.key === 'investigation')!
    expect(inv.done).toBe(true)
    expect(inv.detail).toMatch(/not yet started/)
  })
})

describe('incident closure readiness mirrors the closure guard', () => {
  const base = { openVisibleFindings: [] as { reference: string }[], openHiddenFindings: 0, activeVisibleInvestigations: [] as { reference: string }[], activeHiddenInvestigations: 0, openActionCount: 0, viewerCanClose: true }
  it('nothing blocks an AWAITING_VERIFICATION incident with everything resolved', () => {
    expect(incidentClosureReadiness({ ...base, status: 'AWAITING_VERIFICATION' }).canFinishNow).toBe(true)
  })
  it('names visible blockers, says "one or more" for hidden ones, never their count', () => {
    const r = incidentClosureReadiness({ ...base, status: 'AWAITING_VERIFICATION', openVisibleFindings: [{ reference: 'FND-1' }], openHiddenFindings: 3, activeVisibleInvestigations: [{ reference: 'INV-1' }], activeHiddenInvestigations: 2 })
    expect(r.blockers).toEqual([
      'Linked finding still open: FND-1.',
      'One or more linked findings you cannot see are still open.',
      'Investigation not completed: INV-1.',
      'One or more linked investigations you cannot see are not completed.',
    ])
    expect(r.blockers.join(' ')).not.toMatch(/[23]/)
  })
  it('status path is a blocker; open actions are a note', () => {
    const r = incidentClosureReadiness({ ...base, status: 'UNDER_INVESTIGATION', openActionCount: 2 })
    expect(r.blockers[0]).toMatch(/move it to awaiting verification first/)
    expect(r.notes.join(' ')).toMatch(/2 corrective actions are still open/)
  })
})

describe('investigation completion readiness', () => {
  it('open findings and a passed target date are notes, never blockers', () => {
    const r = investigationCompletionReadiness({ status: 'AWAITING_REVIEW', openFindingCount: 4, targetPassed: true, viewerCanClose: true })
    expect(r.canFinishNow).toBe(true)
    expect(r.notes.join(' ')).toMatch(/does not block completion/)
    expect(r.notes.join(' ')).toMatch(/planning date only/)
  })
  it('finished investigations', () => {
    expect(investigationCompletionReadiness({ status: 'COMPLETED', openFindingCount: 0, targetPassed: false, viewerCanClose: true }).canFinishNow).toBe(false)
  })
})
