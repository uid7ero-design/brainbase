import { describe, it, expect, vi } from 'vitest'
import { enqueueCoalesced, type CoalescingQueueMap } from '@/lib/organiser/coalescingMutationQueue'

// D.4.7B-R1 — this module is pure, dependency-free TypeScript (no React,
// no fetch, no DOM), so unlike the rest of app/organiser/page.tsx's own
// static-source-text-containment tests (this repo's only option for a
// React page with no jsdom harness — see AGENTS.md/CLAUDE.md), THIS
// primitive can and must be proven with real executed async/await and
// controllable promise timing — exactly what the phase's own spec asked
// for rather than "pretending source-text assertions prove concurrency."

// A controllable, externally-resolvable promise for deterministically
// simulating "the first request is still in flight" without real timers.
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('enqueueCoalesced — at most one run() in flight per key (A, B, C)', () => {
  it('does not start a second concurrent run() for the same key while one is in flight — the second value is coalesced, not dispatched immediately', async () => {
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    let concurrentRunCount = 0
    let maxConcurrent = 0
    const seen: string[] = []

    const run = vi.fn(async (value: string) => {
      concurrentRunCount++
      maxConcurrent = Math.max(maxConcurrent, concurrentRunCount)
      seen.push(value)
      if (value === 'B') await first.promise
      concurrentRunCount--
    })

    const p1 = enqueueCoalesced(map, 'k', 'B', run)
    // B's run() has started (synchronously up to its first await) but not
    // yet settled. Submitting C now must NOT start a second overlapping run.
    const p2 = enqueueCoalesced(map, 'k', 'C', run)

    expect(maxConcurrent).toBe(1)
    expect(run).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['B'])

    first.resolve()
    await Promise.all([p1, p2])

    expect(maxConcurrent).toBe(1) // never more than one in flight, ever
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('sends the coalesced value only after the in-flight run settles (B), not before (B)', async () => {
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    const order: string[] = []

    const run = vi.fn(async (value: string) => {
      order.push(`start:${value}`)
      if (value === 'B') await first.promise
      order.push(`end:${value}`)
    })

    const p1 = enqueueCoalesced(map, 'k', 'B', run)
    const p2 = enqueueCoalesced(map, 'k', 'C', run)

    // C must not have started yet — B hasn't settled.
    expect(order).toEqual(['start:B'])

    first.resolve()
    await Promise.all([p1, p2])

    expect(order).toEqual(['start:B', 'end:B', 'start:C', 'end:C'])
  })

  it('the final value processed is the latest submitted one, and the queue ends idle (not in flight)', async () => {
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    const seen: string[] = []

    await Promise.all([
      enqueueCoalesced(map, 'k', 'B', async (v) => { seen.push(v); if (v === 'B') await first.promise }),
      enqueueCoalesced(map, 'k', 'C', async (v) => { seen.push(v) }),
      (async () => { first.resolve() })(),
    ])

    expect(seen).toEqual(['B', 'C'])
    expect(map['k'].inFlight).toBe(false)
    expect(map['k'].pending).toBe(null)
  })

  it('a THIRD value submitted while the first is still in flight replaces the second (never queues more than one pending)', async () => {
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    const seen: string[] = []

    const run = async (v: string) => { seen.push(v); if (v === 'B') await first.promise }
    const p1 = enqueueCoalesced(map, 'k', 'B', run)
    enqueueCoalesced(map, 'k', 'C', run) // superseded before it ever runs
    const p3 = enqueueCoalesced(map, 'k', 'D', run)

    expect(map['k'].pending).toBe('D')
    first.resolve()
    await Promise.all([p1, p3])

    expect(seen).toEqual(['B', 'D']) // C was replaced, never run at all
  })
})

describe('enqueueCoalesced — hasNewerPending() signal (D, E, F support)', () => {
  it('reports hasNewerPending() === true for an attempt while a newer value is already queued behind it', async () => {
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    let sawPendingDuringB: boolean | null = null

    const p1 = enqueueCoalesced(map, 'k', 'B', async (v, hasNewerPending) => {
      if (v === 'B') {
        await first.promise
        sawPendingDuringB = hasNewerPending()
      }
    })
    const p2 = enqueueCoalesced(map, 'k', 'C', async () => {})

    first.resolve()
    await Promise.all([p1, p2])

    expect(sawPendingDuringB).toBe(true)
  })

  it('reports hasNewerPending() === false for the last attempt in a chain — nothing is queued behind it', async () => {
    const map: CoalescingQueueMap<string> = {}
    let sawPendingForOnly: boolean | null = null

    await enqueueCoalesced(map, 'k', 'B', async (_v, hasNewerPending) => {
      sawPendingForOnly = hasNewerPending()
    })

    expect(sawPendingForOnly).toBe(false)
  })

  it('a failed run() for an earlier value still allows a queued later value to run next (E)', async () => {
    // The run() FUNCTION is fixed for the whole chain (established by
    // whichever call starts it) — only the VALUE varies per coalesced
    // step, exactly like updateItem's own single closure deciding success
    // per-value via its own fetch call. This run simulates B failing and
    // C succeeding based on the value it's given.
    const map: CoalescingQueueMap<string> = {}
    const first = deferred<void>()
    const seen: { value: string; ok: boolean }[] = []

    const run = async (v: string) => {
      if (v === 'B') await first.promise
      seen.push({ value: v, ok: v !== 'B' }) // B fails, everything else succeeds
    }

    const p1 = enqueueCoalesced(map, 'k', 'B', run)
    const p2 = enqueueCoalesced(map, 'k', 'C', run)

    first.resolve()
    await Promise.all([p1, p2])

    expect(seen).toEqual([{ value: 'B', ok: false }, { value: 'C', ok: true }])
  })
})

describe('enqueueCoalesced — independent keys never block each other (G, H)', () => {
  it('two different keys run concurrently without waiting on each other', async () => {
    const map: CoalescingQueueMap<string> = {}
    const firstA = deferred<void>()
    const order: string[] = []

    const pA = enqueueCoalesced(map, 'item:1:status', 'A-value', async () => {
      order.push('A-start')
      await firstA.promise
      order.push('A-end')
    })
    const pB = enqueueCoalesced(map, 'item:2:status', 'B-value', async () => {
      // A different item entirely — must run immediately, not wait for A.
      order.push('B-start-and-end')
    })

    await pB
    expect(order).toEqual(['A-start', 'B-start-and-end'])
    firstA.resolve()
    await pA
    expect(order).toEqual(['A-start', 'B-start-and-end', 'A-end'])
  })

  it('two different fields on the SAME item never block each other', async () => {
    const map: CoalescingQueueMap<string> = {}
    const firstStatus = deferred<void>()
    const order: string[] = []

    const pStatus = enqueueCoalesced(map, 'item:1:status', 'Done', async () => {
      order.push('status-start')
      await firstStatus.promise
      order.push('status-end')
    })
    const pPriority = enqueueCoalesced(map, 'item:1:priority', 'High', async () => {
      order.push('priority-start-and-end')
    })

    await pPriority
    expect(order).toEqual(['status-start', 'priority-start-and-end'])
    firstStatus.resolve()
    await pStatus
  })
})
