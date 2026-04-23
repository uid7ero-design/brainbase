'use client';
import { GLASS, CYAN } from "../../lib/utils/constants";

export function FloatingCard({ card }) {
  return (
    <div style={{ width: card.variant === "revenue" ? 290 : 240, borderRadius: 10, overflow: "hidden", ...GLASS, animation: "cardEntry .5s cubic-bezier(0.16,1,0.3,1) both, cardFloat 4s ease-in-out infinite .6s", boxShadow: "0 8px 32px rgba(0,0,0,.45)" }}>
      <div style={{ height: 2, background: `linear-gradient(90deg,${CYAN},transparent)` }} />
      <div style={{ padding: "10px 12px" }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 5 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: CYAN, letterSpacing: ".08em", textTransform: "uppercase" }}>{card.type}</span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.22)", marginLeft: "auto" }}>{card.time}</span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,.88)", lineHeight: 1.35, marginBottom: 3 }}>{card.title}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.38)", lineHeight: 1.4 }}>{card.sub || card.content}</div>
      </div>
    </div>
  );
}
