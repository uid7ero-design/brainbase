// Shared Helena → HelenaOrbital visual-state mapping.
//
// Phase C.2B.2 bugfix: hooks/useHelena.js's setPhase() does NOT expose its
// internal phase names ('idle'|'listening'|'processing'|'speaking') on
// orbPhase directly — it translates them for display:
//   setOrbPhase(
//     p === 'listening'  ? 'listening'  :
//     p === 'processing' ? 'thinking'   :
//     p === 'speaking'   ? 'responding' : 'idle'
//   )
// so orbPhase's real values are 'idle'|'listening'|'thinking'|'responding'.
// This function was checking for 'processing'/'speaking' — values orbPhase
// never actually holds — so the 'thinking' and 'speaking' visual states
// silently never fired; every request quietly fell through to 'idle'.
// Confirmed live via a MutationObserver-instrumented QA pass (see the
// C.2B.2 report) showing orbPhase='thinking' rendering helenaVisualState
// ='idle' throughout an entire request/response/speak cycle.
//
// components/BrainBase.jsx carries an IDENTICAL private copy of this same
// (previously buggy) function, left deliberately untouched here — fixing
// it would visibly change /dashboard's live orb behaviour, which stays out
// of scope for this phase. Flagged prominently in the C.2B.2 report as a
// ready, trivial, same-fix candidate for whenever BrainBase.jsx is next
// touched (C.2C converges it onto this shared module anyway).
//
// 'error' reflects the existing orbAlert dashboard-anomaly override (from
// useAppStore, set by InsightBanner) — not a genuine Helena/voice-pipeline
// error signal. See the Phase C report for why that mapping was chosen.
export function mapHelenaPhaseToVisualState(orbPhase, orbAlert) {
  if (orbAlert) return 'error';
  if (orbPhase === 'thinking') return 'thinking';
  if (orbPhase === 'responding') return 'speaking';
  if (orbPhase === 'listening') return 'listening';
  return 'idle';
}

// Display label/colour per HelenaVisualState — separate keyspace from
// components/BrainBase.jsx's ORB_STATE_LABEL (which is keyed by useHelena's
// raw orbPhase values, not the mapped HelenaVisualState), so it isn't a
// duplicate of that map, just a sibling for the same 'error' precedence.
//
// Phase C.2B.1 — labels are deliberately human/sentence-style ("Listening…"
// not "LISTENING", never the internal "processing" term) per the dedicated
// HLNA workspace's status-presentation requirement. 'error' reads "Needs
// attention" rather than "Unavailable" — it reflects the existing orbAlert
// dashboard-anomaly override, not Helena herself being down.
export const HELENA_VISUAL_STATE_LABEL = {
  idle:      { label: 'Ready',         color: 'rgba(167,139,250,.55)' },
  listening: { label: 'Listening…',    color: '#38BDF8' },
  thinking:  { label: 'Thinking…',     color: '#FBBF24' },
  speaking:  { label: 'Speaking…',     color: '#A78BFA' },
  error:     { label: 'Needs attention', color: '#FB7185' },
};
