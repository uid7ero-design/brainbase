// Phase D.4.7F — pure keyboard-reorder arithmetic. No DB, no fetch, no
// React: this is the same category of module as reorderValidation.ts
// (dependency-free, real executed unit tests), deliberately kept separate
// from lib/organiser/reorderTransactions.ts, which owns the actual
// server-side mutation. This module only computes WHAT the new order
// would be for a single keyboard move — callers (app/organiser/page.tsx)
// feed the result into the exact same reorderGroups/reorderTopLevelItems/
// reorderSubitems functions pointer drag-and-drop already uses. It never
// calls them itself and has no knowledge of scope (group/board/parent) —
// that's the caller's responsibility, matching D.4.7E's own division of
// labour (this file mirrors resequenceOrganiserItemScope's own "caller
// supplies the scope" shape, one layer up, entirely client-side).

export type ReorderMove = 'up' | 'down' | 'first' | 'last';

/**
 * Returns the new ordered id list with `id` moved one step (`up`/`down`)
 * or to a boundary (`first`/`last`), or `null` when the move would not
 * change anything: `id` is not present in `ids`, or `id` is already at
 * the boundary the move targets (up-at-first, down-at-last, first-when-
 * already-first, last-when-already-last). Never mutates `ids`.
 */
export function moveInOrderedList(ids: string[], id: string, move: ReorderMove): string[] | null {
  const index = ids.indexOf(id);
  if (index === -1) return null;

  let targetIndex: number;
  switch (move) {
    case 'up':
      targetIndex = index - 1;
      break;
    case 'down':
      targetIndex = index + 1;
      break;
    case 'first':
      targetIndex = 0;
      break;
    case 'last':
      targetIndex = ids.length - 1;
      break;
  }

  if (targetIndex < 0 || targetIndex >= ids.length || targetIndex === index) return null;

  const without = ids.filter((_, i) => i !== index);
  // `without` has one fewer element than `ids`, so `targetIndex` (computed
  // against the ORIGINAL array) is already the correct insertion index
  // into `without` as-is for every reachable case: `up`/`down` move by one
  // adjacent slot, and `last`'s targetIndex (ids.length-1) equals
  // without.length exactly (a trailing append), same as `first`'s 0.
  return [...without.slice(0, targetIndex), id, ...without.slice(targetIndex)];
}
