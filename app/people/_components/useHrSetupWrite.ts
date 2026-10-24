'use client';
import { useRef, useState } from 'react';

// A missing response may follow a committed write. Only a fresh saved-state
// read can reset uncertainty; synchronous refs also prevent rapid double submits.
export function useHrSetupWrite() {
  const pending = useRef(false);
  const unknown = useRef(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  return {
    busy, uncertain, blocked: busy || uncertain,
    begin() {
      if (pending.current || unknown.current) return false;
      pending.current = true; setBusy(true); return true;
    },
    isBlocked: () => pending.current || unknown.current,
    isPending: () => pending.current,
    markUncertain() { unknown.current = true; setUncertain(true); },
    finish() { pending.current = false; setBusy(false); },
    resetAfterRead() {
      if (pending.current) return false;
      unknown.current = false; setUncertain(false); return true;
    },
  };
}

export function confirmedHrSetupResponse(response: Response, valid: boolean) {
  if (response.status >= 500 || (response.ok && !valid)) throw new Error('Unknown HR save outcome');
  return response.ok;
}
