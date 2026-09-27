"use client";
// Shared design tokens and micro-components for all waste sub-pages.
//
// Authenticated visual-completion pass: the module name ("_dark") and every
// export name/signature are kept for the sub-pages that import them, but every
// value is now a theme token from app/globals.css, so the Waste module follows
// the app's light/dark theme instead of carrying a dark-only palette.
//
// These strings are for HTML styles. SVG chart chrome (recharts CartesianGrid
// stroke, tick fill, tooltip) reads concrete colours from useWasteChart()
// below (the shared chart palette), because SVG presentation attributes
// cannot always resolve custom properties. GRID/TICK/DTT stay exported (as
// tokens) for API compatibility.

import React from "react";
import { CHART_PALETTE } from "@/components/ui/app/chartPalette";
import { useTheme, type Theme } from "@/components/theme/ThemeProvider";

// ── Tokens ──────────────────────────────────────────────────────────────────
export const T1     = "var(--text-primary)";
export const T2     = "var(--text-secondary)";
export const T3     = "var(--text-muted)";
export const BORDER = "var(--border)";
export const ROW_BDR  = "var(--border-light)";
export const ROW_HEAD = "var(--bg-sunken)";
export const GRID   = "var(--border)";
export const TICK   = "var(--text-muted)";
export const BG     = "var(--bg-base)";
/** Unfilled track behind progress/meter bars. */
export const TRACK  = "var(--bg-sunken)";

// Chart tooltip style (HTML — tokens resolve here)
export const DTT = {
  background: "var(--bg-overlay)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-md)",
  color: "var(--text-primary)",
  boxShadow: "var(--shadow-popover)",
  fontSize: 12,
};

/**
 * Theme-aware shades for the raw data hues the waste sub-pages use for chart
 * series, category dots, meter fills and KPI rules. Each entry keeps the hue
 * family (series identity) and is ≥3:1 on the panel in its theme
 * (light vs #FFFFFF / --bg-sunken, dark vs #111113 — pinned by
 * tests/containment/wasteModuleVisual.test.ts). Semantic hues (success /
 * warning / danger) resolve to the chart palette's semantic colour for the
 * theme, so their meaning is preserved.
 */
export const SERIES: Record<string, { light: string; dark: string }> = {
  "#10b981": { light: "#047857", dark: "#10b981" },                                          // emerald (good / on target)
  "#22c55e": { light: "#4d7c0f", dark: "#22c55e" },                                          // green (compost) — kept apart from emerald
  "#3b82f6": { light: "#2563eb", dark: "#3b82f6" },                                          // blue
  "#f59e0b": { light: CHART_PALETTE.light.warning, dark: CHART_PALETTE.dark.warning },       // amber = warning
  "#ef4444": { light: CHART_PALETTE.light.danger,  dark: CHART_PALETTE.dark.danger },        // red = danger
  "#8b5cf6": { light: "#7e22ce", dark: "#8b5cf6" },                                          // violet (data series only)
  "#06b6d4": { light: "#0e7490", dark: "#06b6d4" },                                          // cyan
  "#f97316": { light: "#c2410c", dark: "#f97316" },                                          // orange
  "#64748b": { light: "#64748b", dark: "#64748b" },                                          // slate (passes in both)
};

/** Resolve a raw data hue to its accessible shade for `theme`; unknown values pass through. */
export function seriesColor(hex: string, theme: Theme): string {
  return SERIES[hex.toLowerCase()]?.[theme] ?? hex;
}

/**
 * Chart chrome for the waste sub-pages: concrete colours for the active theme
 * from the shared chart palette (components/ui/app/chartPalette), mirroring
 * components/dashboard/ui/chartTheme's shape (grid / tick / tooltip / palette)
 * without joining the DashboardShell family. `series(hex)` maps a raw data hue
 * to its accessible shade for the current theme.
 */
export function useWasteChart() {
  const { theme } = useTheme();
  const p = CHART_PALETTE[theme];
  return {
    series: (hex: string) => seriesColor(hex, theme),
    palette: p,
    grid: p.grid,
    tick: { fill: p.axis, fontSize: 11 },
    tooltip: {
      contentStyle: {
        background: p.tooltipBg,
        border: `1px solid ${p.tooltipBorder}`,
        borderRadius: 6,
        color: p.tooltipText,
        fontSize: 12,
        boxShadow: "var(--shadow-popover)",
      } as React.CSSProperties,
      labelStyle: { color: p.tooltipText, fontWeight: 600 } as React.CSSProperties,
      itemStyle: { color: p.tooltipText } as React.CSSProperties,
      cursor: { fill: p.grid },
    },
  };
}

