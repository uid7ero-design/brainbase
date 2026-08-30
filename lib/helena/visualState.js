// Shared Helena → HelenaOrbital visual-state mapping.
//
// components/BrainBase.jsx defines its own copy of this same function
// (added in Phase C) and is left untouched by the C.2B dedicated-HLNA-route
// work on purpose — Phase C's integration is already shipped and covered by
// its own containment tests, and duplicating this 6-line pure function
// carries far less risk than touching that file in a narrowly-scoped phase.
// When BrainBase.jsx itself gets reshaped (C.2C), converge it onto this
// shared module instead of keeping two copies.
//
// 'error' reflects the existing orbAlert dashboard-anomaly override (from
// useAppStore, set by InsightBanner) — not a genuine Helena/voice-pipeline
// error signal. See the Phase C report for why that mapping was chosen.
export function mapHelenaPhaseToVisualState(orbPhase, orbAlert) {
  if (orbAlert) return 'error';
  if (orbPhase === 'processing') return 'thinking';
  if (orbPhase === 'speaking') return 'speaking';
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
