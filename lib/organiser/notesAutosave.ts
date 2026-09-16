// D.4.7C — a tiny, pure (no React/DOM/fetch) debounce timer for the item
// drawer's Notes autosave.
//
// This module answers exactly one question — WHEN should a pending Notes
// edit actually be sent? — and nothing else. It does not know what "dirty"
// means, does not compare against an authoritative server value, and does
// not decide success/failure; all of that stays in ItemDrawer (app/
// organiser/page.tsx), which is the only place that knows the current
// draft, the authoritative item.notes, and how the two should reconcile
// (see ItemDrawer's own "Notes" section comment). Keeping this module this
// narrow is what makes it possible to prove its timing guarantees with
// real executed async/await + fake timers (see notesAutosave.test.ts),
// exactly like D.4.7B-R1's coalescingMutationQueue.ts.
//
// Each schedule() call captures its own (itemId, value) pair in a closure
// rather than reading either off some live/external ref, so a timer
// scheduled while item A is open can NEVER fire with item B's id or item
// B's later-typed value — even though ItemDrawer reuses ONE controller
// instance across item switches (it is not remounted when the open item
// changes, only when the drawer itself mounts/unmounts).
//
// enqueueCoalesced (coalescingMutationQueue.ts) is a deliberately separate
// concern: it guarantees at most one PATCH in flight per item+field at the
// HTTP layer, regardless of what triggers a write. This module guarantees
// only one thing above that — that ordinary typing doesn't dispatch a
// write on every keystroke in the first place.

export type NotesAutosaveTimer<T> = {
  /** (Re)schedules onFire(itemId, value) after the debounce interval. A
   *  call for the same or a different item replaces any previously
   *  scheduled value outright — at most one pending value ever exists. */
  schedule: (itemId: string, value: T) => void;
  /** Cancels any pending timer without firing it. Safe to call when
   *  nothing is pending. */
  cancel: () => void;
  /** True while a debounce timer is currently pending (not yet fired). */
  isPending: () => boolean;
  /** The currently-pending (itemId, value) pair, or null if none. Used by
   *  an explicit flush (blur, item switch, drawer close) to fire the
   *  pending value immediately via the caller's own save path, then
   *  cancel() so the delayed timer can never also fire and duplicate-send
   *  it. */
  peek: () => { itemId: string; value: T } | null;
};

export function createNotesAutosaveTimer<T>(
  onFire: (itemId: string, value: T) => void,
  options: { debounceMs?: number } = {},
): NotesAutosaveTimer<T> {
  const debounceMs = options.debounceMs ?? 800;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { itemId: string; value: T } | null = null;

  function clear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    pending = null;
  }

  return {
    schedule(itemId, value) {
      clear();
      pending = { itemId, value };
      timer = setTimeout(() => {
        const p = pending;
        clear();
        if (p) onFire(p.itemId, p.value);
      }, debounceMs);
    },
    cancel: clear,
    isPending: () => timer !== null,
    peek: () => pending,
  };
}
