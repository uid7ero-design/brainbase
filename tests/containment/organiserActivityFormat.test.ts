import { describe, it, expect } from 'vitest'
import { formatFieldLabel, formatFieldValue, describeActivityEvent } from '@/lib/organiser/activityFormat'

// Phase D.4.5D — lib/organiser/activityFormat.ts is pure and framework-free,
// so unlike most of this repo's UI-adjacent suites (no jsdom/React Testing
// Library — see AGENTS.md/CLAUDE.md), this file exercises the REAL
// exported functions directly with real assertions, the same convention
// already established by tests/containment/organiserActivitySanitisationParity.test.ts
// for lib/organiser/activity.ts.

describe('formatFieldLabel — known/unknown field mapping', () => {
  it('maps every documented field key to its user-friendly label', () => {
    expect(formatFieldLabel('name')).toBe('Name')
    expect(formatFieldLabel('status')).toBe('Status')
    expect(formatFieldLabel('priority')).toBe('Priority')
    expect(formatFieldLabel('owner')).toBe('Owner')
    expect(formatFieldLabel('due_date')).toBe('Due date')
    expect(formatFieldLabel('group_id')).toBe('Group')
    expect(formatFieldLabel('parent_item_id')).toBe('Parent item')
    expect(formatFieldLabel('notes')).toBe('Notes')
    expect(formatFieldLabel('custom_values')).toBe('Custom fields')
  })

  it('an unknown key gets a safe title-cased fallback, never hidden or shown raw', () => {
    expect(formatFieldLabel('widget_count')).toBe('Widget Count')
    expect(formatFieldLabel('foo')).toBe('Foo')
  })
})

describe('formatFieldValue — safe rendering of every value shape', () => {
  it('null and undefined render as "None"', () => {
    expect(formatFieldValue(null)).toBe('None')
    expect(formatFieldValue(undefined)).toBe('None')
  })

  it('empty string renders distinctly from null', () => {
    expect(formatFieldValue('')).toBe('(empty)')
    expect(formatFieldValue('')).not.toBe(formatFieldValue(null))
  })

  it('booleans render as Yes/No, not "true"/"false"', () => {
    expect(formatFieldValue(true)).toBe('Yes')
    expect(formatFieldValue(false)).toBe('No')
  })

  it('a non-empty string renders unchanged', () => {
    expect(formatFieldValue('Working on it')).toBe('Working on it')
  })

  it('numbers render via String()', () => {
    expect(formatFieldValue(42)).toBe('42')
    expect(formatFieldValue(0)).toBe('0')
  })

  it('dates (stored as ISO strings) render unchanged, not re-parsed', () => {
    expect(formatFieldValue('2026-09-16')).toBe('2026-09-16')
  })

  it('an empty array/object renders as "(empty)", never blank', () => {
    expect(formatFieldValue([])).toBe('(empty)')
    expect(formatFieldValue({})).toBe('(empty)')
  })

  it('a non-empty array renders as a concise joined summary, not raw JSON', () => {
    expect(formatFieldValue(['a', 'b'])).toBe('a, b')
  })

  it('a plain object (e.g. one changed custom_values entry) renders as a concise key: value summary, never dumped as raw JSON', () => {
    const rendered = formatFieldValue({ colour: 'red', size: 'L' })
    expect(rendered).toBe('colour: red, size: L')
    expect(rendered).not.toMatch(/[{}"]/)
  })
})

describe('describeActivityEvent — item.created', () => {
  it('renders a concise summary and optional initial status/group, no arrow (before is null)', () => {
    const desc = describeActivityEvent({
      event_type: 'item.created',
      actor: { name: 'Admin' },
      before: null,
      after: { name: 'Widget', status: 'Not Started', group_id: 'g1', parent_item_id: null },
    }, { g1: 'Test' })
    expect(desc.summary).toBe('Admin created this item')
    expect(desc.diffs).toEqual([
      { label: 'Status', before: null, after: 'Not Started' },
      { label: 'Group', before: null, after: 'Test' },
    ])
  })

  it('is not visually noisy — name/parent_item_id are never surfaced as created-event diffs', () => {
    const desc = describeActivityEvent({
      event_type: 'item.created',
      actor: { name: 'Admin' },
      before: null,
      after: { name: 'Widget', status: 'Not Started', group_id: null, parent_item_id: null },
    })
    expect(desc.diffs.map(d => d.label)).toEqual(['Status', 'Group'])
  })

  it('falls back to "Someone" when actor.name is empty', () => {
    const desc = describeActivityEvent({ event_type: 'item.created', actor: { name: '' }, before: null, after: {} })
    expect(desc.summary).toBe('Someone created this item')
  })
})

describe('describeActivityEvent — item.updated', () => {
  it('renders each meaningful diff with a before -> after arrow', () => {
    const desc = describeActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      before: { status: 'Not Started' },
      after: { status: 'Working on it' },
    })
    expect(desc.summary).toBe('Admin updated this item')
    expect(desc.diffs).toEqual([{ label: 'Status', before: 'Not Started', after: 'Working on it' }])
  })

  it('multiple meaningful fields changed in one event render under that one event, not as separate synthetic events', () => {
    const desc = describeActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      before: { status: 'Not Started', priority: null },
      after: { status: 'Working on it', priority: 'High' },
    })
    expect(desc.diffs).toHaveLength(2)
    expect(desc.diffs).toEqual(expect.arrayContaining([
      { label: 'Status', before: 'Not Started', after: 'Working on it' },
      { label: 'Priority', before: 'None', after: 'High' },
    ]))
  })

  it('expands custom_values into individual labelled rows rather than one raw nested row', () => {
    const desc = describeActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      before: { custom_values: { budget: '100' } },
      after: { custom_values: { budget: '200' } },
    })
    expect(desc.diffs).toEqual([{ label: 'Budget', before: '100', after: '200' }])
  })
})

