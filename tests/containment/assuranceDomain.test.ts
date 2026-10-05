import { describe, it, expect } from 'vitest'
import {
  assuranceLabel, assuranceTone, checklistKeyFromLabel, parseChecklist, isOneOf,
  INCIDENT_STATUSES, OPEN_ACTION_STATUSES, OPEN_INCIDENT_STATUSES,
} from '@/lib/assurance/domain'
import { generateReference, isReferenceCollision, withFreshReference } from '@/lib/assurance/references'
import {
  isUuid, optionalBoolean, optionalDateTime, optionalText, optionalUserId, requiredEnum, requiredText, searchPattern, uuidList,
} from '@/lib/assurance/input'
import { viewerCan, toAssuranceViewer } from '@/lib/assurance/policy'

// BrainBase Assurance — pure domain/input/policy rules (no DB).

describe('Assurance vocabulary', () => {
  it('labels UPPER_SNAKE values readably and never throws', () => {
    expect(assuranceLabel('AWAITING_VERIFICATION')).toBe('Awaiting verification')
    expect(assuranceLabel('INJURY_SAFETY')).toBe('Injury / safety')
    expect(assuranceLabel('NOT_APPLICABLE')).toBe('N/A')
    expect(assuranceLabel(null)).toBe('—')
    expect(assuranceLabel('')).toBe('—')
  })
  it('maps statuses to tones; unknown values are neutral', () => {
    expect(assuranceTone('FAIL')).toBe('danger')
    expect(assuranceTone('CLOSED')).toBe('success')
    expect(assuranceTone('SOMETHING_NEW')).toBe('neutral')
  })
  it('open-state helpers exclude terminal states', () => {
    expect(OPEN_INCIDENT_STATUSES).not.toContain('CLOSED')
    expect(OPEN_INCIDENT_STATUSES).not.toContain('CANCELLED')
    expect(OPEN_INCIDENT_STATUSES.length).toBe(INCIDENT_STATUSES.length - 2)
    expect(OPEN_ACTION_STATUSES).toContain('AWAITING_VERIFICATION')
    expect(isOneOf(INCIDENT_STATUSES, 'REPORTED')).toBe(true)
    expect(isOneOf(INCIDENT_STATUSES, 'reported')).toBe(false)
  })
})

describe('checklist parsing (template versions are displayed faithfully)', () => {
  it('reads the governed shape, counts unreadable entries, and rejects duplicate keys', () => {
    const parsed = parseChecklist([
      { key: '01-a', label: 'Walkways clear', responseType: 'PASS_FAIL' },
      { key: '02-b', label: 'Pressure', responseType: 'NUMBER', required: false, guidance: '  psi  ' },
      { key: '02-b', label: 'Duplicate key' },
      { label: 'No key' },
      'not an object',
      { key: '03-c', label: 'Unknown type falls back', responseType: 'WEIRD' },
    ])
    expect(parsed.items.map(i => i.key)).toEqual(['01-a', '02-b', '03-c'])
    expect(parsed.items[1]).toMatchObject({ required: false, guidance: 'psi', responseType: 'NUMBER' })
    expect(parsed.items[2].responseType).toBe('PASS_FAIL')
    expect(parsed.invalidCount).toBe(3)
  })
  it('tolerates a non-array checklist', () => {
    expect(parseChecklist({})).toEqual({ items: [], invalidCount: 0 })
  })
  it('builds stable, ordered item keys', () => {
    expect(checklistKeyFromLabel('Drain grates secure!', 1)).toBe('02-drain-grates-secure')
    expect(checklistKeyFromLabel('***', 0)).toBe('01-item')
  })
})

