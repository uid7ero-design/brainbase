import { describe, it, expect } from 'vitest'
import { describeActivityEvent, describeBoardActivityEvent } from '@/lib/organiser/activityFormat'

// Phase D.4.5F — formatter coverage for the 9 newly-instrumented event
// types: board.created/updated/deleted, group.created/updated/deleted,
// comment.created, file.added/file.deleted. Real function calls, same
// convention as organiserActivityFormat.test.ts /
// organiserBoardActivityFormat.test.ts.

describe('describeBoardActivityEvent — board.*', () => {
  it('board.created', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'board.created', actor: { name: 'Admin' }, entity_id: 'board-1',
      before: null, after: { name: 'WORK' },
    })
    expect(desc.summary).toBe('Admin created board "WORK"')
    expect(desc.diffs).toEqual([])
  })

  it('board.updated (rename) shows a Name diff and a "renamed board" summary', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'board.updated', actor: { name: 'Admin' }, entity_id: 'board-1',
      before: { name: 'WORK' }, after: { name: 'Operations' },
    })
    expect(desc.summary).toBe('Admin renamed board')
    expect(desc.diffs).toEqual([{ label: 'Name', before: 'WORK', after: 'Operations' }])
  })

  it('board.updated (color only) does not claim a rename', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'board.updated', actor: { name: 'Admin' }, entity_id: 'board-1',
      before: { color: 'blue' }, after: { color: 'red' },
    })
    expect(desc.summary).toBe('Admin updated board')
    expect(desc.diffs).toEqual([{ label: 'Color', before: 'blue', after: 'red' }])
  })

  it('board.deleted names the board via its before snapshot, no diffs', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'board.deleted', actor: { name: 'Admin' }, entity_id: 'board-1',
      before: { name: 'WORK' }, after: null,
    })
    expect(desc.summary).toBe('Admin deleted board "WORK"')
    expect(desc.diffs).toEqual([])
  })

  it('falls back to "Someone" and a generic noun when actor/name are missing', () => {
    const created = describeBoardActivityEvent({ event_type: 'board.created', actor: { name: '' }, entity_id: 'b1', before: null, after: {} })
    expect(created.summary).toBe('Someone created board "board"')
    const deleted = describeBoardActivityEvent({ event_type: 'board.deleted', actor: { name: '' }, entity_id: 'b1', before: null, after: null })
    expect(deleted.summary).toBe('Someone deleted board "board"')
  })
})

describe('describeBoardActivityEvent — group.*', () => {
  it('group.created', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'group.created', actor: { name: 'Admin' }, entity_id: 'group-1',
      before: null, after: { name: 'Backlog' },
    })
    expect(desc.summary).toBe('Admin created group "Backlog"')
    expect(desc.diffs).toEqual([])
  })

  it('group.updated (rename)', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'group.updated', actor: { name: 'Admin' }, entity_id: 'group-1',
      before: { name: 'Backlog' }, after: { name: 'In Progress' },
    })
    expect(desc.summary).toBe('Admin renamed group')
    expect(desc.diffs).toEqual([{ label: 'Name', before: 'Backlog', after: 'In Progress' }])
  })

  it('group.deleted names the group via its before snapshot even though the row (and any affected items\' group_id) is gone', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'group.deleted', actor: { name: 'Admin' }, entity_id: 'group-1',
      before: { name: 'Old Tasks' }, after: null,
    })
    expect(desc.summary).toBe('Admin deleted group "Old Tasks"')
    expect(desc.diffs).toEqual([])
  })
})

describe('describeBoardActivityEvent/describeActivityEvent — comment.created', () => {
  it('board feed: names the item and shows the excerpt as `detail`, not a diff row', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'comment.created', actor: { name: 'Admin' }, entity_id: 'item-1',
      before: null, after: { excerpt: 'Waiting on supplier confirmation' },
    }, {}, { 'item-1': 'Supplier follow-up' })
    expect(desc.summary).toBe('Admin commented on "Supplier follow-up"')
    expect(desc.diffs).toEqual([])
    expect(desc.detail).toBe('Waiting on supplier confirmation')
  })

  it('item tab: no item name in the summary', () => {
    const desc = describeActivityEvent({
      event_type: 'comment.created', actor: { name: 'Admin' },
      before: null, after: { excerpt: 'Waiting on supplier confirmation' },
    })
    expect(desc.summary).toBe('Admin commented')
    expect(desc.detail).toBe('Waiting on supplier confirmation')
  })

  it('a missing/empty excerpt renders no detail line rather than an empty quoted string', () => {
    const desc = describeActivityEvent({ event_type: 'comment.created', actor: { name: 'Admin' }, before: null, after: {} })
    expect(desc.detail).toBeNull()
  })

  it('an already-sanitised (truncated) excerpt passes through unchanged — this function never re-truncates', () => {
    const truncated = `${'x'.repeat(200)}…(truncated)`
    const desc = describeActivityEvent({ event_type: 'comment.created', actor: { name: 'Admin' }, before: null, after: { excerpt: truncated } })
    expect(desc.detail).toBe(truncated)
  })
})

