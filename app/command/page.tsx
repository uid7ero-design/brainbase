"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GridLayout from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { HlnaOrb } from "@/components/brand/HlnaOrb";
import WorkspaceShell from "@/components/ops/WorkspaceShell";
import HlnaBriefingWidget from "@/components/ops/widgets/HlnaBriefingWidget";
import WeatherWidget from "@/components/ops/widgets/WeatherWidget";
import MapWidget from "@/components/ops/widgets/MapWidget";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const LAYOUT_KEY = "ops-workspace-layout-v1";

// ── DATA ─────────────────────────────────────────────────────────────────────

const KPIS = [
  { label: "Missed Bins",       value: "47",    trend: "up"   as const, trendLabel: "+12%",      trendBad: true,  spark: [22, 18, 25, 30, 28, 38, 47] },
  { label: "On-Time",           value: "81%",   trend: "down" as const, trendLabel: "−6%",       trendBad: true,  spark: [92, 90, 88, 87, 85, 83, 81] },
  { label: "Active Alerts",     value: "4",     trend: "up"   as const, trendLabel: "+2 today",  trendBad: true,  spark: [1, 2, 1, 2, 3, 2, 4] },
  { label: "Cost Variance",     value: "+5.2%", trend: "up"   as const, trendLabel: "vs budget", trendBad: true,  spark: [0.5, 1.2, 2.0, 3.1, 3.8, 4.5, 5.2] },
  { label: "Fleet Avail.",      value: "88%",   trend: "down" as const, trendLabel: "−4% wk",    trendBad: true,  spark: [95, 94, 93, 92, 90, 89, 88] },
];

const ALERTS = [
  { id: "route-delays",      status: "critical" as const, title: "Route delays exceeding KPI",     metric: "+34 min", metricLabel: "avg delay",           description: "Southern routes 4 and 7 running significantly over schedule.",                        action: "Reassign crew",  href: "/dashboard/waste"  },
  { id: "organics",          status: "warning"  as const, title: "Organics backlog forming",        metric: "2 days",  metricLabel: "behind schedule",      description: "Zone 8 organics collection falling behind. 3 crews reassigned.",                   action: "View routes",    href: "/dashboard/waste"  },
  { id: "fuel",              status: "warning"  as const, title: "Fuel cost trending up",           metric: "+5.2%",   metricLabel: "vs budget",            description: "TRK-008 distorting fleet average — maintenance review flagged.",                   action: "Open fleet",     href: "/dashboard/fleet"  },
  { id: "recycling",         status: "stable"   as const, title: "Recycling within target",         metric: "64.2%",   metricLabel: "diversion rate",       description: "Overall diversion rate above the 60% monthly KPI target.",                        action: "View report",    href: "/dashboard/waste"  },
  { id: "staff-shortage",    status: "warning"  as const, title: "Driver shortage — Zone 3",        metric: "3 crews", metricLabel: "unrostered",           description: "Three scheduled drivers unavailable. Contractor cover arranged for afternoon shift.", action: "View roster",   href: "/dashboard/waste"  },
  { id: "transfer-station",  status: "critical" as const, title: "Transfer station at capacity",    metric: "96%",     metricLabel: "capacity",             description: "Northern transfer station approaching overflow. Diversion to secondary site.",       action: "Divert loads",   href: "/dashboard/fleet"  },
];

const SYS_STATUS = [
  { label: "Waste",       status: "warn"     as const, note: "Attention",   detail: "Missed bins +12%, 2 route delays in southern zones." },
  { label: "Fleet",       status: "ok"       as const, note: "Operational", detail: "16 of 18 vehicles active. TRK-008 flagged for review." },
  { label: "Processing",  status: "warn"     as const, note: "Delayed",     detail: "Northern transfer station at 96% capacity." },
  { label: "Complaints",  status: "critical" as const, note: "Rising",      detail: "8 new complaints today. Up 8% on rolling average." },
  { label: "Utilities",   status: "ok"       as const, note: "Stable",      detail: "All water and utility services nominal." },
  { label: "Roads",       status: "ok"       as const, note: "Stable",      detail: "Road operations normal. Weather watch active." },
];

