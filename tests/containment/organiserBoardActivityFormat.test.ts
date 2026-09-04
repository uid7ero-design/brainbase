import { describe, it, expect } from 'vitest'
import { resolveItemLabel, describeBoardActivityEvent, describeActivityEvent } from '@/lib/organiser/activityFormat'

// Phase D.4.5E — resolveItemLabel and describeBoardActivityEvent, the
// board-feed additions to lib/organiser/activityFormat.ts. Pure and
// framework-free, so — same convention as
// tests/containment/organiserActivityFormat.test.ts (D.4.5D) — this file
// exercises the real exported functions directly with real assertions.

describe('resolveItemLabel — resolves via the specified priority order', () => {
  it('1. prefers after.name when present', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: { name: 'Old name' }, after: { name: 'New name' } })
    expect(label).toBe('New name')
  })

  it('2. falls back to before.name when after has none (covers item.deleted, whose after is null)', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: { name: 'Old task' }, after: null })
    expect(label).toBe('Old task')
  })

  it('2b. falls back to before.name when after exists but does not carry name (e.g. a status-only item.updated diff)', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: { name: 'Complete this' }, after: { status: 'Working on it' } })
    expect(label).toBe('Complete this')
  })

  it('3. falls back to the live item name when neither before nor after carries one', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: { status: 'Done' }, after: { status: 'Archived' } }, { i1: 'Live Name' })
    expect(label).toBe('Live Name')
  })

  it('4. falls back to "Item" when nothing is available — never throws, never blank', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: null, after: null })
    expect(label).toBe('Item')
  })

  it('an empty-string name is treated as absent, not used verbatim', () => {
    const label = resolveItemLabel({ entity_id: 'i1', before: { name: '' }, after: null }, { i1: 'Live Name' })
    expect(label).toBe('Live Name')
  })

  it('never requires a live lookup — omitting liveItemNamesById entirely still resolves via before/after or the generic fallback', () => {
    expect(resolveItemLabel({ entity_id: 'i1', before: { name: 'X' }, after: null })).toBe('X')
    expect(resolveItemLabel({ entity_id: 'i1', before: null, after: null })).toBe('Item')
  })
})

describe('describeBoardActivityEvent — summaries always name the affected item', () => {
  it('item.created names the item, matching the "Admin created "X"" example shape', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.created',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: null,
      after: { name: 'Test item', status: 'Not Started', parent_item_id: null },
    })
    expect(desc.summary).toBe('Admin created "Test item"')
    expect(desc.diffs).toEqual([{ label: 'Status', before: null, after: 'Not Started' }])
  })

  it('item.updated names the item and shows the diff', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: { status: 'Not Started' },
      after: { status: 'Working on it' },
    }, {}, { i1: 'Complete this' })
    expect(desc.summary).toBe('Admin updated "Complete this"')
    expect(desc.diffs).toEqual([{ label: 'Status', before: 'Not Started', after: 'Working on it' }])
  })

  it('item.moved names the item (via the live-name fallback, since a real move event\'s before/after carry only group_id/parent_item_id — never name, which did not change) and resolves the group diff', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.moved',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: { group_id: 'g1' },
      after: { group_id: 'g2' },
    }, { g1: 'Test', g2: 'Test 222' }, { i1: 'Follow up supplier' })
    expect(desc.summary).toBe('Admin moved "Follow up supplier"')
    expect(desc.diffs).toEqual([{ label: 'Group', before: 'Test', after: 'Test 222' }])
  })

  it('item.deleted names the item via its before snapshot, with no diffs', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.deleted',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: { name: 'Old task', status: 'Done', group_id: 'g1', parent_item_id: null },
      after: null,
    })
    expect(desc.summary).toBe('Admin deleted "Old task"')
    expect(desc.diffs).toEqual([])
  })

  it('falls back to the live item name when the diff itself carries no name (e.g. a pure status-only update where name is unchanged and therefore absent from both before and after)', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: { priority: null },
      after: { priority: 'High' },
    }, {}, { i1: 'Renamed later' })
    expect(desc.summary).toBe('Admin updated "Renamed later"')
  })

  it('falls back to "Item" when no name is resolvable anywhere — never throws, never renders blank', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.updated',
      actor: { name: 'Admin' },
      entity_id: 'unknown-item',
      before: { priority: null },
      after: { priority: 'High' },
    })
    expect(desc.summary).toBe('Admin updated "Item"')
  })

  it('unknown/future event type never crashes and still names the item', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.archived',
      actor: { name: 'Admin' },
      entity_id: 'i1',
      before: { name: 'Something' },
      after: null,
    })
    expect(desc.summary).toBe('Admin — item.archived on "Something"')
  })

  it('falls back to "Someone" when actor.name is empty, same as the single-item variant', () => {
    const desc = describeBoardActivityEvent({ event_type: 'item.created', actor: { name: '' }, entity_id: 'i1', before: null, after: { name: 'X' } })
    expect(desc.summary).toBe('Someone created "X"')
  })
})

describe('Regression — describeActivityEvent (D.4.5D, single-item) is unchanged by the D.4.5E refactor', () => {
  it('summaries still use "this item", never a quoted name, for the single-item Activity tab', () => {
    expect(describeActivityEvent({ event_type: 'item.created', actor: { name: 'Admin' }, before: null, after: { status: 'Not Started' } }).summary)
      .toBe('Admin created this item')
    expect(describeActivityEvent({ event_type: 'item.updated', actor: { name: 'Admin' }, before: { status: 'A' }, after: { status: 'B' } }).summary)
      .toBe('Admin updated this item')
    expect(describeActivityEvent({ event_type: 'item.moved', actor: { name: 'Admin' }, before: { group_id: null }, after: { group_id: null } }).summary)
      .toBe('Admin moved this item')
    expect(describeActivityEvent({ event_type: 'item.deleted', actor: { name: 'Admin' }, before: null, after: null }).summary)
      .toBe('Admin deleted this item')
    expect(describeActivityEvent({ event_type: 'mystery.event', actor: { name: 'Admin' }, before: null, after: null }).summary)
      .toBe('Admin — mystery.event')
  })
})
