'use client';
import { useState, useEffect } from 'react';
import { GLASS, CYAN } from "../../lib/utils/constants";

export function FloatingCard({ card, onDismiss }) {
  const [visible, setVisible] = useState(true);
  const [fading,  setFading]  = useState(false);

  useEffect(() => {
    const fadeTimer    = setTimeout(() => setFading(true),  5500);
    const removeTimer  = setTimeout(() => { setVisible(false); onDismiss?.(); }, 6200);
    return () => { clearTimeout(fadeTimer); clearTimeout(removeTimer); };
  }, []);

  if (!visible) return null;

  return (
    <div style={{
      width: card.variant === "revenue" ? 290 : 240,
      borderRadius: 10, overflow: "hidden",
      ...GLASS,
      animation: "cardEntry .5s cubic-bezier(0.16,1,0.3,1) both, cardFloat 4s ease-in-out infinite .6s",
      boxShadow: "0 8px 32px rgba(0,0,0,.45)",
      opacity: fading ? 0 : 1,
      transition: "opacity .7s ease",
      position: "relative",
    }}>
      <div style={{ height: 2, background: `linear-gradient(90deg,${CYAN},transparent)` }} />
      <div style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: CYAN, letterSpacing: ".08em", textTransform: "uppercase" }}>{card.type}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.42)", marginLeft: "auto" }}>{card.time}</span>
          <button
            onClick={() => { setFading(true); setTimeout(() => { setVisible(false); onDismiss?.(); }, 400); }}
            style={{ marginLeft: 6, background: "none", border: "none", cursor: "pointer", padding: 0, color: "rgba(255,255,255,.25)", lineHeight: 1, display: "flex" }}
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.88)", lineHeight: 1.35, marginBottom: 3 }}>{card.title}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.56)", lineHeight: 1.4 }}>{card.sub || card.content}</div>
      </div>
    </div>
  );
}