describe('describeActivityEvent — item.moved', () => {
  it('primary label is "moved this item", Group diff resolves group_id snapshots to names', () => {
    const desc = describeActivityEvent({
      event_type: 'item.moved',
      actor: { name: 'Admin' },
      before: { group_id: 'g1' },
      after: { group_id: 'g2' },
    }, { g1: 'Test', g2: 'Test 222' })
    expect(desc.summary).toBe('Admin moved this item')
    expect(desc.diffs).toEqual([{ label: 'Group', before: 'Test', after: 'Test 222' }])
  })

  it('a group_id absent from the supplied name map falls back to "Another group" — never a raw id, never fabricated', () => {
    const desc = describeActivityEvent({
      event_type: 'item.moved',
      actor: { name: 'Admin' },
      before: { group_id: 'g1' },
      after: { group_id: 'deleted-group-id' },
    }, { g1: 'Test' })
    expect(desc.diffs[0].after).toBe('Another group')
  })

  it('a null group_id renders as "No group", distinct from "Another group"', () => {
    const desc = describeActivityEvent({
      event_type: 'item.moved',
      actor: { name: 'Admin' },
      before: { group_id: null },
      after: { group_id: 'g1' },
    }, { g1: 'Test' })
    expect(desc.diffs[0].before).toBe('No group')
  })

  it('a move combined with another field change in the same event shows all meaningful diffs together', () => {
    const desc = describeActivityEvent({
      event_type: 'item.moved',
      actor: { name: 'Admin' },
      before: { group_id: 'g1', status: 'Not Started' },
      after: { group_id: 'g2', status: 'Working on it' },
    }, { g1: 'Test', g2: 'Test 222' })
    expect(desc.diffs).toHaveLength(2)
    expect(desc.diffs).toEqual(expect.arrayContaining([
      { label: 'Group', before: 'Test', after: 'Test 222' },
      { label: 'Status', before: 'Not Started', after: 'Working on it' },
    ]))
  })
})

describe('describeActivityEvent — item.deleted', () => {
  it('renders a concise summary with no diffs', () => {
    const desc = describeActivityEvent({
      event_type: 'item.deleted',
      actor: { name: 'Admin' },
      before: { name: 'Widget', status: 'Done', group_id: 'g1', parent_item_id: null },
      after: null,
    })
    expect(desc.summary).toBe('Admin deleted this item')
    expect(desc.diffs).toEqual([])
  })
})

describe('describeActivityEvent — unknown/future event type never crashes', () => {
  it('degrades to a generic, still-useful summary plus a best-effort diff rendering', () => {
    const desc = describeActivityEvent({
      event_type: 'item.archived',
      actor: { name: 'Admin' },
      before: { status: 'Done' },
      after: { status: 'Archived' },
    })
    expect(desc.summary).toBe('Admin — item.archived')
    expect(desc.diffs).toEqual([{ label: 'Status', before: 'Done', after: 'Archived' }])
  })

  it('an empty event_type never produces an empty/blank summary', () => {
    const desc = describeActivityEvent({ event_type: '', actor: { name: 'Admin' }, before: null, after: null })
    expect(desc.summary.length).toBeGreaterThan(0)
    expect(desc.summary).toBe('Admin — activity')
  })

  it('never throws for null before/after on an unknown event type', () => {
    expect(() => describeActivityEvent({ event_type: 'mystery.event', actor: { name: 'Admin' }, before: null, after: null })).not.toThrow()
  })
})