const CHANGES = [
  { label: "Missed bins",    delta: "+12%",  dir: "up"   as const },
  { label: "Fuel cost",      delta: "+5.2%", dir: "up"   as const },
  { label: "Complaints",     delta: "+8%",   dir: "up"   as const },
  { label: "Recycling rate", delta: "+1.4%", dir: "down" as const },
];

const SUGGESTED = ["Why are complaints up?", "Show cost drivers", "What needs attention today?"];

const NAVIGATE_MAP: Record<string, string> = {
  fleet: "/dashboard/fleet", waste: "/dashboard/waste",
  water: "/dashboard/water", roads: "/dashboard/roads",
  dashboards: "/dashboards",
};

// ── STATUS STYLES ────────────────────────────────────────────────────────────

const S = {
  critical: { dot: "#EF4444", label: "Critical", bg: "rgba(239,68,68,.08)",  border: "rgba(239,68,68,.20)",  text: "#EF4444", glow: "rgba(239,68,68,.28)"  },
  warning:  { dot: "#F59E0B", label: "Warning",  bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.20)", text: "#F59E0B", glow: "rgba(245,158,11,.24)" },
  stable:   { dot: "#22C55E", label: "Stable",   bg: "rgba(34,197,94,.08)",  border: "rgba(34,197,94,.20)",  text: "#22C55E", glow: "rgba(34,197,94,.22)"  },
  ok:       { dot: "#22C55E", color: "#22C55E" },
  warn:     { dot: "#F59E0B", color: "#F59E0B" },
};

// ── DEFAULT LAYOUT ────────────────────────────────────────────────────────────

const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: "kpi",       x: 0,  y: 0,  w: 12, h: 3,  static: true },
  { i: "ribbon",    x: 0,  y: 3,  w: 12, h: 2,  minH: 2, maxH: 4 },
  { i: "briefing",  x: 0,  y: 5,  w: 8,  h: 8,  minH: 5 },
  { i: "weather",   x: 8,  y: 5,  w: 4,  h: 8,  minH: 5 },
  { i: "alerts",    x: 0,  y: 13, w: 8,  h: 9,  minH: 5 },
  { i: "actions",   x: 8,  y: 13, w: 4,  h: 5,  minH: 4 },
  { i: "changes",   x: 8,  y: 18, w: 4,  h: 4,  minH: 3 },
  { i: "assistant", x: 0,  y: 22, w: 7,  h: 8,  minH: 5 },
  { i: "map",       x: 7,  y: 22, w: 5,  h: 8,  minH: 5 },
];

// ── SPARKLINE ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 60, H = 26;
  const min = Math.min(...data); const max = Math.max(...data); const rng = max - min || 1;
  const x = (i: number) => ((i / (data.length - 1)) * W).toFixed(1);
  const y = (v: number) => (H - ((v - min) / rng) * H * 0.82 - H * 0.09).toFixed(1);
  const pts  = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const fill = [`0,${H}`, ...data.map((v, i) => `${x(i)},${y(v)}`), `${W},${H}`].join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <polygon points={fill} fill={color} opacity="0.09" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.80" />
    </svg>
  );
}

// ── LIVE TIMESTAMP ─────────────────────────────────────────────────────────────

