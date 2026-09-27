import { describe, it, expect } from 'vitest'
import { validateExactPermutation } from '@/lib/organiser/reorderValidation'

// Phase D.4.7E (Slice E1) — validateExactPermutation is pure, dependency-
// free TypeScript (no React, no fetch, no DOM, no SQL), so — like
// coalescingMutationQueue.ts/notesAutosave.ts before it — it is proven with
// real executed calls rather than source-text containment. This is the
// documented reference lib/organiser/reorderTransactions.ts's own SQL is
// required to agree with; see that module's real-Postgres integration test
// (organiserReorderTransaction.integration.test.ts) for the proof that the
// two actually do agree, exercising the same scenarios against the real
// executable transaction primitive.

describe('validateExactPermutation', () => {
  it('accepts an exact permutation (different order, same membership)', () => {
    expect(validateExactPermutation(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual({ ok: true })
  })

  it('accepts the trivial empty/empty case', () => {
    expect(validateExactPermutation([], [])).toEqual({ ok: true })
  })

  it('accepts a single-item scope', () => {
    expect(validateExactPermutation(['a'], ['a'])).toEqual({ ok: true })
  })

  it('rejects a duplicate id in the requested list, even if the multiset "sums" to the right count', () => {
    expect(validateExactPermutation(['a', 'b'], ['a', 'a'])).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('rejects a requested id that is not in the authoritative scope at all ("extra")', () => {
    expect(validateExactPermutation(['a', 'b'], ['a', 'b', 'zzz'])).toEqual({ ok: false, reason: 'extra' })
  })

  it('rejects an authoritative id omitted from the requested list ("missing")', () => {
    expect(validateExactPermutation(['a', 'b', 'c'], ['a', 'b'])).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects when requested is shorter than authoritative for a reason other than a clean omission (empty requested against a non-empty scope)', () => {
    expect(validateExactPermutation(['a', 'b'], [])).toEqual({ ok: false, reason: 'missing' })
  })

  it('rejects when requested is longer than authoritative purely via a foreign id (count differs because of the extra, not a separate defect)', () => {
    expect(validateExactPermutation(['a'], ['a', 'b'])).toEqual({ ok: false, reason: 'extra' })
  })

  it('a duplicate takes precedence over an otherwise-also-foreign id in the same request', () => {
    expect(validateExactPermutation(['a', 'b'], ['a', 'a', 'zzz'])).toEqual({ ok: false, reason: 'duplicate' })
  })

  it('order alone is never a rejection reason — full reversal is accepted', () => {
    expect(validateExactPermutation(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a'])).toEqual({ ok: true })
  })

  it('count_mismatch is independently load-bearing: a duplicated id in authoritativeIds (never expected from a real DB primary-key SELECT, but not assumed away by this pure function) is caught even though no_duplicates/no_foreign/no_missing would all otherwise pass', () => {
    expect(validateExactPermutation(['a', 'a'], ['a'])).toEqual({ ok: false, reason: 'count_mismatch' })
  })
})
