'use client';
import { GLASS, CYAN } from "../../lib/utils/constants";
import { useAppStore } from "../../lib/state/useAppStore";

export function GlassHeader({ appState }) {
  const setBrainGraphOpen = useAppStore(s => s.setBrainGraphOpen);
  const isListening = appState === "listening";
  const isActive    = appState === "processing" || appState === "responding";

  return (
    <header style={{ height: 52, display: "flex", alignItems: "center", padding: "0 18px", gap: 12, flexShrink: 0, zIndex: 30, position: "relative", ...GLASS, borderBottom: "1px solid rgba(255,255,255,0.06)", borderTop: "none", borderLeft: "none", borderRight: "none" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, flex: 1 }}>
        <div style={{ width: 24, height: 24, borderRadius: 6, background: "rgba(0,207,234,.15)", border: "1px solid rgba(0,207,234,.30)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="4" fill={CYAN} />
            <circle cx="12" cy="12" r="9" stroke={CYAN} strokeWidth="1.5" opacity=".4" />
          </svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.92)", letterSpacing: "-.03em" }}>Helena</span>
        <span style={{ fontSize: 10, color: "rgba(255,255,255,.20)", letterSpacing: ".06em", marginLeft: 2 }}>· Brainbase</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: isListening ? CYAN : isActive ? "#A78BFA" : "rgba(255,255,255,.20)", boxShadow: isListening ? `0 0 6px ${CYAN}` : "none", transition: "all .4s" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.40)", letterSpacing: ".08em" }}>
            {isListening ? "LISTENING" : isActive ? "PROCESSING" : "IDLE"}
          </span>
        </div>

        {/* Brain graph panel */}
        <button
          onClick={() => setBrainGraphOpen(true)}
          title="Brain"
          style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(180,130,255,.18)', background: 'rgba(180,130,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(180,130,255,.75)" strokeWidth="1.8"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
        </button>

        {/* Neural Map — standalone 3D visualisation */}
        <a
          href="/neural.html"
          target="_blank"
          rel="noopener noreferrer"
          title="Neural Map"
          style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(0,207,234,.18)', background: 'rgba(0,207,234,.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', textDecoration: 'none' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(0,207,234,.75)" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/></svg>
        </a>

        {[
          <svg key="bell" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" strokeWidth="1.8"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>,
          <svg key="user" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" strokeWidth="1.8"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>,
          <svg key="cog" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.36)" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>,
        ].map((icon, i) => (
          <button key={i} style={{ width: 30, height: 30, borderRadius: 7, border: "1px solid rgba(255,255,255,.06)", background: "rgba(255,255,255,.03)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            {icon}
            {i === 0 && <div style={{ position: "absolute", top: 6, right: 6, width: 4, height: 4, borderRadius: "50%", background: "#EF4444" }} />}
          </button>
        ))}
      </div>
    </header>
  );
}
