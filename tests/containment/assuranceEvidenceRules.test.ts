import { describe, it, expect } from 'vitest'
import {
  EVIDENCE_STATES, EVIDENCE_VERIFICATION_STATUSES, canCorrect, decisionConflicts, evidenceState, isReplaceableStatus,
} from '@/lib/assurance/evidenceRules'

// BrainBase Assurance — evidence verification rules (A0.1H). Pure: the one
// authority rule, the correction window, replaceable states and who may not
// decide.

describe('vocabulary mirrors the A0.1H CHECK constraint', () => {
  it('statuses', () => {
    expect(EVIDENCE_VERIFICATION_STATUSES).toEqual(['UNVERIFIED', 'AWAITING_VERIFICATION', 'ACCEPTED', 'REJECTED', 'SUPERSEDED'])
    for (const s of EVIDENCE_VERIFICATION_STATUSES) expect(EVIDENCE_STATES).toContain(s)
  })
})

describe('one authoritative state per workflow', () => {
  it('generic evidence shows its own lifecycle', () => {
    expect(evidenceState({ verificationStatus: 'ACCEPTED', contractorStatus: null })).toEqual({ state: 'ACCEPTED', authority: 'evidence' })
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: null })).toEqual({ state: 'UNVERIFIED', authority: 'evidence' })
  })
  it('contractor submission evidence always shows the submission decision, never "Unverified"', () => {
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: 'ACCEPTED' })).toEqual({ state: 'ACCEPTED', authority: 'contractor' })
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: 'SUBMITTED' })).toEqual({ state: 'AWAITING_VERIFICATION', authority: 'contractor' })
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: 'REJECTED' }).state).toBe('REJECTED')
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: 'SUPERSEDED' }).state).toBe('SUPERSEDED')
    expect(evidenceState({ verificationStatus: 'UNVERIFIED', contractorStatus: 'WITHDRAWN' }).state).toBe('WITHDRAWN')
  })
})

describe('correction and replacement', () => {
  it('correct only before a decision', () => {
    expect(canCorrect('UNVERIFIED')).toBe(true)
    expect(canCorrect('AWAITING_VERIFICATION')).toBe(true)
    for (const s of ['ACCEPTED', 'REJECTED', 'SUPERSEDED'] as const) expect(canCorrect(s)).toBe(false)
  })
  it('replace only a terminal decision', () => {
    expect(isReplaceableStatus('ACCEPTED')).toBe(true)
    expect(isReplaceableStatus('REJECTED')).toBe(true)
    for (const s of ['UNVERIFIED', 'AWAITING_VERIFICATION', 'SUPERSEDED'] as const) expect(isReplaceableStatus(s)).toBe(false)
  })
})

describe('independence', () => {
  const base = { viewerId: 'v', recordedBy: 'r', capturedBy: 'c', linkedActions: [] as { ownerUserId: string | null; workCompletedBy: string | null; everCompletedBy: string[] }[] }
  it('an unrelated person may decide', () => {
    expect(decisionConflicts(base)).toEqual([])
  })
  it('the recorder and the capturer may not', () => {
    expect(decisionConflicts({ ...base, recordedBy: 'v' })).toHaveLength(1)
    expect(decisionConflicts({ ...base, capturedBy: 'v' })).toHaveLength(1)
  })
  it('the owner, the current completer and any past completer of a supported action may not', () => {
    expect(decisionConflicts({ ...base, linkedActions: [{ ownerUserId: 'v', workCompletedBy: null, everCompletedBy: [] }] })).toHaveLength(1)
    expect(decisionConflicts({ ...base, linkedActions: [{ ownerUserId: 'o', workCompletedBy: 'v', everCompletedBy: [] }] })).toHaveLength(1)
    expect(decisionConflicts({ ...base, linkedActions: [{ ownerUserId: 'o', workCompletedBy: 'w', everCompletedBy: ['v'] }] })).toHaveLength(1)
  })
})
