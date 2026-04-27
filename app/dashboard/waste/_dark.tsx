"use client";
// Shared dark-theme design tokens and micro-components for all waste sub-pages.

import React from "react";

// ── Tokens ──────────────────────────────────────────────────────────────────
export const T1     = "#F5F7FA";
export const T2     = "rgba(230,237,243,0.55)";
export const T3     = "rgba(230,237,243,0.35)";
export const BORDER = "rgba(255,255,255,0.07)";
export const ROW_BDR  = "rgba(255,255,255,0.05)";
export const ROW_HEAD = "rgba(255,255,255,0.04)";
export const GRID   = "rgba(255,255,255,0.05)";
export const TICK   = "rgba(255,255,255,0.4)";
export const BG     = "#07080B";

// Chart tooltip style
export const DTT = {
  background: "#0d0f14",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: 8,
  fontSize: 12,
};

// Card container style
export const DC: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: 12,
  padding: 20,
};

// Page wrapper style
export const PAGE: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: "24px 32px",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  background: BG,
  minHeight: "100vh",
};

// ── Components ───────────────────────────────────────────────────────────────

export function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  return (
    <div style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 16, padding: 20, borderLeft: `4px solid ${accent}` }}>
      <p style={{ fontSize: 10, color: T3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", margin: "0 0 8px" }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: T1, margin: "0 0 4px" }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>}
    </div>
  );
}

const INSIGHT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  red:   { bg: "rgba(239,68,68,0.08)",   border: "rgba(239,68,68,0.20)",   icon: "#ef4444" },
  amber: { bg: "rgba(245,158,11,0.08)",  border: "rgba(245,158,11,0.20)",  icon: "#f59e0b" },
  green: { bg: "rgba(74,222,128,0.08)",  border: "rgba(74,222,128,0.20)",  icon: "#4ade80" },
  blue:  { bg: "rgba(59,130,246,0.08)",  border: "rgba(59,130,246,0.20)",  icon: "#60a5fa" },
};

export function Insight({ icon, color, title, body }: { icon: string; color: string; title: string; body: string }) {
  const c = INSIGHT_COLORS[color] ?? INSIGHT_COLORS.blue;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 16, padding: 20 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 20 }}>{icon}</span>
        <div>
          <p style={{ fontSize: 13, fontWeight: 600, color: T1, margin: "0 0 4px" }}>{title}</p>
          <p style={{ fontSize: 12, color: T2, lineHeight: 1.5, margin: 0 }}>{body}</p>
        </div>
      </div>
    </div>
  );
}

export function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, color: T1, margin: 0 }}>{title}</h2>
      {sub && <p style={{ fontSize: 12, color: T3, margin: "4px 0 0" }}>{sub}</p>}
    </div>
  );
}

export function StatusBadge({ ok, labelOk = "On Target", labelBad = "Needs Review" }: { ok: boolean; labelOk?: string; labelBad?: string }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "3px 10px", borderRadius: 999,
      background: ok ? "rgba(74,222,128,0.12)" : "rgba(239,68,68,0.12)",
      color: ok ? "#4ade80" : "#f87171",
      border: `1px solid ${ok ? "rgba(74,222,128,0.25)" : "rgba(239,68,68,0.25)"}`,
    }}>
      {ok ? labelOk : labelBad}
    </span>
  );
}

// Reusable dark table shell
export function DarkTable({ headers, firstLeft = true, children, footer }: {
  headers: string[];
  firstLeft?: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: ROW_HEAD }}>
          {headers.map((h, i) => (
            <th key={h} style={{ padding: "10px 14px", fontWeight: 600, fontSize: 10, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: (i === 0 && firstLeft) ? "left" : "right" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  );
}

export function Tr({ children, highlight }: { children: React.ReactNode; highlight?: "red" | "green" | false }) {
  const bg = highlight === "red" ? "rgba(239,68,68,0.06)" : highlight === "green" ? "rgba(74,222,128,0.06)" : "transparent";
  return <tr style={{ borderTop: `1px solid ${ROW_BDR}`, background: bg }}>{children}</tr>;
}

export function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return <td style={{ padding: "10px 14px", textAlign: right ? "right" : "left", color: bold ? T1 : T2, fontWeight: bold ? 600 : 400 }}>{children}</td>;
}
