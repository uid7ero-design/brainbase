import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNotesAutosaveTimer } from '@/lib/organiser/notesAutosave'

// D.4.7C — createNotesAutosaveTimer is pure, dependency-free TypeScript (no
// React, no DOM, no fetch), so like coalescingMutationQueue.ts before it,
// its timing guarantees are proven with REAL fake timers rather than only
// static source-text containment (this repo's only option for the React
// page itself — see AGENTS.md/CLAUDE.md).

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('createNotesAutosaveTimer — debounce (A, B, C, D)', () => {
  it('does not fire on the first call — schedule() only starts the debounce window (A)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'h')
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(799)
    expect(onFire).not.toHaveBeenCalled()
  })

  it('repeated calls reset/coalesce the debounce window — only the LATEST value is ever scheduled (B)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'h')
    vi.advanceTimersByTime(500)
    timer.schedule('item-1', 'he')
    vi.advanceTimersByTime(500)
    timer.schedule('item-1', 'hel')
    vi.advanceTimersByTime(500)
    timer.schedule('item-1', 'hell')
    vi.advanceTimersByTime(500)
    timer.schedule('item-1', 'hello')
    // Only 800ms of true quiet time (after the LAST keystroke) should ever
    // fire it — we've never gone 800ms without a new call yet.
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(800)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith('item-1', 'hello')
  })

  it('exactly one request occurs after the debounce interval expires (C)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'final value')
    vi.advanceTimersByTime(800)
    expect(onFire).toHaveBeenCalledTimes(1)
    // No further firing just from time passing with nothing newly scheduled.
    vi.advanceTimersByTime(5000)
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('a different debounceMs is honoured exactly', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 600 })
    timer.schedule('item-1', 'x')
    vi.advanceTimersByTime(599)
    expect(onFire).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onFire).toHaveBeenCalledTimes(1)
  })
})

describe('createNotesAutosaveTimer — cancel / flush semantics (D, E, F)', () => {
  it('cancel() prevents the pending call from ever firing (used when the caller decides the value is unchanged) (D)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'x')
    timer.cancel()
    vi.advanceTimersByTime(5000)
    expect(onFire).not.toHaveBeenCalled()
    expect(timer.isPending()).toBe(false)
    expect(timer.peek()).toBe(null)
  })

  it('peek() exposes the pending (itemId, value) for an explicit blur-triggered flush, before the debounce would otherwise fire (E)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'flushed early')
    vi.advanceTimersByTime(100) // well before the 800ms debounce
    const pending = timer.peek()
    expect(pending).toEqual({ itemId: 'item-1', value: 'flushed early' })
    // Caller (ItemDrawer's onBlur) fires it manually via its own save path:
    if (pending) onFire(pending.itemId, pending.value)
    timer.cancel()
    expect(onFire).toHaveBeenCalledTimes(1)
  })

  it('a blur flush cancels the pending delayed timer so it cannot ALSO fire later and duplicate-send (F)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-1', 'v')
    const pending = timer.peek()
    if (pending) onFire(pending.itemId, pending.value) // blur-triggered manual fire
    timer.cancel() // this is what the blur handler MUST also do
    vi.advanceTimersByTime(5000) // the original 800ms debounce window fully elapses
    expect(onFire).toHaveBeenCalledTimes(1) // not 2
  })
})

describe('createNotesAutosaveTimer — item-switch safety (G, H)', () => {
  it('a fresh schedule() for a NEW item replaces any pending value from a PREVIOUS item outright (G)', () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-A', 'unsent draft for A')
    vi.advanceTimersByTime(300)
    // Caller (ItemDrawer's item-switch effect) is responsible for flushing
    // item A's pending value BEFORE calling schedule() for item B if it
    // wants A's draft saved — this module itself just guarantees at most
    // one pending value ever exists, whichever item it belongs to.
    timer.schedule('item-B', 'first keystroke on B')
    vi.advanceTimersByTime(800)
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(onFire).toHaveBeenCalledWith('item-B', 'first keystroke on B')
  })

  it("a timer scheduled while item A was open can never fire with item B's id or a value item B never typed (H)", () => {
    const onFire = vi.fn()
    const timer = createNotesAutosaveTimer(onFire, { debounceMs: 800 })
    timer.schedule('item-A', 'A only ever typed this')
    // Simulate the caller flushing A's draft on switch (as ItemDrawer's
    // real item-switch effect does) BEFORE ever calling schedule() for B.
    const pendingA = timer.peek()
    timer.cancel()
    if (pendingA) onFire(pendingA.itemId, pendingA.value)
    timer.schedule('item-B', 'B only ever typed this')
    vi.advanceTimersByTime(800)
    expect(onFire).toHaveBeenCalledTimes(2)
    expect(onFire).toHaveBeenNthCalledWith(1, 'item-A', 'A only ever typed this')
    expect(onFire).toHaveBeenNthCalledWith(2, 'item-B', 'B only ever typed this')
  })
})
