import type { MachineState, Step } from './machine';

// Phase 2C.3c reload recovery, tier 1: the unresolved attempt outlives the DIALOG (not the page). Client only; no storage.
//
// Closing the dialog unmounts it and its state with it. For an attempt whose outcome is not yet known that used to lose the idempotency key (defect D1).
// This module-level map keeps the machine state of such an attempt, keyed by the per-(user, organisation) scope, so a reopened dialog resumes the SAME
// key and the SAME frozen request. It lives in page memory exactly as the dialog's state did while open; NOTHING is written to any storage by this module,
// and it is gone on reload (tier 2, the write-ahead record, takes over there).
//
// Only unresolved states are kept. Anything resolved (booked, refused, conflict) is removed so a later booking starts clean with a fresh holder.

const UNRESOLVED: readonly Step[] = ['submitting', 'checking', 'unsure', 'retry', 'recovering'];

const attempts = new Map<string, MachineState>();

export const attemptStore = {
  get(scope: string): MachineState | null {
    return attempts.get(scope) ?? null;
  },
  /** Keeps the state if it is an unresolved attempt; removes the entry otherwise. */
  sync(scope: string, state: MachineState): void {
    if (state.attempt && UNRESOLVED.includes(state.step)) attempts.set(scope, state);
    else attempts.delete(scope);
  },
  delete(scope: string): void {
    attempts.delete(scope);
  },
  /** Test support: forget everything (a page reload does this by discarding the module). */
  reset(): void {
    attempts.clear();
  },
};
