'use client';
import { GLASS_LIGHT } from "../../lib/utils/constants";
import { STAGE_CARDS } from "../../lib/data/agents";

export function AgentStageCard({ card, appState }) {
  const isActive = appState !== "idle";

  return (
    <div style={{ position: "absolute", ...card.pos, width: 168, zIndex: 15, animation: "cardFloat 5s ease-in-out infinite", animationDelay: `${STAGE_CARDS.indexOf(card) * 1.2}s` }}>
      <div style={{ ...GLASS_LIGHT, borderRadius: 10, overflow: "hidden", transition: "all .4s", boxShadow: isActive ? "0 0 20px rgba(0,0,0,.4)" : "0 4px 20px rgba(0,0,0,.3)" }}>
        <div style={{ height: 2, background: `linear-gradient(90deg,${card.color},transparent)` }} />
        <div style={{ padding: "9px 11px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
            <span style={{ fontSize: 10 }}>{card.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 700, color: card.color, letterSpacing: ".08em" }}>{card.agent}</span>
            <div style={{ width: 4, height: 4, borderRadius: "50%", background: card.color, marginLeft: "auto", boxShadow: `0 0 5px ${card.color}`, animation: "agentPulse 2s ease-in-out infinite" }} />
          </div>
          <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.82)", marginBottom: 2, lineHeight: 1.3 }}>{card.stat}</div>
          <div style={{ fontSize: 9, color: "rgba(255,255,255,.35)" }}>{card.detail}</div>
        </div>
      </div>
    </div>
  );
}
