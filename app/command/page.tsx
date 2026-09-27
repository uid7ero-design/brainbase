"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import GridLayout from "react-grid-layout";
import type { Layout, LayoutItem } from "react-grid-layout";
import { HlnaOrb } from "@/components/brand/HlnaOrb";
import WorkspaceShell from "@/components/ops/WorkspaceShell";
import HlnaBriefingWidget from "@/components/ops/widgets/HlnaBriefingWidget";
import WeatherWidget from "@/components/ops/widgets/WeatherWidget";
import MapWidget from "@/components/ops/widgets/MapWidget";
import DrilldownDrawer, { type DrawerAlert } from "@/components/ops/DrilldownDrawer";
import FinancialTab from "./financial";
import {
  Badge, Button, Metric, MetricStrip, StateMessage, TableContainer,
  buttonProps, fieldControlClassName, tableStyles,
} from "@/components/ui/app";
import { useChartPalette } from "@/components/ui/app/chartPalette";
import styles from "./command.module.css";

const LAYOUT_KEY = "ops-workspace-layout-v1";
// Command keeps its desktop density: below this width the overview canvas
// scrolls horizontally inside itself instead of crushing 12 columns.
const MIN_GRID_WIDTH = 720;

// ── DATA ─────────────────────────────────────────────────────────────────────


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

const TABS = [
  { id: "overview",   label: "Overview"          },
  { id: "financial",  label: "Financial"          },
  { id: "waste",      label: "Waste Intelligence" },
  { id: "debtors",    label: "Debtors"            },
  { id: "kerbside",   label: "Kerbside"           },
  { id: "dumping",    label: "Illegal Dumping"    },
  { id: "crm",        label: "CRM / Requests"     },
  { id: "sports",     label: "Sporting Clubs"     },
];

const ACTIVE_FY = "2025-26";

// ── STATUS STYLES ────────────────────────────────────────────────────────────
// Phase D2: one semantic mapping for every status on this page. Colour
// comes from the app status tokens (command.module.css `.tone`), and every
// status is also written as text — colour is never the only signal.

type StatusKey = "critical" | "warning" | "stable" | "ok" | "warn";

const S: Record<StatusKey, { tone: "danger" | "warning" | "success"; badge: "error" | "warning" | "success"; label: string }> = {
  critical: { tone: "danger",  badge: "error",   label: "Critical" },
  warning:  { tone: "warning", badge: "warning", label: "Warning"  },
  stable:   { tone: "success", badge: "success", label: "Stable"   },
  ok:       { tone: "success", badge: "success", label: "OK"       },
  warn:     { tone: "warning", badge: "warning", label: "Warning"  },
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
// Colours come from the JS chart palette (SVG attributes cannot resolve the
// theme's CSS variables reliably), so the line keeps contrast in both themes.

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 60, H = 26;
  const min = Math.min(...data); const max = Math.max(...data); const rng = max - min || 1;
  const x = (i: number) => ((i / (data.length - 1)) * W).toFixed(1);
  const y = (v: number) => (H - ((v - min) / rng) * H * 0.82 - H * 0.09).toFixed(1);
  const pts  = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const fill = [`0,${H}`, ...data.map((v, i) => `${x(i)},${y(v)}`), `${W},${H}`].join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }} aria-hidden="true" focusable="false">
      <polygon points={fill} fill={color} opacity="0.12" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  // Honest label: this counts seconds since mount, it does not reflect an
  // actual data refresh — was previously "Updated {txt}", which read as a
  // live-refresh timestamp.
  return <span className={styles.liveAgo}>Demo · {txt}</span>;
}

// ── MESSAGE TYPE ─────────────────────────────────────────────────────────────

type Msg = { role: "user" | "assistant"; text: string };
type OrbState = "idle" | "thinking" | "alert";
type PipelineItem = { id: string; type: string; title: string; description: string | null; org_name: string | null; created_at: string; status: string };

// ── KPI STRIP (live data) ────────────────────────────────────────────────────
// Phase D2: rendered with the shared MetricStrip/Metric. Values, trend
// labels, trend rules and spark series are unchanged (see the audit's
// hard-coded KPI list — "Fleet Avail.", the completion fallback and the
// spark histories are static and left exactly as they were).

type KpiEntry = { label: string; value: string | number; trend: "up" | "down"; trendLabel: string; trendBad: boolean };