describe('references', () => {
  it('generates prefixed, year-scoped, unambiguous references', () => {
    const ref = generateReference('incident', new Date('2026-09-29T00:00:00Z'), () => 0.5)
    expect(ref).toMatch(/^INC-2026-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(generateReference('action')).toMatch(/^ACT-\d{4}-/)
  })
  it('only treats *_org_reference_key unique violations as collisions', () => {
    expect(isReferenceCollision({ code: '23505', constraint: 'assurance_incidents_org_reference_key' })).toBe(true)
    expect(isReferenceCollision({ code: '23505', constraint: 'assurance_investigation_incidents_pair_key' })).toBe(false)
    expect(isReferenceCollision({ code: '23503' })).toBe(false)
    expect(isReferenceCollision(null)).toBe(false)
  })
  it('retries on a reference collision and rethrows anything else', async () => {
    let n = 0
    const r = await withFreshReference('finding', async ref => {
      n++
      if (n < 3) throw Object.assign(new Error('dup'), { code: '23505', constraint: 'assurance_findings_org_reference_key' })
      return ref
    })
    expect(n).toBe(3)
    expect(r).toMatch(/^FND-/)
    await expect(withFreshReference('finding', async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })
})

describe('input normalisation (allow-listed, bounded)', () => {
  it('validates ids', () => {
    expect(isUuid('00000000-0000-0000-0000-000000000001')).toBe(true)
    expect(isUuid("1' OR '1'='1")).toBe(false)
    expect(() => optionalUserId("x'; drop", 'Owner')).toThrow(/valid user/)
    expect(optionalUserId('cmabc123', 'Owner')).toBe('cmabc123')
    expect(() => uuidList(['nope'], 'Findings')).toThrow()
    expect(uuidList(['00000000-0000-0000-0000-00000000000A', '00000000-0000-0000-0000-00000000000a'], 'F')).toEqual(['00000000-0000-0000-0000-00000000000a'])
  })
  it('trims text, rejects blanks (the schema forbids blank strings), caps length', () => {
    expect(requiredText('  hi  ', 'Title')).toBe('hi')
    expect(() => requiredText('   ', 'Title')).toThrow(/required/)
    expect(optionalText('   ', 'Notes')).toBeNull()
    expect(() => requiredText('x'.repeat(201), 'Title', 200)).toThrow(/200/)
  })
  it('validates enums, dates and booleans', () => {
    expect(() => requiredEnum(INCIDENT_STATUSES, 'DELETED', 'Status')).toThrow()
    expect(optionalDateTime('2026-09-01T10:00:00Z', 'D')).toBe('2026-09-01T10:00:00.000Z')
    expect(() => optionalDateTime('yesterday', 'D')).toThrow()
    expect(() => optionalDateTime('1800-01-01', 'D')).toThrow(/range/)
    expect(optionalBoolean('on', false)).toBe(true)
    expect(optionalBoolean(undefined, true)).toBe(true)
  })
  it('escapes LIKE metacharacters in search text', () => {
    expect(searchPattern('50%_off\\')).toBe('%50\\%\\_off\\\\%')
    expect(searchPattern('   ')).toBeNull()
    expect(searchPattern(42)).toBeNull()
  })
})

describe('role policy', () => {
  it('maps roles to operation floors and restricted visibility', () => {
    const viewer = toAssuranceViewer({ organisationId: 'o', userId: 'u', role: 'viewer' })
    const manager = toAssuranceViewer({ organisationId: 'o', userId: 'u', role: 'manager' })
    const admin = toAssuranceViewer({ organisationId: 'o', userId: 'u', role: 'admin' })
    const analyst = toAssuranceViewer({ organisationId: 'o', userId: 'u', role: 'analyst' })
    expect([viewerCan(viewer, 'view'), viewerCan(viewer, 'record')]).toEqual([true, false])
    expect([viewerCan(manager, 'record'), viewerCan(manager, 'verify'), viewerCan(manager, 'close'), viewerCan(manager, 'administer')]).toEqual([true, true, true, false])
    expect(viewerCan(admin, 'administer')).toBe(true)
    expect([viewer.canViewAllRestricted, manager.canViewAllRestricted, admin.canViewAllRestricted]).toEqual([false, false, true])
    // Unknown/unranked roles fail closed everywhere.
    expect(viewerCan(analyst, 'view')).toBe(false)
    expect(analyst.canViewAllRestricted).toBe(false)
  })
})
