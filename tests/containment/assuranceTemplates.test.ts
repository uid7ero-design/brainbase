import { describe, it, expect } from 'vitest'
import { groupTemplateSections, parseChecklist, parseCriteria, TEMPLATE_KINDS, TEMPLATE_VERSION_STATUSES, assuranceTone } from '@/lib/assurance/domain'
import { buildTemplateItems, parseTemplateKind, publishProblems } from '@/lib/assurance/templateLifecycle'

// BrainBase Assurance — A0.1F template rules that need no database:
// section grouping, tolerant parsing of historical items, draft item
// building and server-side publish validation.

describe('sections', () => {
  it('groups consecutive items by heading, preserving order (null = no heading)', () => {
    const items = [
      { key: 'a', section: null }, { key: 'b', section: 'Access' }, { key: 'c', section: 'Access' }, { key: 'd', section: 'Fire' },
    ]
    expect(groupTemplateSections(items).map(g => [g.title, g.items.map(i => i.key)])).toEqual([
      [null, ['a']], ['Access', ['b', 'c']], ['Fire', ['d']],
    ])
    expect(groupTemplateSections([])).toEqual([])
  })
  it('historical (pre-A0.1F) items without a section still parse, with section null', () => {
    const legacy = [{ key: '01-x', label: 'X', responseType: 'PASS_FAIL', guidance: null, required: true, options: [] }]
    expect(parseChecklist(legacy).items[0]).toMatchObject({ key: '01-x', label: 'X', section: null })
    expect(parseCriteria([{ key: '01-y', label: 'Y', section: '  Records ' }]).items[0]).toMatchObject({ section: 'Records' })
  })
})

describe('vocabulary', () => {
  it('mirrors the A0.1F status CHECK and the two template kinds', () => {
    expect(TEMPLATE_VERSION_STATUSES).toEqual(['DRAFT', 'PUBLISHED', 'RETIRED'])
    expect(TEMPLATE_KINDS).toEqual(['inspection', 'audit'])
    expect([assuranceTone('DRAFT'), assuranceTone('PUBLISHED'), assuranceTone('RETIRED')]).toEqual(['warning', 'success', 'neutral'])
    expect(parseTemplateKind('audit')).toBe('audit')
    expect(() => parseTemplateKind('evaluation')).toThrow(/Template kind/)
  })
})

describe('draft items', () => {
  it('drafts may be empty or incomplete; labels are still required and keys are derived server-side', () => {
    expect(buildTemplateItems('inspection', undefined)).toEqual([])
    expect(buildTemplateItems('inspection', [])).toEqual([])
    const items = buildTemplateItems('inspection', [
      { label: 'Pick one', responseType: 'CHOICE', options: ['only'], section: 'S1', key: 'client-key-ignored' },
      { label: 'Notes', responseType: 'TEXT', options: ['dropped for non-choice'] },
    ])
    expect(items.map(i => [i.key, i.responseType, i.options, i.section])).toEqual([
      ['01-pick-one', 'CHOICE', ['only'], 'S1'], ['02-notes', 'TEXT', [], null],
    ])
    expect(() => buildTemplateItems('inspection', [{ label: '  ' }])).toThrow(/Checklist item 1/)
    expect(() => buildTemplateItems('audit', [{ label: 'x', responseType: 'PASS_FAIL' }])).toThrow(/Criterion 1 type/)
    expect(() => buildTemplateItems('audit', 'nope')).toThrow(/list/)
    expect(() => buildTemplateItems('inspection', Array.from({ length: 201 }, (_, i) => ({ label: `i${i}` })))).toThrow(/at most 200/)
  })
})

describe('publish validation', () => {
  const ok = buildTemplateItems('inspection', [{ label: 'A', section: 'S1' }, { label: 'B', section: 'S1' }, { label: 'C', section: 'S2' }])
  it('accepts a complete version', () => {
    expect(publishProblems('inspection', { title: 'v1', items: ok, invalidCount: 0 })).toEqual([])
  })
  it('rejects an empty, untitled, unreadable, ambiguous or split version', () => {
    expect(publishProblems('inspection', { title: 'v1', items: [], invalidCount: 0 })).toEqual(['Add at least one checklist item.'])
    expect(publishProblems('audit', { title: ' ', items: buildTemplateItems('audit', [{ label: 'x' }]), invalidCount: 1 })).toEqual([
      'Add a version title.', '1 criterion(s) cannot be read. Re-save the draft.',
    ])
    expect(publishProblems('inspection', { title: 'v', items: buildTemplateItems('inspection', [{ label: 'Same' }, { label: 'SAME ' }]), invalidCount: 0 }))
      .toEqual(['Checklist item 2 repeats the wording of an earlier checklist item.'])
    expect(publishProblems('inspection', { title: 'v', items: buildTemplateItems('inspection', [{ label: 'A', responseType: 'MULTI_CHOICE', options: ['x'] }]), invalidCount: 0 }))
      .toEqual(['Checklist item 1 needs at least two options.'])
    expect(publishProblems('inspection', { title: 'v', items: buildTemplateItems('inspection', [{ label: 'A', section: 'S1' }, { label: 'B', section: 'S2' }, { label: 'C', section: 'S1' }]), invalidCount: 0 }))
      .toEqual(['Section "S1" is split; keep its checklist items together.'])
  })
  it('allows unsectioned items before or after sections', () => {
    const mixed = buildTemplateItems('audit', [{ label: 'Intro' }, { label: 'A', section: 'S1' }, { label: 'Outro' }])
    expect(publishProblems('audit', { title: 'v', items: mixed, invalidCount: 0 })).toEqual([])
  })
})