function LiveAgo({ baseSeconds = 0 }: { baseSeconds?: number }) {
  const [secs, setSecs] = useState(baseSeconds);
  useEffect(() => {
    const id = setInterval(() => setSecs(p => p + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const txt = secs < 60 ? `${secs}s ago` : `${Math.floor(secs / 60)}m ago`;
  return <span style={{ fontSize: 9.5, color: "rgba(255,255,255,.22)", fontVariantNumeric: "tabular-nums" }}>Updated {txt}</span>;
}

// ── HEARTBEAT ─────────────────────────────────────────────────────────────────

function Heartbeat() {
  return (
    <svg width="32" height="16" viewBox="0 0 32 16" style={{ display: "block" }}>
      <polyline points="0,8 5,8 7,3 9,13 11,4 13,12 15,8 32,8"
        fill="none" stroke="rgba(34,197,94,.50)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <animateTransform attributeName="transform" type="translate" from="0,0" to="-32,0" dur="2s" repeatCount="indefinite" />
      </polyline>
      <polyline points="32,8 37,8 39,3 41,13 43,4 45,12 47,8 64,8"
        fill="none" stroke="rgba(34,197,94,.50)" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
        <animateTransform attributeName="transform" type="translate" from="-32,0" to="-64,0" dur="2s" repeatCount="indefinite" />
      </polyline>
    </svg>
  );
}

// ── MESSAGE TYPE ─────────────────────────────────────────────────────────────

type Msg = { role: "user" | "assistant"; text: string };
type OrbState = "idle" | "thinking" | "alert";

// ── PAGE ─────────────────────────────────────────────────────────────────────

export default function CommandPage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = useState(900);
  const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [ribbonExpanded, setRibbonExpanded] = useState<string | null>(null);
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Good morning. Monitoring all systems. 2 alerts need your attention today." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(msgs.length);

  // Responsive grid width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setGridWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Load persisted layout
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAYOUT_KEY);
      if (saved) setLayout(JSON.parse(saved));
    } catch {}
  }, []);

  // Auto-scroll chat
  useEffect(() => {
    if (msgs.length <= prevMsgCount.current) { prevMsgCount.current = msgs.length; return; }
    prevMsgCount.current = msgs.length;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  const handleLayoutChange = useCallback((newLayout: Layout) => {
    const merged = [...newLayout].map(item => {
      const def = DEFAULT_LAYOUT.find(d => d.i === item.i);
      return def?.static ? def : item;
    });
    setLayout(merged);
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(merged)); } catch {}
  }, []);

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
    try { localStorage.removeItem(LAYOUT_KEY); } catch {}
  };

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: t }];
    setMsgs(next); setInput(""); setBusy(true); setOrbState("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.text })), dashboardContext: "Command Centre — real-time municipal operations hub." }),
      });
      const d = await res.json();
      setMsgs(p => [...p, { role: "assistant", text: d.response || "I couldn't process that." }]);
      setOrbState("idle");
      if (d.action === "navigate" && NAVIGATE_MAP[d.target]) setTimeout(() => router.push(NAVIGATE_MAP[d.target]), 800);
    } catch {
      setMsgs(p => [...p, { role: "assistant", text: "I'm having trouble connecting right now." }]);
      setOrbState("alert"); setTimeout(() => setOrbState("idle"), 3000);
    } finally { setBusy(false); }
  }

  // ── WIDGET PANELS ────────────────────────────────────────────────────────

  const KpiStrip = (
    <section style={{ height: "100%", display: "grid", gridTemplateColumns: "repeat(5,1fr)", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,.07)", boxShadow: "inset 0 1px 0 rgba(255,255,255,.04), 0 0 30px rgba(0,0,0,.30)" }}>
      {KPIS.map((kpi, i) => {
        const color = kpi.trendBad ? "#EF4444" : "#22C55E";
        return (
          <div key={kpi.label} style={{
            padding: "16px 18px", background: "rgba(7,8,11,.88)", backdropFilter: "blur(12px)",
            borderRight: i < KPIS.length - 1 ? "1px solid rgba(255,255,255,.055)" : "none",
            position: "relative", overflow: "hidden",
          }}>
            {/* Subtle top edge */}
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: `linear-gradient(90deg,transparent,${color}22,transparent)` }} />
            <div style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.24)", textTransform: "uppercase", marginBottom: 9 }}>
              {kpi.label}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
              <div>
                <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.04em", color: "#F5F7FA", lineHeight: 1, marginBottom: 6 }}>{kpi.value}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10.5, fontWeight: 600, color }}>
                  <span>{kpi.trend === "up" ? "↑" : "↓"}</span>
                  <span>{kpi.trendLabel}</span>
                </div>
              </div>
              <Sparkline data={kpi.spark} color={color} />
            </div>
          </div>
        );
      })}
    </section>
  );

  const StatusRibbon = (
    <section style={{ height: "100%", display: "grid", gridTemplateColumns: "repeat(6,1fr)", borderRadius: 10, overflow: "hidden", border: "1px solid rgba(255,255,255,.07)", boxShadow: "0 0 20px rgba(0,0,0,.20)" }}>
      {SYS_STATUS.map((sys, i) => {
        const color = sys.status === "ok" ? "#22C55E" : sys.status === "warn" ? "#F59E0B" : "#EF4444";
        const isOpen = ribbonExpanded === sys.label;
        return (
          <div key={sys.label}
            onClick={() => setRibbonExpanded(isOpen ? null : sys.label)}
            style={{
              padding: "10px 14px",
              background: isOpen ? `${color}0D` : "rgba(7,8,11,.85)",
              backdropFilter: "blur(10px)",
              borderRight: i < SYS_STATUS.length - 1 ? "1px solid rgba(255,255,255,.055)" : "none",
              display: "flex", alignItems: "center", gap: 8,
              cursor: "pointer", transition: "all .18s", position: "relative",
              boxShadow: isOpen ? `inset 0 0 0 1px ${color}30` : "none",
            }}
            onMouseEnter={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.04)"; }}
            onMouseLeave={e => { if (!isOpen) (e.currentTarget as HTMLDivElement).style.background = "rgba(7,8,11,.85)"; }}
          >
            {/* Status dot with pulse ring on critical */}
            <div style={{ position: "relative", flexShrink: 0 }}>
              {sys.status === "critical" && (
                <div style={{ position: "absolute", inset: -4, borderRadius: "50%", border: `1px solid ${color}`, animation: "ribbon-ring 2s ease-out infinite", opacity: 0 }} />
              )}
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 7px ${color}`, animation: sys.status !== "ok" ? "ribbon-pulse 2.2s ease-in-out infinite" : "none" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.68)", lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sys.label}</div>
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", color, textTransform: "uppercase", marginTop: 1 }}>{sys.note}</div>
              {isOpen && (
                <div style={{ fontSize: 9.5, color: "rgba(255,255,255,.45)", lineHeight: 1.5, marginTop: 4, whiteSpace: "normal", animation: "ribbon-expand .15s ease" }}>
                  {sys.detail}
                </div>
              )}
            </div>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.20)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0, transform: isOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }}>
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
        );
      })}
    </section>
  );

  const AlertsGrid = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden", background: "rgba(7,8,11,.72)", border: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(16px)" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.055)", background: "rgba(255,255,255,.015)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <div style={{ width: 5.5, height: 5.5, borderRadius: "50%", background: "#EF4444", boxShadow: "0 0 6px #EF4444", animation: "kf-blink 2s ease-in-out infinite" }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".10em", color: "rgba(255,255,255,.40)", textTransform: "uppercase" }}>Active Alerts</span>
        </div>
        <span style={{ fontSize: 10.5, color: "rgba(239,68,68,.70)", fontWeight: 600 }}>2 require immediate action</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))", gap: 9 }}>
          {ALERTS.map(alert => {
            const s = S[alert.status];
            return (
              <div key={alert.id} style={{
                padding: "16px", borderRadius: 11,
                background: s.bg, border: `1px solid ${s.border}`,
                backdropFilter: "blur(8px)",
                display: "flex", flexDirection: "column", gap: 9,
                transition: "all .18s",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,.04)",
              }}
                onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 28px ${"glow" in s ? s.glow : "transparent"}, inset 0 1px 0 rgba(255,255,255,.04)`; }}
                onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = "inset 0 1px 0 rgba(255,255,255,.04)"; }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: s.dot, boxShadow: `0 0 6px ${s.dot}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: s.text, letterSpacing: ".09em", textTransform: "uppercase" }}>{("label" in s) ? s.label : ""}</span>
                </div>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "#F5F7FA", lineHeight: 1.35 }}>{alert.title}</div>
                <div>
                  <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-.04em", color: s.text, lineHeight: 1 }}>{alert.metric}</div>
                  <div style={{ fontSize: 9.5, color: "rgba(255,255,255,.30)", marginTop: 2, letterSpacing: ".04em" }}>{alert.metricLabel}</div>
                </div>
                <div style={{ fontSize: 10.5, color: "rgba(230,237,243,.42)", lineHeight: 1.55 }}>{alert.description}</div>
                <Link href={alert.href} style={{
                  display: "block", padding: "7px 12px", borderRadius: 7,
                  background: `${s.dot}16`, border: `1px solid ${s.dot}35`,
                  fontSize: 11, fontWeight: 600, color: s.text,
                  textDecoration: "none", textAlign: "center", letterSpacing: ".02em", transition: "all .15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = `${s.dot}28`; e.currentTarget.style.boxShadow = `0 0 12px ${"glow" in s ? s.glow : "transparent"}`; }}
                  onMouseLeave={e => { e.currentTarget.style.background = `${s.dot}16`; e.currentTarget.style.boxShadow = ""; }}>
                  {alert.action} →
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );

  const ActionsHub = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden", background: "rgba(7,8,11,.72)", border: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(16px)" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.055)", background: "rgba(255,255,255,.015)", flexShrink: 0 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".10em", color: "rgba(255,255,255,.38)", textTransform: "uppercase" }}>Operational Actions</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "10px" }}>
        {([
          { label: "Resolve Alerts",  href: "/dashboard/waste", color: "#EF4444", bg: "rgba(239,68,68,.10)", border: "rgba(239,68,68,.24)", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
          { label: "Reassign Routes", href: "/dashboard/waste", color: "#F59E0B", bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.24)", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> },
          { label: "Dispatch Crew",   href: "/dashboard/fleet", color: "#60A5FA", bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.24)", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
        ] as { label: string; href: string; color: string; bg: string; border: string; icon: React.ReactNode }[]).map(btn => (
          <Link key={btn.label} href={btn.href} style={{ textDecoration: "none", display: "block", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 8, background: btn.bg, border: `1px solid ${btn.border}`, cursor: "pointer", transition: "all .15s" }}
              onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(2px)"; (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.14)"; }}
              onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.filter = ""; }}>
              <span style={{ color: btn.color, flexShrink: 0 }}>{btn.icon}</span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: btn.color, flex: 1 }}>{btn.label}</span>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke={btn.color} strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
            </div>
          </Link>
        ))}
        <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "8px 2px" }} />
        {([
          { label: "Monthly Report", action: () => alert("Coming soon."), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
          { label: "Export Data",    action: () => alert("Coming soon."), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
        ] as { label: string; action: () => void; icon: React.ReactNode }[]).map(btn => (
          <button key={btn.label} onClick={btn.action} style={{ display: "flex", alignItems: "center", gap: 9, padding: "10px 12px", borderRadius: 8, width: "100%", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", cursor: "pointer", transition: "all .15s", fontFamily: FONT, marginBottom: 6 }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.07)"; (e.currentTarget as HTMLElement).style.transform = "translateX(2px)"; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.04)"; (e.currentTarget as HTMLElement).style.transform = ""; }}>
            <span style={{ color: "rgba(255,255,255,.38)", flexShrink: 0 }}>{btn.icon}</span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: "rgba(230,237,243,.55)", flex: 1 }}>{btn.label}</span>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.20)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
          </button>
        ))}
      </div>
    </div>
  );

  const ChangesPanel = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden", background: "rgba(7,8,11,.72)", border: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(16px)" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.055)", background: "rgba(255,255,255,.015)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".10em", color: "rgba(255,255,255,.38)", textTransform: "uppercase" }}>Last 24 Hours</span>
        <Heartbeat />
      </div>
      <div style={{ flex: 1, padding: "10px 14px" }}>
        {CHANGES.map((c, i) => {
          const bad = c.dir === "up"; const color = bad ? "#EF4444" : "#22C55E";
          return (
            <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 9, padding: "9px 2px", borderBottom: i < CHANGES.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: `${color}14`, border: `1px solid ${color}28`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color }}>
                {c.dir === "up" ? "↑" : "↓"}
              </div>
              <span style={{ fontSize: 11.5, color: "rgba(230,237,243,.62)", flex: 1 }}>{c.label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color }}>{c.delta}</span>
            </div>
          );
        })}
      </div>
    </div>
  );

  const AssistantPanel = (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", borderRadius: 14, overflow: "hidden", background: "rgba(7,8,11,.72)", border: "1px solid rgba(255,255,255,.07)", backdropFilter: "blur(16px)" }}>
      <div style={{ padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.055)", background: "rgba(139,92,246,.04)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1 }}>
          <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 5px #22C55E", animation: "kf-blink 2.4s ease-in-out infinite" }} />
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".10em", color: "rgba(255,255,255,.48)", textTransform: "uppercase" }}>
            HLN<span style={{ color: "#A78BFA" }}>Λ</span> Assistant
          </span>
          <span style={{ fontSize: 9, color: "rgba(255,255,255,.18)", letterSpacing: ".06em", textTransform: "uppercase" }}>· Ask anything</span>
        </div>
        <div style={{ filter: orbState === "thinking" ? "drop-shadow(0 0 8px rgba(167,139,250,.7))" : "drop-shadow(0 0 4px rgba(139,92,246,.35))", transition: "filter .4s" }}>
          <HlnaOrb size={28} state={orbState === "alert" ? "idle" : orbState} speechRef={undefined} style={undefined} />
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "kf-fadein .2s ease" }}>
            <div style={{ maxWidth: "85%", padding: "8px 12px", borderRadius: 9, fontSize: 12.5, lineHeight: 1.6, background: m.role === "user" ? "rgba(255,255,255,.06)" : "rgba(99,102,241,.15)", border: m.role === "user" ? "1px solid rgba(255,255,255,.08)" : "1px solid rgba(99,102,241,.24)", color: "rgba(255,255,255,.86)" }}>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div style={{ display: "flex" }}>
            <div style={{ padding: "10px 14px", borderRadius: 9, background: "rgba(99,102,241,.10)", border: "1px solid rgba(99,102,241,.20)", display: "flex", gap: 5, alignItems: "center" }}>
              {[0, 1, 2].map(j => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: "#A78BFA", animation: `kf-bounce .9s ${j * .15}s ease-in-out infinite alternate` }} />)}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div style={{ padding: "0 12px 8px", display: "flex", gap: 6, flexWrap: "wrap", flexShrink: 0 }}>
        {SUGGESTED.map(p => (
          <button key={p} onClick={() => send(p)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 10.5, fontWeight: 500, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", color: "rgba(230,237,243,.48)", cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap", fontFamily: FONT }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,.14)"; e.currentTarget.style.color = "#C4B5FD"; e.currentTarget.style.borderColor = "rgba(139,92,246,.28)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.color = "rgba(230,237,243,.48)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"; }}>
            {p}
          </button>
        ))}
      </div>
      <div style={{ padding: "8px 12px", borderTop: "1px solid rgba(255,255,255,.05)", display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask HLNΛ anything…"
          style={{ flex: 1, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8, padding: "7px 11px", fontSize: 12.5, color: "#F5F7FA", outline: "none", fontFamily: FONT, transition: "border-color .15s" }}
          onFocus={e => (e.currentTarget.style.borderColor = "rgba(139,92,246,.45)")}
          onBlur={e => (e.currentTarget.style.borderColor = "rgba(255,255,255,.07)")}
        />
        <button onClick={() => send(input)} disabled={!input.trim() || busy} style={{ width: 34, height: 34, borderRadius: 8, flexShrink: 0, background: input.trim() ? "rgba(139,92,246,.28)" : "rgba(255,255,255,.04)", border: `1px solid ${input.trim() ? "rgba(139,92,246,.44)" : "rgba(255,255,255,.07)"}`, display: "flex", alignItems: "center", justifyContent: "center", cursor: input.trim() ? "pointer" : "default", transition: "all .15s" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={input.trim() ? "#C4B5FD" : "rgba(255,255,255,.20)"} strokeWidth="2" strokeLinecap="round">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>
  );

  // ── RENDER ───────────────────────────────────────────────────────────────

  return (
    <WorkspaceShell title="Command Centre" alertCount={4} intelRail>
      <style dangerouslySetInnerHTML={{ __html: `
        /* react-grid-layout */
        .react-grid-layout{position:relative;transition:height 200ms ease}
        .react-grid-item{transition:all 200ms ease;transition-property:left,top,width,height;box-sizing:border-box}
        .react-grid-item.cssTransforms{transition-property:transform,width,height}
        .react-grid-item.resizing{will-change:width,height;z-index:4}
        .react-grid-item.react-draggable-dragging{transition:none;z-index:5;will-change:transform;cursor:grabbing!important;opacity:.92;filter:drop-shadow(0 12px 28px rgba(0,0,0,.55))}
        .react-grid-item.react-grid-placeholder{background:rgba(139,92,246,.07);border:1px dashed rgba(139,92,246,.28);border-radius:12px;opacity:.8;transition-duration:100ms;z-index:2;backdrop-filter:blur(4px)}
        .react-grid-item>.react-resizable-handle{position:absolute;width:20px;height:20px;bottom:0;right:0;cursor:se-resize;opacity:0;transition:opacity .2s}
        .react-grid-item:hover>.react-resizable-handle{opacity:1}
        .react-grid-item>.react-resizable-handle::after{content:"";position:absolute;right:4px;bottom:4px;width:6px;height:6px;border-right:1.5px solid rgba(255,255,255,.25);border-bottom:1.5px solid rgba(255,255,255,.25)}
        .edit-mode .react-grid-item:not(.react-grid-placeholder){outline:1px dashed rgba(139,92,246,.25);outline-offset:-1px;cursor:grab}
        /* Page keyframes */
        @keyframes kf-blink  { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes kf-bounce { from{transform:translateY(0);opacity:.4} to{transform:translateY(-5px);opacity:1} }
        @keyframes kf-fadein { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:none} }
        @keyframes ribbon-pulse { 0%,100%{box-shadow:0 0 7px currentColor} 50%{box-shadow:0 0 14px currentColor} }
        @keyframes ribbon-ring  { 0%{transform:scale(1);opacity:.6} 100%{transform:scale(3);opacity:0} }
        @keyframes ribbon-expand{ from{opacity:0;max-height:0} to{opacity:1;max-height:60px} }
        @keyframes toolbar-in   { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:none} }
      `}} />

      {/* ── Workspace toolbar ── */}
      <div style={{
        height: 34, display: "flex", alignItems: "center", gap: 10,
        padding: "0 20px", flexShrink: 0,
        borderBottom: "1px solid rgba(255,255,255,.04)",
        background: "rgba(6,7,10,.50)",
        animation: "toolbar-in .2s ease",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "rgba(255,255,255,.20)", letterSpacing: ".03em" }}>
          <span>Command Centre</span><span style={{ opacity: .35 }}>/</span><span style={{ color: "rgba(167,139,250,.55)" }}>Operations</span>
        </div>
        <div style={{ flex: 1 }} />
        <LiveAgo baseSeconds={3} />
        <div style={{ width: 1, height: 12, background: "rgba(255,255,255,.07)" }} />
        {editMode && (
          <button onClick={resetLayout} style={{ padding: "3px 9px", borderRadius: 5, fontSize: 10, fontWeight: 600, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.10)", color: "rgba(255,255,255,.35)", cursor: "pointer", fontFamily: FONT, letterSpacing: ".04em" }}>
            Reset layout
          </button>
        )}
        <button onClick={() => setEditMode(p => !p)} style={{
          padding: "3px 10px", borderRadius: 5, fontSize: 10, fontWeight: 600,
          background: editMode ? "rgba(139,92,246,.20)" : "rgba(255,255,255,.04)",
          border: `1px solid ${editMode ? "rgba(139,92,246,.38)" : "rgba(255,255,255,.10)"}`,
          color: editMode ? "#C4B5FD" : "rgba(255,255,255,.35)",
          cursor: "pointer", fontFamily: FONT, letterSpacing: ".04em", transition: "all .15s",
        }}>
          {editMode ? "✓ Done" : "⊞ Edit workspace"}
        </button>
      </div>

      {/* ── Grid canvas ── */}
      <div ref={containerRef} style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "12px 16px 64px" }}>
        {gridWidth > 0 && (
          <div className={editMode ? "edit-mode" : ""}>
            <GridLayout
              layout={layout}
              width={gridWidth - 32}
              gridConfig={{ cols: 12, rowHeight: 32, margin: [10, 10], containerPadding: [0, 0] }}
              dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
              resizeConfig={{ enabled: editMode }}
              onLayoutChange={handleLayoutChange}
            >
              <div key="kpi">{KpiStrip}</div>
              <div key="ribbon">{StatusRibbon}</div>
              <div key="briefing">
                <HlnaBriefingWidget orbState={orbState} />
              </div>
              <div key="weather">
                <WeatherWidget />
              </div>
              <div key="alerts">{AlertsGrid}</div>
              <div key="actions">{ActionsHub}</div>
              <div key="changes">{ChangesPanel}</div>
              <div key="assistant">{AssistantPanel}</div>
              <div key="map">
                <MapWidget />
              </div>
            </GridLayout>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}
