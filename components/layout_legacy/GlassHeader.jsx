'use client';
import { useState, useEffect } from "react";
import { GLASS, CYAN } from "../../lib/utils/constants";
import { useAppStore } from "../../lib/state/useAppStore";

export function GlassHeader({ appState }) {
  const setBrainGraphOpen = useAppStore(s => s.setBrainGraphOpen);
  const setInboxOpen      = useAppStore(s => s.setInboxOpen);
  const [unreadCount,  setUnreadCount]  = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [battery,      setBattery]      = useState(null); // { level, charging }

  useEffect(() => {
    function onFsChange() { setIsFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  useEffect(() => {
    if (!navigator.getBattery) return;
    let bat;
    function update() { setBattery({ level: Math.round(bat.level * 100), charging: bat.charging }); }
    navigator.getBattery().then(b => {
      bat = b;
      update();
      b.addEventListener('levelchange',   update);
      b.addEventListener('chargingchange', update);
    });
  }, []);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  useEffect(() => {
    async function checkUnread() {
      try {
        const s = await fetch('/api/integrations/gmail/status').then(r => r.json());
        if (!s.connected) return;
        const d = await fetch('/api/integrations/gmail/messages').then(r => r.json());
        setUnreadCount((d.messages ?? []).filter(m => m.unread).length);
      } catch {}
    }
    checkUnread();
    const t = setInterval(checkUnread, 2 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

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
        <span style={{ fontSize: 10, color: "rgba(255,255,255,.62)", letterSpacing: ".06em", marginLeft: 2 }}>· Brainbase</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 10px", borderRadius: 20, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)" }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: isListening ? CYAN : isActive ? "#A78BFA" : "rgba(255,255,255,.20)", boxShadow: isListening ? `0 0 6px ${CYAN}` : "none", transition: "all .4s" }} />
          <span style={{ fontSize: 10, color: "rgba(255,255,255,.62)", letterSpacing: ".08em" }}>
            {isListening ? "LISTENING" : isActive ? "PROCESSING" : "IDLE"}
          </span>
        </div>

        {/* Battery */}
        {battery !== null && (() => {
          const pct = battery.level;
          const color = pct <= 15 ? '#EF4444' : pct <= 30 ? '#F59E0B' : 'rgba(134,239,172,.85)';
          return (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 7px', borderRadius: 6, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)' }}>
              <svg width="16" height="10" viewBox="0 0 20 12" fill="none">
                <rect x="0.5" y="0.5" width="16" height="11" rx="2.5" stroke="rgba(255,255,255,.35)" strokeWidth="1"/>
                <rect x="17" y="3.5" width="2.5" height="5" rx="1" fill="rgba(255,255,255,.25)"/>
                <rect x="1.5" y="1.5" width={Math.round(14 * pct / 100)} height="9" rx="1.5" fill={color}/>
                {battery.charging && (
                  <text x="8" y="9" textAnchor="middle" fontSize="7" fill="white" fontWeight="700">⚡</text>
                )}
              </svg>
              <span style={{ fontSize: 10, fontWeight: 600, color, letterSpacing: '-.01em' }}>{pct}%</span>
            </div>
          );
        })()}

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

        {/* Fullscreen toggle */}
        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(255,255,255,.06)', background: isFullscreen ? 'rgba(0,207,234,.06)' : 'rgba(255,255,255,.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
        >
          {isFullscreen
            ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(0,207,234,.70)" strokeWidth="1.8"><polyline points="8 3 3 3 3 8"/><polyline points="21 8 21 3 16 3"/><polyline points="3 16 3 21 8 21"/><polyline points="16 21 21 21 21 16"/></svg>
            : <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.50)" strokeWidth="1.8"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>}
        </button>

        {/* Inbox */}
        <button
          onClick={() => setInboxOpen(true)}
          title="Inbox"
          style={{ width: 30, height: 30, borderRadius: 7, border: unreadCount > 0 ? '1px solid rgba(234,67,53,.30)' : '1px solid rgba(255,255,255,.06)', background: unreadCount > 0 ? 'rgba(234,67,53,.08)' : 'rgba(255,255,255,.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', position: 'relative' }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={unreadCount > 0 ? 'rgba(234,67,53,.80)' : 'rgba(255,255,255,0.36)'} strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          {unreadCount > 0 && (
            <div style={{ position: 'absolute', top: 4, right: 4, minWidth: 8, height: 8, borderRadius: 4, background: '#EF4444', fontSize: 7, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 2px' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </div>
          )}
        </button>

      </div>
    </header>
  );
}