function KpiStrip() {
  const chart = useChartPalette();
  const [kpis, setKpis] = useState<Record<string, Record<string, number>>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    async function load() {
      const endpoints: Record<string, string> = {
        kerbside: `/api/missed-collections/kpi?fy=${ACTIVE_FY}`,
        dumping:  `/api/illegal-dumping/kpi?fy=${ACTIVE_FY}`,
        waste:    `/api/waste/kpi?fy=${ACTIVE_FY}`,
      };
      const results: Record<string, Record<string, number>> = {};
      await Promise.allSettled(
        Object.entries(endpoints).map(async ([key, url]) => {
          try {
            const res = await fetch(url, { credentials: "include" });
            if (res.ok) results[key] = ((await res.json()) as { data?: Record<string, number> }).data ?? {};
          } catch { results[key] = {}; }
        })
      );
      if (alive) { setKpis(results); setLoading(false); }
    }
    load();
    return () => { alive = false; };
  }, []);

  const missed     = kpis.kerbside?.missedCount ?? 0;
  const completion = kpis.kerbside?.completionRate ?? 81;
  const incidents  = kpis.dumping?.totalIncidents ?? 0;
  const diversion  = Math.round(kpis.waste?.diversionRate ?? 0);

  const KPI_DATA: KpiEntry[] = [
    { label: "Missed Bins",    value: missed,              trend: missed > 30 ? "up" : "down",         trendLabel: `${Math.round(missed / 10)}% of sched.`, trendBad: true  },
    { label: "On-Time",        value: `${Math.round(completion)}%`, trend: completion > 85 ? "up" : "down", trendLabel: completion > 85 ? "+2%" : "−6%",   trendBad: completion < 85 },
    { label: "Active Alerts",  value: incidents,           trend: "up",                                trendLabel: `+${incidents > 5 ? 2 : 1} today`,      trendBad: true  },
    { label: "Diversion Rate", value: `${diversion}%`,     trend: diversion > 60 ? "up" : "down",      trendLabel: "vs 60% target",                         trendBad: diversion < 60 },
    { label: "Fleet Avail.",   value: "88%",               trend: "down",                              trendLabel: "−4% wk",                                trendBad: true  },
  ];

  const sparks: number[][] = [
    [22, 18, 25, 30, 28, 38, missed],
    [92, 90, 88, 87, 85, 83, completion],
    [1, 2, 1, 2, 3, 2, incidents],
    [55, 58, 60, 62, 61, 63, diversion],
    [95, 94, 93, 92, 90, 89, 88],
  ];

  return (
    <MetricStrip style={{ height: "100%", gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}>
      {KPI_DATA.map((kpi, i) => (
        <Metric
          key={kpi.label}
          label={kpi.label}
          value={kpi.value}
          loading={loading}
          change={{ label: kpi.trendLabel, direction: kpi.trend, tone: kpi.trendBad ? "danger" : "success" }}
          visual={<Sparkline data={sparks[i]} color={kpi.trendBad ? chart.danger : chart.success} />}
        />
      ))}
    </MetricStrip>
  );
}

// ── ICONS ────────────────────────────────────────────────────────────────────

