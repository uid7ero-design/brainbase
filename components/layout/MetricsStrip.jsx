'use client';
import { METRICS } from "../../lib/data/metrics";
import { CYAN } from "../../lib/utils/constants";

export function MetricsStrip() {
  return (
    <div style={{ display: "flex", alignItems: "stretch", height: 48, flexShrink: 0, borderBottom: "1px solid rgba(255,255,255,.04)", background: "rgba(8,10,18,.35)" }}>
      {METRICS.map((m, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 16px", borderRight: "1px solid rgba(255,255,255,.04)", gap: 1 }}>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.28)", letterSpacing: ".10em", fontWeight: 600 }}>{m.label}</span>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.88)", letterSpacing: "-.02em" }}>{m.value}</span>
            <span style={{ fontSize: 9, color: m.up === true ? CYAN : m.up === false ? "#F87171" : "rgba(255,255,255,.30)", fontWeight: 500 }}>{m.delta}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