/**
 * Recharts <Legend formatter>: legend item text on a text token instead of the
 * series hue (raw data hues fail 4.5:1 as text in the light theme); the
 * legend swatch keeps the series colour.
 */
export function legendText(value: string) {
  return <span style={{ color: T2 }}>{value}</span>;
}

// Card container style
export const DC: React.CSSProperties = {
  background: "var(--bg-surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-lg)",
  padding: 20,
  minWidth: 0,
};

// Page wrapper style
export const PAGE: React.CSSProperties = {
  maxWidth: 1280,
  margin: "0 auto",
  padding: "24px clamp(16px, 4vw, 32px)",
  display: "flex",
  flexDirection: "column",
  gap: 20,
  background: BG,
  minHeight: "100vh",
};

// ── Status tones ─────────────────────────────────────────────────────────────

type ToneName = "danger" | "warning" | "success" | "info";
const tone = (t: ToneName) => ({
  fg: `var(--status-${t})`,
  muted: `var(--status-${t}-muted)`,
  border: `var(--status-${t}-border)`,
});

// ── Components ───────────────────────────────────────────────────────────────

export function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent: string }) {
  // `accent` is a data/category colour: it stays as the left rule only; all
  // text is on theme tokens.
  return (
    <div style={{ background: "var(--bg-surface)", border: "1px solid var(--border)", borderRadius: "var(--radius-lg)", padding: 20, borderLeft: `4px solid ${accent}`, minWidth: 0 }}>
      <p style={{ fontSize: 11, color: T3, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em", margin: "0 0 8px" }}>{label}</p>
      <p style={{ fontSize: 24, fontWeight: 700, color: T1, margin: "0 0 4px", fontVariantNumeric: "tabular-nums" }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: T3, margin: 0 }}>{sub}</p>}
    </div>
  );
}

const INSIGHT_COLORS: Record<string, { bg: string; border: string; icon: string }> = {
  red:   { bg: tone("danger").muted,  border: tone("danger").border,  icon: tone("danger").fg },
  amber: { bg: tone("warning").muted, border: tone("warning").border, icon: tone("warning").fg },
  green: { bg: tone("success").muted, border: tone("success").border, icon: tone("success").fg },
  blue:  { bg: tone("info").muted,    border: tone("info").border,    icon: tone("info").fg },
};

export function Insight({ icon, color, title, body }: { icon: string; color: string; title: string; body: string }) {
  const c = INSIGHT_COLORS[color] ?? INSIGHT_COLORS.blue;
  return (
    <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: "var(--radius-lg)", padding: 20, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <span style={{ fontSize: 18, lineHeight: 1.2, color: c.icon, flexShrink: 0 }}>{icon}</span>
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
  const t = tone(ok ? "success" : "danger");
  return (
    <span style={{
      fontSize: 11, fontWeight: 600, padding: "2px 8px", borderRadius: "var(--radius-sm)",
      background: t.muted,
      color: t.fg,
      border: `1px solid ${t.border}`,
      whiteSpace: "nowrap",
    }}>
      {ok ? labelOk : labelBad}
    </span>
  );
}

// Reusable table shell
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
            <th key={h} scope="col" style={{ padding: "10px 14px", fontWeight: 600, fontSize: 11, color: T3, textTransform: "uppercase", letterSpacing: ".06em", textAlign: (i === 0 && firstLeft) ? "left" : "right" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>{children}</tbody>
      {footer && <tfoot>{footer}</tfoot>}
    </table>
  );
}

export function Tr({ children, highlight }: { children: React.ReactNode; highlight?: "red" | "green" | false }) {
  const bg = highlight === "red" ? tone("danger").muted : highlight === "green" ? tone("success").muted : "transparent";
  return <tr style={{ borderTop: `1px solid ${ROW_BDR}`, background: bg }}>{children}</tr>;
}

export function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return <td style={{ padding: "10px 14px", textAlign: right ? "right" : "left", color: bold ? T1 : T2, fontWeight: bold ? 600 : 400 }}>{children}</td>;
}
