// Phase D.4.7E (Slice E1) — pure, dependency-free specification of what an
// "exact permutation" means for an Organiser reorder request: the client's
// requested id list must contain every id currently in the authoritative
// scope, each exactly once, and nothing else. No React, no DOM, no fetch,
// no DB — exercised with real execution in
// tests/containment/organiserReorderValidation.test.ts, the same category
// as lib/organiser/coalescingMutationQueue.ts / notesAutosave.ts.
//
// IMPORTANT — this function is NOT itself the enforcement mechanism for any
// reorder mutation. It cannot be: the authoritative scope only exists once
// the relevant rows are locked (FOR UPDATE) inside a transaction, and this
// module has no database access at all. Its role is narrower and more
// honest than that:
//   1. It is the single documented reference for what "exact permutation"
//      means, unit-tested directly and independently of any SQL.
//   2. lib/organiser/reorderTransactions.ts's executable SQL re-implements
//      the SAME four conditions (no_duplicates / no_foreign / no_missing /
//      count_matches) inside the locked transaction, where they are
//      actually load-bearing. The two are proven to agree by exercising the
//      same scenarios against both: this file's own unit tests, and
//      reorderTransactions.ts's real-Postgres integration tests.
// A caller must never treat a green result from this function as
// authorization to write anything — only the transaction primitive's own
// SQL-side validation (run against genuinely locked rows) may gate a write.
export type ExactPermutationResult =
  | { ok: true }
  | { ok: false; reason: 'duplicate' | 'missing' | 'extra' | 'count_mismatch' };

/**
 * Checks whether `requestedIds` is an exact permutation of
 * `authoritativeIds` — same elements, each exactly once, nothing else.
 * Order is never checked here (order is exactly what the caller is trying
 * to CHANGE); only set membership and multiplicity are.
 *
 * Reason precedence when a request fails multiple conditions at once
 * (e.g. it is both too short AND contains an id not in the authoritative
 * set): 'duplicate' is checked first (it's a property of the request
 * alone, independent of the authoritative set), then 'extra' (a foreign id
 * present), then 'missing' (an authoritative id absent), then
 * 'count_mismatch' as a final structural fallback that should be
 * unreachable if the first three all pass — kept as defense in depth, not
 * the primary signal.
 */
export function validateExactPermutation(
  authoritativeIds: readonly string[],
  requestedIds: readonly string[],
): ExactPermutationResult {
  const requestedSet = new Set(requestedIds);
  if (requestedSet.size !== requestedIds.length) {
    return { ok: false, reason: 'duplicate' };
  }

  const authoritativeSet = new Set(authoritativeIds);
  for (const id of requestedIds) {
    if (!authoritativeSet.has(id)) {
      return { ok: false, reason: 'extra' };
    }
  }
  for (const id of authoritativeIds) {
    if (!requestedSet.has(id)) {
      return { ok: false, reason: 'missing' };
    }
  }

  if (requestedIds.length !== authoritativeIds.length) {
    return { ok: false, reason: 'count_mismatch' };
  }

  return { ok: true };
}
