import { attemptStore } from './attemptStore';
import { initialState, recoveredState, unsafeState, type MachineState } from './machine';
import { createPendingStore, type PendingStore } from './pendingStore';

// Phase 2C.3c reload recovery: what the staff booking dialog opens on. Client only; pure of server imports. Decided ONCE, at mount, before any request.
//
//   no recovery secret from the server            -> unsafe  (no booking is offered, nothing is sent)
//   storage unreadable / unwritable / drops writes -> unsafe
//   a record that cannot be read as a v1 record   -> unsafe  (an earlier attempt may exist and its key is unknown: never treated as "nothing pending")
//   a valid record                                -> recovering: look up the ORIGINAL key before anything else; no booking form
//   no record                                     -> the ordinary flow (and any stale in-page copy is dropped)
//
// A booking build must not have a mode without recovery, so every doubt resolves to `unsafe`.

export interface Boot {
  store: PendingStore | null;
  initial: MachineState;
}

export function bootRecovery(secret: string | null | undefined, storage?: Storage | null): Boot {
  if (!secret) return { store: null, initial: unsafeState('no_secret') };
  let area: Storage;
  try {
    const found = storage ?? (typeof window === 'undefined' ? null : window.sessionStorage);
    if (!found) return { store: null, initial: unsafeState('cannot_store') };
    area = found;
  } catch {
    return { store: null, initial: unsafeState('cannot_store') }; // accessing sessionStorage can itself throw (blocked site data)
  }
  const store = createPendingStore(secret, area);
  const status = store.status();
  if (status.kind === 'unavailable') return { store, initial: unsafeState('cannot_store') };
  if (status.kind === 'corrupt') return { store, initial: unsafeState('corrupt_record') };
  if (status.kind === 'record') {
    const { key, fp } = status.record;
    return { store, initial: recoveredState({ key, fp }, attemptStore.get(store.scope)) };
  }
  attemptStore.delete(store.scope); // no record: an in-page copy would belong to a resolved attempt
  if (!store.canStore()) return { store, initial: unsafeState('cannot_store') };
  return { store, initial: initialState() };
}