describe('describeBoardActivityEvent/describeActivityEvent — file.added / file.deleted', () => {
  it('file.added (board feed): names the file and the item', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'file.added', actor: { name: 'Admin' }, entity_id: 'item-1',
      before: null, after: { file_name: 'invoice.pdf', file_size: 1024 },
    }, {}, { 'item-1': 'Supplier follow-up' })
    expect(desc.summary).toBe('Admin attached "invoice.pdf" to "Supplier follow-up"')
    expect(desc.diffs).toEqual([])
  })

  it('file.added (item tab): no item name in the summary', () => {
    const desc = describeActivityEvent({
      event_type: 'file.added', actor: { name: 'Admin' },
      before: null, after: { file_name: 'invoice.pdf', file_size: 1024 },
    })
    expect(desc.summary).toBe('Admin attached "invoice.pdf"')
  })

  it('file.deleted (board feed): names the file from its before snapshot (the file row is gone) and the item', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'file.deleted', actor: { name: 'Admin' }, entity_id: 'item-1',
      before: { file_name: 'draft.xlsx' }, after: null,
    }, {}, { 'item-1': 'Supplier follow-up' })
    expect(desc.summary).toBe('Admin removed "draft.xlsx" from "Supplier follow-up"')
  })

  it('file.deleted (item tab)', () => {
    const desc = describeActivityEvent({
      event_type: 'file.deleted', actor: { name: 'Admin' },
      before: { file_name: 'old-plan.xlsx' }, after: null,
    })
    expect(desc.summary).toBe('Admin removed "old-plan.xlsx"')
  })

  it('a missing file_name falls back to "a file" rather than crashing or rendering blank', () => {
    const desc = describeActivityEvent({ event_type: 'file.added', actor: { name: 'Admin' }, before: null, after: {} })
    expect(desc.summary).toBe('Admin attached "a file"')
  })
})

describe('describeEntityEventInternal — unknown board.*/group.* subtype never crashes', () => {
  it('an unrecognised board.* subtype degrades gracefully instead of throwing or rendering blank', () => {
    expect(() => describeBoardActivityEvent({ event_type: 'board.archived', actor: { name: 'Admin' }, entity_id: 'board-1', before: null, after: null })).not.toThrow()
    const desc = describeBoardActivityEvent({ event_type: 'board.archived', actor: { name: 'Admin' }, entity_id: 'board-1', before: null, after: null })
    expect(desc.summary.length).toBeGreaterThan(0)
  })

  it('an unrecognised group.* subtype degrades gracefully', () => {
    const desc = describeBoardActivityEvent({ event_type: 'group.archived', actor: { name: 'Admin' }, entity_id: 'group-1', before: null, after: null })
    expect(desc.summary.length).toBeGreaterThan(0)
  })
})

describe('Board/group events never leak into the item-tab formatter\'s normal event types', () => {
  it('describeActivityEvent never receives board.*/group.* in real usage (item_id is never set on those rows), but if it somehow did, it still degrades gracefully via the generic fallback rather than crashing', () => {
    expect(() => describeActivityEvent({ event_type: 'board.created', actor: { name: 'Admin' }, before: null, after: { name: 'X' } })).not.toThrow()
  })
})

describe('Regression — item.created/updated/moved/deleted formatting unchanged by D.4.5F', () => {
  it('board feed still renders item events exactly as in D.4.5E', () => {
    const desc = describeBoardActivityEvent({
      event_type: 'item.updated', actor: { name: 'Admin' }, entity_id: 'item-1',
      before: { status: 'Not Started' }, after: { status: 'Working on it' },
    }, {}, { 'item-1': 'Complete this' })
    expect(desc.summary).toBe('Admin updated "Complete this"')
    expect(desc.diffs).toEqual([{ label: 'Status', before: 'Not Started', after: 'Working on it' }])
  })

  it('item tab still renders item events exactly as in D.4.5D', () => {
    const desc = describeActivityEvent({ event_type: 'item.created', actor: { name: 'Admin' }, before: null, after: { status: 'Not Started' } })
    expect(desc.summary).toBe('Admin created this item')
  })
})