const Chevron = ({ dir = "right" }: { dir?: "right" | "down" | "left" }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" focusable="false">
    <polyline points={dir === "down" ? "6 9 12 15 18 9" : dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
  </svg>
);

// ── PAGE ─────────────────────────────────────────────────────────────────────

export default function CommandPage() {
  const router = useRouter();
  const resizeObserver = useRef<ResizeObserver | null>(null);
  const [gridWidth, setGridWidth] = useState(900);
  const [layout, setLayout] = useState<LayoutItem[]>(DEFAULT_LAYOUT);
  const [editMode, setEditMode] = useState(false);
  const [ribbonExpanded, setRibbonExpanded] = useState<string | null>(null);
  const [orbState, setOrbState]         = useState<OrbState>("idle");
  const [drawerAlert, setDrawerAlert]   = useState<DrawerAlert | null>(null);
  const [pipelineAlerts, setPipelineAlerts] = useState<PipelineItem[]>([]);
  const [activeTab, setActiveTab] = useState("overview");
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  // Init tab from URL + sync URL on change
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    if (tab && TABS.some(t => t.id === tab)) setActiveTab(tab);
  }, []);

  function handleTabChange(tabId: string) {
    setActiveTab(tabId);
    const url = new URL(window.location.href);
    if (tabId === "overview") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tabId);
    window.history.replaceState(null, "", url.pathname + url.search);
  }

  // Tabs keyboard pattern (WAI-ARIA): arrows / Home / End move between tabs.
  function handleTabKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let next = -1;
    if (e.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    handleTabChange(TABS[next].id);
    tabRefs.current[TABS[next].id]?.focus();
  }

  useEffect(() => {
    fetch('/api/admin/pipeline', { credentials: 'include' })
      .then(r => r.ok ? r.json() : { requests: [] })
      .then((d: { requests?: PipelineItem[] }) => {
        const newItems = (d.requests ?? []).filter((r: PipelineItem & { status: string }) => r.status === 'new');
        setPipelineAlerts(newItems);
      })
      .catch(() => {});
  }, []);

  const [msgs, setMsgs] = useState<Msg[]>([
    { role: "assistant", text: "Good morning. Monitoring all systems. 2 alerts need your attention today." },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevMsgCount = useRef(msgs.length);

  // Responsive grid width. A callback ref (not a mount-time effect): the
  // canvas only exists once WorkspaceShell has mounted and while the
  // Overview tab is shown, so a [] effect never found it and the grid stayed
  // at its 900px default (clipped on narrow screens, half-width on wide
  // ones). Phase D2 layout fix; the grid's own behaviour is unchanged.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    resizeObserver.current?.disconnect();
    resizeObserver.current = null;
    if (!el) return;
    const ro = new ResizeObserver(entries => setGridWidth(entries[0].contentRect.width));
    ro.observe(el);
    resizeObserver.current = ro;
  }, []);
  useEffect(() => () => resizeObserver.current?.disconnect(), []);

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

  function handleAlertAction(alertId: string, action: string, payload?: Record<string, unknown>) {
    fetch(`/api/ops/alerts/${alertId}/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action, ...payload }),
    }).catch(() => {});
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: t }];
    setMsgs(next); setInput(""); setBusy(true); setOrbState("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
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

  const StatusRibbon = (
    <section className={styles.ribbon} aria-label="System status">
      {SYS_STATUS.map(sys => {
        const s = S[sys.status];
        const isOpen = ribbonExpanded === sys.label;
        return (
          <button
            key={sys.label}
            type="button"
            className={`${styles.ribbonCell} ${styles.tone}`}
            data-status={s.tone}
            aria-expanded={isOpen}
            onClick={() => setRibbonExpanded(isOpen ? null : sys.label)}
          >
            <span className={styles.dot} aria-hidden="true" />
            <span className={styles.ribbonText}>
              <span className={styles.ribbonLabel}>{sys.label}</span>
              <span className={`${styles.ribbonNote} ${styles.statusText}`}>{sys.note}</span>
              {isOpen && <span className={styles.ribbonDetail}>{sys.detail}</span>}
            </span>
            <span className={styles.chevron}><Chevron dir="down" /></span>
          </button>
        );
      })}
    </section>
  );

  const totalAlertCount = ALERTS.filter(a => a.status === "critical" || a.status === "warning").length + pipelineAlerts.length;

  const AlertsGrid = (
    <section className={styles.panel} aria-labelledby="cc-alerts-title">
      <div className={styles.panelHeader}>
        <h2 id="cc-alerts-title" className={styles.panelTitle}>
          Active Alerts
          {pipelineAlerts.length > 0 && (
            <Badge state="info">{pipelineAlerts.length} client request{pipelineAlerts.length !== 1 ? "s" : ""}</Badge>
          )}
        </h2>
        <span className={styles.panelMeta} data-tone="danger">{totalAlertCount} require attention</span>
      </div>
      <div className={styles.panelBody}>
        {/* Client pipeline requests */}
        {pipelineAlerts.length > 0 && (
          <div>
            <h3 className={styles.sectionLabel}>Client Requests</h3>
            <div className={styles.cardGrid}>
              {pipelineAlerts.map(item => (
                <article key={item.id} className={`${styles.alertCard} ${styles.tone}`} data-status="info" style={{ cursor: "default" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Badge state="info">{item.type === "issue" ? "Issue" : item.type === "feedback" ? "Feedback" : "Request"}</Badge>
                    {item.org_name && <span className={styles.alertMetricLabel} style={{ marginLeft: "auto" }}>{item.org_name}</span>}
                  </div>
                  <div className={styles.alertTitle}>{item.title}</div>
                  {item.description && <div className={styles.alertDescription}>{item.description}</div>}
                  <Link href="/admin/pipeline" {...buttonProps("secondary", "sm")} className={`${buttonProps("secondary", "sm").className} ${styles.alertAction}`}>
                    Respond →
                  </Link>
                </article>
              ))}
            </div>
            <div className={styles.divider} />
          </div>
        )}
        {/* Operational alerts — static sample data (see the ALERTS
            constant), unlike the real Client Requests above sourced from
            /api/admin/pipeline. Labelled so the two don't blend together
            in one "Active Alerts" panel with no way to tell which is
            which. */}
        <h3 className={styles.sectionLabel}>
          Operational Alerts
          <span className={styles.demoTag}>DEMO</span>
        </h3>
        <div className={styles.cardGrid}>
          {ALERTS.map(alert => {
            const s = S[alert.status];
            const open = () => setDrawerAlert({ id: alert.id, title: alert.title, status: alert.status, metric: alert.metric, metricLabel: alert.metricLabel, description: alert.description });
            return (
              <article key={alert.id} className={`${styles.alertCard} ${styles.tone}`} data-status={s.tone} onClick={open}>
                <Badge state={s.badge}>{s.label}</Badge>
                <button type="button" className={styles.alertOpen} aria-haspopup="dialog" onClick={e => { e.stopPropagation(); open(); }}>
                  <span className={styles.alertTitle}>{alert.title}</span>
                  <span>
                    <span className={styles.alertMetric} style={{ display: "block" }}>{alert.metric}</span>
                    <span className={styles.alertMetricLabel}>{alert.metricLabel}</span>
                  </span>
                </button>
                <div className={styles.alertDescription}>{alert.description}</div>
                <Link href={alert.href}
                  onClick={e => e.stopPropagation()}
                  {...buttonProps("secondary", "sm")}
                  className={`${buttonProps("secondary", "sm").className} ${styles.alertAction}`}>
                  {alert.action} →
                </Link>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );

  const ActionsHub = (
    <section className={styles.panel} aria-labelledby="cc-actions-title">
      <div className={styles.panelHeader}>
        <h2 id="cc-actions-title" className={styles.panelTitle}>Operational Actions</h2>
      </div>
      <div className={styles.panelBody}>
        <ul className={styles.actionList}>
          {([
            { label: "Resolve Alerts",  href: "/dashboard/waste", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
            { label: "Reassign Routes", href: "/dashboard/waste", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> },
            { label: "Dispatch Crew",   href: "/dashboard/fleet", icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
          ] as { label: string; href: string; icon: React.ReactNode }[]).map(btn => (
            <li key={btn.label}>
              <Link href={btn.href} className={styles.actionRow}>
                {btn.icon}
                <span>{btn.label}</span>
                <Chevron />
              </Link>
            </li>
          ))}
        </ul>
        <div className={styles.divider} />
        <ul className={styles.actionList}>
          {([
            { label: "Monthly Report", action: () => alert("Coming soon."), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg> },
            { label: "Export Data",    action: () => alert("Coming soon."), icon: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
          ] as { label: string; action: () => void; icon: React.ReactNode }[]).map(btn => (
            <li key={btn.label}>
              <button type="button" onClick={btn.action} className={styles.actionRow} data-secondary="">
                {btn.icon}
                <span>{btn.label}</span>
                <Chevron />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );

  const ChangesPanel = (
    <section className={styles.panel} aria-labelledby="cc-changes-title">
      <div className={styles.panelHeader}>
        <h2 id="cc-changes-title" className={styles.panelTitle}>Last 24 Hours</h2>
      </div>
      <div className={styles.panelBody}>
        <ul className={styles.changeList}>
          {CHANGES.map(c => {
            const bad = c.dir === "up";
            return (
              <li key={c.label} className={`${styles.changeRow} ${styles.tone}`} data-status={bad ? "danger" : "success"}>
                <span className={styles.statusText} aria-hidden="true">{c.dir === "up" ? "▲" : "▼"}</span>
                <span className={styles.changeLabel}>{c.label}</span>
                <span className={styles.changeDelta}>
                  {c.delta}
                  <span className={styles.srOnly}>{c.dir === "up" ? ", up" : ", down"}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );

  // HLNA assistant — the orb is a functional state visual (idle / thinking),
  // kept exactly as HlnaOrb renders it; only the extra glow wrapper and the
  // legacy "HLNΛ" wordmark treatment were removed.
  const AssistantPanel = (
    <section className={styles.panel} aria-labelledby="cc-assistant-title">
      <div className={styles.panelHeader}>
        <h2 id="cc-assistant-title" className={styles.panelTitle}>
          HLNA Assistant
          <span style={{ fontWeight: 500, letterSpacing: 0, textTransform: "none", color: "var(--text-subtle)" }}>· Ask anything</span>
        </h2>
        <HlnaOrb size={28} state={orbState === "alert" ? "idle" : orbState} speechRef={undefined} style={undefined} />
      </div>
      <div className={styles.chatLog} role="log" aria-live="polite" aria-label="Conversation with HLNA">
        {msgs.map((m, i) => (
          <div key={i} className={styles.msg} data-role={m.role}>
            <div className={styles.bubble}>
              <span className={styles.srOnly}>{m.role === "user" ? "You: " : "HLNA: "}</span>
              {m.text}
            </div>
          </div>
        ))}
        {busy && (
          <div className={styles.msg}>
            <div className={styles.typing} role="status">
              <span aria-hidden="true" /><span aria-hidden="true" /><span aria-hidden="true" />
              <span className={styles.srOnly}>HLNA is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
      <div className={styles.suggestions}>
        {SUGGESTED.map(p => (
          <button key={p} type="button" className={styles.suggestion} onClick={() => send(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className={styles.composer}>
        <label htmlFor="cc-assistant-input" className={styles.srOnly}>Message HLNA</label>
        <input id="cc-assistant-input" value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
          placeholder="Ask HLNA anything…"
          className={fieldControlClassName}
        />
        <Button variant={input.trim() ? "primary" : "secondary"} size="sm" onClick={() => send(input)} disabled={!input.trim() || busy} aria-label="Send message">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </Button>
      </div>
    </section>
  );

  // ── RENDER ───────────────────────────────────────────────────────────────

  return (
    <>
    <WorkspaceShell title="Command Centre" alertCount={totalAlertCount} intelRail>
      <style dangerouslySetInnerHTML={{ __html: `
        /* react-grid-layout */
        .react-grid-layout{position:relative;transition:height 200ms ease}
        .react-grid-item{transition:all 200ms ease;transition-property:left,top,width,height;box-sizing:border-box}
        .react-grid-item.cssTransforms{transition-property:transform,width,height}
        .react-grid-item.resizing{will-change:width,height;z-index:4}
        .react-grid-item.react-draggable-dragging{transition:none;z-index:5;will-change:transform;cursor:grabbing!important;box-shadow:var(--shadow-popover);border-radius:var(--radius-lg)}
        .react-grid-item.react-grid-placeholder{background:var(--brand-brainbase-accent-muted);border:1px dashed var(--brand-brainbase-accent-border);border-radius:var(--radius-lg);opacity:1;transition-duration:100ms;z-index:2}
        .react-grid-item>.react-resizable-handle{position:absolute;width:20px;height:20px;bottom:0;right:0;cursor:se-resize;opacity:0;transition:opacity .2s}
        .react-grid-item:hover>.react-resizable-handle{opacity:1}
        .react-grid-item>.react-resizable-handle::after{content:"";position:absolute;right:4px;bottom:4px;width:6px;height:6px;border-right:1.5px solid var(--border-strong);border-bottom:1.5px solid var(--border-strong)}
        .edit-mode .react-grid-item:not(.react-grid-placeholder){outline:1px dashed var(--brand-brainbase-accent-border);outline-offset:-1px;cursor:grab}
        @media (prefers-reduced-motion: reduce){.react-grid-layout,.react-grid-item{transition:none}}
      `}} />

      {/* ── Workspace toolbar ── */}
      <div className={styles.toolbar}>
        <Link href="/dashboard" className={styles.crumbLink}>
          <Chevron dir="left" />
          Dashboard
        </Link>
        <span className={styles.crumbSep} aria-hidden="true">/</span>
        <div className={styles.crumbs}>
          <span>Command Centre</span><span className={styles.crumbSep} aria-hidden="true">/</span><span className={styles.crumbCurrent}>Operations</span>
        </div>
        {/* Global demo-environment indicator — Command Centre mixes real,
            organisation-scoped KPI data (waste/kerbside/dumping/CRM tabs,
            all fetched from live API routes) with entirely static sample
            content (alerts, system status, changes feed — see the
            panel-level tags below). One clear marker here, rather than
            labelling every row, per this round's own preferred approach.
            This lives in command/page.tsx only, not the shared
            WorkspaceShell component — bin-maintenance (a real operational
            page using the same shell) must not be affected. */}
        <span className={styles.demoTag}>
          Demo Environment
        </span>
        <div className={styles.toolbarSpacer} />
        <Link href="/command/organiser" className={styles.crumbLink}>
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          Organiser
        </Link>
        <div className={styles.toolbarDivider} />
        <LiveAgo baseSeconds={3} />
        {activeTab === "overview" && (
          <>
            <div className={styles.toolbarDivider} />
            {editMode && (
              <Button size="sm" onClick={resetLayout}>
                Reset layout
              </Button>
            )}
            <Button size="sm" variant={editMode ? "primary" : "secondary"} aria-pressed={editMode} onClick={() => setEditMode(p => !p)}>
              {editMode ? "✓ Done" : "⊞ Edit workspace"}
            </Button>
          </>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div className={styles.tabs} role="tablist" aria-label="Command Centre views">
        {TABS.map((tab, index) => {
          const selected = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              ref={el => { tabRefs.current[tab.id] = el; }}
              type="button"
              role="tab"
              id={`cc-tab-${tab.id}`}
              aria-selected={selected}
              aria-controls="cc-tabpanel"
              tabIndex={selected ? 0 : -1}
              className={styles.tab}
              onClick={() => handleTabChange(tab.id)}
              onKeyDown={e => handleTabKey(e, index)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* ── Tab content ── */}
      {activeTab === "overview" ? (
        /* Overview: full GridLayout dashboard */
        <div ref={containerRef} id="cc-tabpanel" role="tabpanel" aria-labelledby="cc-tab-overview" className={styles.canvas}>
          {gridWidth > 0 && (
            <div className={editMode ? "edit-mode" : ""}>
              <GridLayout
                layout={layout}
                width={Math.max(gridWidth - 32, MIN_GRID_WIDTH)}
                gridConfig={{ cols: 12, rowHeight: 32, margin: [10, 10], containerPadding: [0, 0] }}
                dragConfig={{ enabled: editMode, handle: ".widget-drag-handle" }}
                resizeConfig={{ enabled: editMode }}
                onLayoutChange={handleLayoutChange}
              >
                <div key="kpi"><KpiStrip /></div>
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
      ) : (
        <div id="cc-tabpanel" role="tabpanel" aria-labelledby={`cc-tab-${activeTab}`} tabIndex={0} className={styles.tabPanel}>
          {activeTab === "financial" && <FinancialTab />}
          {activeTab === "waste"     && <WasteIntelligenceTab />}
          {activeTab === "debtors"   && <DebtorsTab />}
          {activeTab === "kerbside"  && <KerbsideTab />}
          {activeTab === "dumping"   && <IllegalDumpingTab />}
          {activeTab === "crm"       && <CRMTab />}
          {activeTab === "sports"    && <SportingClubsTab />}
        </div>
      )}
    </WorkspaceShell>
    {drawerAlert && (
      <DrilldownDrawer
        alert={drawerAlert}
        onClose={() => setDrawerAlert(null)}
        onAction={handleAlertAction}
      />
    )}
    </>
  );
}

// ━━━ ANALYTICS TAB COMPONENTS ━━━
// Phase D2: each tab is a heading + MetricStrip (+ a Phase C table where
// the data has rows). Colour appears only where a value carries a state
// (thresholds, severities, statuses); the rest are neutral figures.

function tabFetch(endpoint: string): Promise<Record<string, unknown>> {
  return fetch(`/api/${endpoint}/kpi?fy=${ACTIVE_FY}`, { credentials: "include" })
    .then(r => r.ok ? r.json() : { data: {} })
    .then((j: { data?: Record<string, unknown> }) => j.data ?? {})
    .catch(() => ({}));
}

function TabLoading({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.tabBody}>
      <StateMessage kind="loading" title={children} />
    </div>
  );
}

const WasteIntelligenceTab = React.memo(function WasteIntelligenceTab() {
  const [data, setData] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    tabFetch("waste").then(d => { if (alive) { setData(d as typeof data); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading waste intelligence...</TabLoading>;
  const dr = Math.round(data.diversionRate ?? 0);
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>Waste Intelligence</h2>
      <MetricStrip>
        <Metric label="Total Waste" value={Math.round(data.totalWaste ?? 0)} sub="tonnes" />
        <Metric label="Recycling" value={Math.round(data.totalRecycling ?? 0)} sub="tonnes" />
        <Metric label="Organics" value={Math.round(data.totalOrganics ?? 0)} sub="tonnes" />
        <Metric label="Diversion Rate" value={`${dr}%`} tone={dr > 60 ? "success" : "warning"} sub={dr > 60 ? "Above 60% target" : "Below 60% target"} />
      </MetricStrip>
    </div>
  );
});

type Debtor = { account: string; amount: number; daysOverdue: number; status: string };

const DebtorsTab = React.memo(function DebtorsTab() {
  const [data, setData] = useState<{ totalOutstanding?: number; count?: number; avgDaysOverdue?: number; recoveryRate?: number; topDebtors?: Debtor[] }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    tabFetch("debtors").then(d => { if (alive) { setData(d as typeof data); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading debtors...</TabLoading>;
  const rr = Math.round(data.recoveryRate ?? 0);
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>Debtors Management</h2>
      <MetricStrip>
        <Metric label="Total Outstanding" value={`$${Number(data.totalOutstanding ?? 0).toLocaleString()}`} />
        <Metric label="Debtor Count" value={String(data.count ?? 0)} />
        <Metric label="Avg Days Overdue" value={String(Math.round(data.avgDaysOverdue ?? 0))} />
        <Metric label="Recovery Rate" value={`${rr}%`} tone={rr > 50 ? "success" : "danger"} sub={rr > 50 ? "Above 50%" : "At or below 50%"} />
      </MetricStrip>
      {(data.topDebtors?.length ?? 0) > 0 && (
        <div>
          <h3 className={styles.subTitle}>Top Debtors</h3>
          <TableContainer label="Top debtors" minWidth={480}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Account</th>
                  <th scope="col" className={tableStyles.num}>Amount</th>
                  <th scope="col" className={tableStyles.num}>Days Overdue</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.topDebtors!.map((d, i) => (
                  <tr key={i}>
                    <td className={tableStyles.primary}>{d.account}</td>
                    <td className={tableStyles.num}>${d.amount.toLocaleString()}</td>
                    <td className={tableStyles.num}>{d.daysOverdue}</td>
                    <td><Badge state={d.status === "OPEN" ? "error" : "success"}>{d.status}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </div>
      )}
    </div>
  );
});

const KerbsideTab = React.memo(function KerbsideTab() {
  const [data, setData] = useState<{ totalScheduled?: number; missedCount?: number; completionRate?: number; slaCompliance?: number }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    tabFetch("missed-collections").then(d => { if (alive) { setData(d as typeof data); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading kerbside operations...</TabLoading>;
  const cr = Math.round(data.completionRate ?? 0);
  const sl = Math.round(data.slaCompliance ?? 0);
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>Kerbside Operations</h2>
      <MetricStrip>
        <Metric label="Total Scheduled" value={String(data.totalScheduled ?? 0)} />
        <Metric label="Missed Collections" value={String(data.missedCount ?? 0)} />
        <Metric label="Completion Rate" value={`${cr}%`} tone={cr > 95 ? "success" : "warning"} sub={cr > 95 ? "Above 95%" : "At or below 95%"} />
        <Metric label="SLA Compliance" value={`${sl}%`} tone={sl > 90 ? "success" : "danger"} sub={sl > 90 ? "Above 90%" : "At or below 90%"} />
      </MetricStrip>
    </div>
  );

});

// ━━━ ADDITIONAL TABS ━━━

const IllegalDumpingTab = React.memo(function IllegalDumpingTab() {
  const [data, setData] = useState<{
    totalIncidents?: number; recoveryRate?: number;
    topSuburbs?: { suburb: string; count: number }[];
    severityBreakdown?: { CRITICAL: number; HIGH: number; MEDIUM: number; LOW: number };
  }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    tabFetch("illegal-dumping").then(d => { if (alive) { setData(d as typeof data); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading illegal dumping data...</TabLoading>;
  const rr = Math.round(data.recoveryRate ?? 0);
  const sb = data.severityBreakdown;
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>Illegal Dumping</h2>
      <MetricStrip>
        <Metric label="Total Incidents" value={data.totalIncidents ?? 0} />
        <Metric label="Recovery Rate" value={`${rr}%`} tone={rr > 50 ? "success" : "danger"} sub={rr > 50 ? "Above 50%" : "At or below 50%"} />
      </MetricStrip>
      {(data.topSuburbs?.length ?? 0) > 0 && (
        <div>
          <h3 className={styles.subTitle}>Top Suburbs</h3>
          <MetricStrip>
            {data.topSuburbs!.map((s, i) => (
              <Metric key={i} label={s.suburb} value={s.count} sub="incidents" />
            ))}
          </MetricStrip>
        </div>
      )}
      {sb && (
        <div>
          <h3 className={styles.subTitle}>Severity Breakdown</h3>
          <MetricStrip>
            <Metric label="CRITICAL" value={sb.CRITICAL ?? 0} tone="danger" />
            <Metric label="HIGH" value={sb.HIGH ?? 0} tone="warning" />
            <Metric label="MEDIUM" value={sb.MEDIUM ?? 0} tone="success" />
            <Metric label="LOW" value={sb.LOW ?? 0} tone="info" />
          </MetricStrip>
        </div>
      )}
    </div>
  );
});

const CRMTab = React.memo(function CRMTab() {
  type CRMRequest = { requestId?: string; category?: string; status?: string; daysRequestOpen?: number; deadlinePassed?: boolean };
  const [requests, setRequests] = useState<CRMRequest[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    try {
      const stored = localStorage.getItem(`onk_cc_crm_${ACTIVE_FY}`);
      if (stored) setRequests((JSON.parse(stored) as { requests?: CRMRequest[] }).requests ?? []);
    } catch { /* ignore */ }
    if (alive) setLoading(false);
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading CRM requests...</TabLoading>;
  const openCount    = requests.filter(r => r.status === "Active").length;
  const overdueCount = requests.filter(r => r.deadlinePassed).length;
  const avgDaysOpen  = requests.length > 0 ? Math.round(requests.reduce((s, r) => s + (r.daysRequestOpen ?? 0), 0) / requests.length) : 0;
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>CRM / Requests</h2>
      <MetricStrip>
        <Metric label="Total Requests" value={String(requests.length)} />
        <Metric label="Open" value={String(openCount)} />
        <Metric label="Overdue" value={String(overdueCount)} tone={overdueCount > 0 ? "danger" : "success"} sub={overdueCount > 0 ? "Past deadline" : "None overdue"} />
        <Metric label="Avg Days Open" value={String(avgDaysOpen)} />
      </MetricStrip>
      {requests.length > 0 && (
        <div>
          <h3 className={styles.subTitle}>Recent Requests</h3>
          <TableContainer label="Recent requests" minWidth={440}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">ID</th>
                  <th scope="col">Category</th>
                  <th scope="col">Status</th>
                  <th scope="col" className={tableStyles.num}>Days Open</th>
                </tr>
              </thead>
              <tbody>
                {requests.slice(0, 10).map((r, i) => (
                  <tr key={i}>
                    <td className={tableStyles.primary}>{r.requestId?.slice(0, 8)}</td>
                    <td>{r.category}</td>
                    <td>{r.status && <Badge state={r.status === "Active" ? "info" : "success"}>{r.status}</Badge>}</td>
                    <td className={tableStyles.num}>{r.daysRequestOpen ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </div>
      )}
    </div>
  );
});

type SportActivity = { name: string; participants: number; spectators: number; visitors: number };

const SportingClubsTab = React.memo(function SportingClubsTab() {
  const [data, setData] = useState<{ totalActivities?: number; totalParticipants?: number; totalSpectators?: number; totalVisitors?: number; byActivity?: SportActivity[] }>({});
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    tabFetch("sports").then(d => { if (alive) { setData(d as typeof data); setLoading(false); } });
    return () => { alive = false; };
  }, []);
  if (loading) return <TabLoading>Loading sporting clubs data...</TabLoading>;
  return (
    <div className={styles.tabBody}>
      <h2 className={styles.tabTitle}>Sporting Clubs</h2>
      <MetricStrip>
        <Metric label="Total Activities" value={String(data.totalActivities ?? 0)} />
        <Metric label="Total Participants" value={(data.totalParticipants ?? 0).toLocaleString()} />
        <Metric label="Spectators/Week" value={(data.totalSpectators ?? 0).toLocaleString()} />
        <Metric label="Total Visitors" value={(data.totalVisitors ?? 0).toLocaleString()} />
      </MetricStrip>
      {(data.byActivity?.length ?? 0) > 0 && (
        <div>
          <h3 className={styles.subTitle}>Sports Breakdown</h3>
          <TableContainer label="Sports breakdown" minWidth={480}>
            <table className={tableStyles.table}>
              <thead>
                <tr>
                  <th scope="col">Sport</th>
                  <th scope="col" className={tableStyles.num}>Participants</th>
                  <th scope="col" className={tableStyles.num}>Spectators/Week</th>
                  <th scope="col" className={tableStyles.num}>Visitors/Week</th>
                </tr>
              </thead>
              <tbody>
                {data.byActivity!.map((a, i) => (
                  <tr key={i}>
                    <td className={tableStyles.primary}>{a.name}</td>
                    <td className={tableStyles.num}>{a.participants.toLocaleString()}</td>
                    <td className={tableStyles.num}>{a.spectators.toLocaleString()}</td>
                    <td className={tableStyles.num}>{a.visitors.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableContainer>
        </div>
      )}
    </div>
  );
});
