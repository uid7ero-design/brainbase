import { describe, it, expect } from 'vitest'
import { moveInOrderedList } from '@/lib/organiser/keyboardReorder'

// Phase D.4.7F — moveInOrderedList is pure, dependency-free TypeScript, so
// (like reorderValidation.ts's validateExactPermutation before it) it is
// proven with real executed calls rather than source-text containment.
// This module only computes the NEW order for a single keyboard move; it
// has no knowledge of the server, of React, or of which reorder function
// (reorderGroups/reorderTopLevelItems/reorderSubitems) a caller will feed
// its result into — those integration points are proven separately in the
// organiser*ReorderUi.test.ts files.

describe('moveInOrderedList', () => {
  it('moves an item earlier by one position', () => {
    expect(moveInOrderedList(['a', 'b', 'c', 'd'], 'c', 'up')).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves an item later by one position', () => {
    expect(moveInOrderedList(['a', 'b', 'c', 'd'], 'b', 'down')).toEqual(['a', 'c', 'b', 'd'])
  })

  it('moves an item to the front with "first"', () => {
    expect(moveInOrderedList(['a', 'b', 'c', 'd'], 'd', 'first')).toEqual(['d', 'a', 'b', 'c'])
  })

  it('moves an item to the end with "last"', () => {
    expect(moveInOrderedList(['a', 'b', 'c', 'd'], 'a', 'last')).toEqual(['b', 'c', 'd', 'a'])
  })

  it('"down" on the second-to-last item appends it after the last item', () => {
    expect(moveInOrderedList(['a', 'b', 'c', 'd'], 'c', 'down')).toEqual(['a', 'b', 'd', 'c'])
  })

  it('returns null for "up" when already first (boundary no-op)', () => {
    expect(moveInOrderedList(['a', 'b', 'c'], 'a', 'up')).toBeNull()
  })

  it('returns null for "down" when already last (boundary no-op)', () => {
    expect(moveInOrderedList(['a', 'b', 'c'], 'c', 'down')).toBeNull()
  })

  it('returns null for "first" when already first (boundary no-op)', () => {
    expect(moveInOrderedList(['a', 'b', 'c'], 'a', 'first')).toBeNull()
  })

  it('returns null for "last" when already last (boundary no-op)', () => {
    expect(moveInOrderedList(['a', 'b', 'c'], 'c', 'last')).toBeNull()
  })

  it('returns null when the id is not present in the list', () => {
    expect(moveInOrderedList(['a', 'b', 'c'], 'zzz', 'up')).toBeNull()
  })

  it('returns null for every move on a single-item list', () => {
    expect(moveInOrderedList(['a'], 'a', 'up')).toBeNull()
    expect(moveInOrderedList(['a'], 'a', 'down')).toBeNull()
    expect(moveInOrderedList(['a'], 'a', 'first')).toBeNull()
    expect(moveInOrderedList(['a'], 'a', 'last')).toBeNull()
  })

  it('returns null (not a throw) for an empty list', () => {
    expect(moveInOrderedList([], 'a', 'up')).toBeNull()
    expect(moveInOrderedList([], 'a', 'last')).toBeNull()
  })

  it('never mutates the input array', () => {
    const ids = ['a', 'b', 'c']
    const copy = [...ids]
    moveInOrderedList(ids, 'a', 'down')
    expect(ids).toEqual(copy)
  })
})
