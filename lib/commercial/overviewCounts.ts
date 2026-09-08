// Phase C4.4A (blocker fix) — the pure state-mapping rule behind each
// Commercial Overview stat card. Extracted out of app/commercial/page.tsx
// so it can be exercised directly by a behavioral test, since this repo's
// vitest config has no DOM/fetch-mounting harness for the component itself
// (see CLAUDE.md).
//
// Three states, never conflated:
//   'unavailable' — the organisation is not entitled to this capability.
//   'error'        — the organisation IS entitled, but the request for
//                     this resource failed (non-ok response, or the
//                     resource was otherwise not fetched despite being
//                     enabled).
//   number         — the organisation is entitled AND the request
//                     succeeded; includes the legitimate value 0.
export type ResourceCountState = number | 'unavailable' | 'error';

export function resolveResourceCount(
  enabled: boolean,
  ok: boolean,
  length: number | undefined,
): ResourceCountState {
  if (!enabled) return 'unavailable';
  if (!ok || length === undefined) return 'error';
  return length;
}
