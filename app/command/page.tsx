"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';
const BG = "#07080B";

// ── DATA ─────────────────────────────────────────────────────────────────────

const HLNA_SUMMARY =
  "Missed bins are up 12% today in the southern region. 2 routes are at risk of breaching KPI thresholds. Fuel trends indicate a projected 5% cost increase this month — TRK-008 is the primary contributor.";

const KPIS = [
  { label: "Missed Bins Today",   value: "47",    trend: "up"   as const, trendLabel: "+12%",     trendBad: true,  spark: [22, 18, 25, 30, 28, 38, 47] },
  { label: "On-Time Collection",  value: "81%",   trend: "down" as const, trendLabel: "−6%",      trendBad: true,  spark: [92, 90, 88, 87, 85, 83, 81] },
  { label: "Active Alerts",       value: "4",     trend: "up"   as const, trendLabel: "+2 today", trendBad: true,  spark: [1, 2, 1, 2, 3, 2, 4] },
  { label: "Cost Variance",       value: "+5.2%", trend: "up"   as const, trendLabel: "vs budget",trendBad: true,  spark: [0.5, 1.2, 2.0, 3.1, 3.8, 4.5, 5.2] },
  { label: "Fleet Availability",  value: "88%",   trend: "down" as const, trendLabel: "−4% wk",   trendBad: true,  spark: [95, 94, 93, 92, 90, 89, 88] },
];

const ALERTS = [
  {
    id: "route-delays", status: "critical" as const,
    title: "Route delays exceeding KPI",
    metric: "+34 min", metricLabel: "avg delay",
    description: "Southern routes 4 and 7 running significantly over schedule.",
    action: "Reassign crew", href: "/dashboard/waste",
  },
  {
    id: "organics", status: "warning" as const,
    title: "Organics backlog forming",
    metric: "2 days", metricLabel: "behind schedule",
    description: "Zone 8 organics collection falling behind. 3 crews reassigned.",
    action: "View routes", href: "/dashboard/waste",
  },
  {
    id: "fuel", status: "warning" as const,
    title: "Fuel cost trending up",
    metric: "+5.2%", metricLabel: "vs budget",
    description: "TRK-008 distorting fleet average — maintenance review flagged.",
    action: "Open fleet", href: "/dashboard/fleet",
  },
  {
    id: "recycling", status: "stable" as const,
    title: "Recycling within target",
    metric: "64.2%", metricLabel: "diversion rate",
    description: "Overall diversion rate above the 60% monthly KPI target.",
    action: "View report", href: "/dashboard/waste",
  },
];

const SYS_STATUS = [
  { label: "Waste Collection",  status: "warn"     as const, note: "Attention"   },
  { label: "Fleet Operations",  status: "ok"       as const, note: "Operational" },
  { label: "Processing Plants", status: "warn"     as const, note: "Delayed"     },
  { label: "Complaints",        status: "critical" as const, note: "Rising"      },
  { label: "Water & Utilities", status: "ok"       as const, note: "Stable"      },
  { label: "Roads",             status: "ok"       as const, note: "Stable"      },
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
  parks: "/dashboard/parks", environment: "/dashboard/environment",
  labour: "/dashboard/labour", facilities: "/dashboard/facilities",
  logistics: "/dashboard/logistics", supply: "/dashboard/supply",
  depot: "/dashboard/depot", construction: "/dashboard/construction",
  dashboards: "/dashboards",
};

// ── STATUS STYLES ────────────────────────────────────────────────────────────

const S = {
  critical: { dot: "#EF4444", label: "Critical", bg: "rgba(239,68,68,.08)",  border: "rgba(239,68,68,.22)",  text: "#EF4444", glow: "rgba(239,68,68,.28)"  },
  warning:  { dot: "#F59E0B", label: "Warning",  bg: "rgba(245,158,11,.08)", border: "rgba(245,158,11,.22)", text: "#F59E0B", glow: "rgba(245,158,11,.24)" },
  stable:   { dot: "#22C55E", label: "Stable",   bg: "rgba(34,197,94,.08)",  border: "rgba(34,197,94,.22)",  text: "#22C55E", glow: "rgba(34,197,94,.22)"  },
  ok:       { dot: "#22C55E", color: "#22C55E"   },
  warn:     { dot: "#F59E0B", color: "#F59E0B"   },
};

// ── SPARKLINE ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const W = 60, H = 26;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const rng = max - min || 1;
  const x = (i: number) => ((i / (data.length - 1)) * W).toFixed(1);
  const y = (v: number) => (H - ((v - min) / rng) * H * 0.82 - H * 0.09).toFixed(1);
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  const fill = [`0,${H}`, ...data.map((v, i) => `${x(i)},${y(v)}`), `${W},${H}`].join(" ");
  return (
    <svg width={W} height={H} style={{ display: "block", overflow: "visible" }}>
      <polygon points={fill}   fill={color} opacity="0.09" />
      <polyline points={pts}   fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.80" />
    </svg>
  );
}

// ── ORB ──────────────────────────────────────────────────────────────────────

type OrbState = "idle" | "thinking" | "alert";

function HlnaOrb({ state }: { state: OrbState }) {
  const isAlert    = state === "alert";
  const isThinking = state === "thinking";
  return (
    <div style={{ position: "relative", width: 120, height: 120, flexShrink: 0 }}>
      {/* Outer ambient glow */}
      <div style={{
        position: "absolute", inset: -14, borderRadius: "50%",
        background: isAlert
          ? "radial-gradient(circle, rgba(239,68,68,.28) 0%, transparent 70%)"
          : "radial-gradient(circle, rgba(139,92,246,.22) 0%, transparent 70%)",
        animation: isAlert ? "orb-alert-glow 1.1s ease-in-out infinite" : "orb-outer-pulse 4s ease-in-out infinite",
        transition: "background .6s",
      }} />
      {/* Main sphere */}
      <div style={{
        width: 120, height: 120, borderRadius: "50%",
        background: isAlert
          ? "radial-gradient(circle at 35% 35%, rgba(239,68,68,.72) 0%, rgba(185,28,28,.45) 40%, rgba(127,29,29,.16) 100%)"
          : isThinking
          ? "radial-gradient(circle at 35% 35%, rgba(56,189,248,.66) 0%, rgba(99,102,241,.40) 42%, rgba(139,92,246,.12) 100%)"
          : "radial-gradient(circle at 35% 35%, rgba(167,139,250,.60) 0%, rgba(99,102,241,.34) 42%, rgba(139,92,246,.10) 100%)",
        border: isAlert
          ? "1px solid rgba(239,68,68,.48)"
          : isThinking
          ? "1px solid rgba(56,189,248,.42)"
          : "1px solid rgba(139,92,246,.40)",
        animation: isThinking
          ? "orb-thinking 2.2s linear infinite"
          : isAlert
          ? "orb-alert 1.1s ease-in-out infinite"
          : "orb-idle 4s ease-in-out infinite",
        transition: "background .7s, border-color .7s",
      }} />
      {/* Specular highlight */}
      <div style={{
        position: "absolute", top: 17, left: 19,
        width: 28, height: 17, borderRadius: "50%",
        background: "rgba(255,255,255,.22)",
        transform: "rotate(-25deg)",
        filter: "blur(3px)",
        pointerEvents: "none",
      }} />
    </div>
  );
}

// ── TYPING EFFECT ────────────────────────────────────────────────────────────

function useTyping(text: string, speed = 20) {
  const [shown, setShown] = useState("");
  const [done, setDone]   = useState(false);
  useEffect(() => {
    setShown(""); setDone(false);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setShown(text.slice(0, i));
      if (i >= text.length) { clearInterval(id); setDone(true); }
    }, speed);
    return () => clearInterval(id);
  }, [text, speed]);
  return { shown, done };
}

// ── KEYWORD HIGHLIGHTS ───────────────────────────────────────────────────────

interface HRule { re: RegExp; style: React.CSSProperties; href?: string }
const HRULES: HRule[] = [
  { re: /12%/g,     style: { color: "#EF4444", fontWeight: 600, textShadow: "0 0 10px rgba(239,68,68,.55)" } },
  { re: /2 routes/g,style: { color: "#F59E0B", fontWeight: 600 } },
  { re: /KPI/g,     style: { color: "#F59E0B", fontWeight: 600 } },
  { re: /5%/g,      style: { color: "#F59E0B", fontWeight: 600 } },
  { re: /TRK-008/g, style: { color: "#60A5FA", fontWeight: 600, textDecoration: "underline", textDecorationStyle: "dotted", textUnderlineOffset: "3px", cursor: "pointer" }, href: "/dashboard/fleet" },
];

function HighlightedText({ text }: { text: string }) {
  type Seg = { t: string; rule?: HRule };
  const segs: Seg[] = [];
  let rem = text;
  let guard = 0;
  while (rem.length && guard++ < 2000) {
    let earliest: { idx: number; match: string; rule: HRule } | null = null;
    for (const rule of HRULES) {
      rule.re.lastIndex = 0;
      const m = rule.re.exec(rem);
      if (m && (!earliest || m.index < earliest.idx)) earliest = { idx: m.index, match: m[0], rule };
    }
    if (!earliest) { segs.push({ t: rem }); break; }
    if (earliest.idx > 0) segs.push({ t: rem.slice(0, earliest.idx) });
    segs.push({ t: earliest.match, rule: earliest.rule });
    rem = rem.slice(earliest.idx + earliest.match.length);
  }
  return (
    <>
      {segs.map((s, i) =>
        s.rule ? (
          s.rule.href
            ? <Link key={i} href={s.rule.href} style={{ ...s.rule.style, display: "inline" }}>{s.t}</Link>
            : <span key={i} style={s.rule.style}>{s.t}</span>
        ) : <span key={i}>{s.t}</span>
      )}
    </>
  );
}

// ── MESSAGE TYPE ─────────────────────────────────────────────────────────────

type Msg = { role: "user" | "assistant"; text: string };

// ── PAGE ─────────────────────────────────────────────────────────────────────

export default function CommandPage() {
  const router = useRouter();
  const [orbState, setOrbState] = useState<OrbState>("idle");
  const [msgs, setMsgs]         = useState<Msg[]>([
    { role: "assistant", text: "Good morning. Monitoring all systems. 2 alerts need your attention today." },
  ]);
  const [input, setInput]       = useState("");
  const [busy, setBusy]         = useState(false);
  const [userRole, setUserRole] = useState<string>("");
  const bottomRef               = useRef<HTMLDivElement>(null);
  const { shown, done }         = useTyping(HLNA_SUMMARY, 20);

  useEffect(() => { fetch("/api/me").then(r => r.json()).then(d => setUserRole(d.role ?? "")); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    const next: Msg[] = [...msgs, { role: "user", text: t }];
    setMsgs(next); setInput(""); setBusy(true); setOrbState("thinking");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.text })),
          dashboardContext: "Command Centre — real-time municipal operations hub.",
        }),
      });
      const d = await res.json();
      setMsgs(p => [...p, { role: "assistant", text: d.response || "I couldn't process that." }]);
      setOrbState("idle");
      if (d.action === "navigate" && NAVIGATE_MAP[d.target])
        setTimeout(() => router.push(NAVIGATE_MAP[d.target]), 800);
    } catch {
      setMsgs(p => [...p, { role: "assistant", text: "I'm having trouble connecting right now." }]);
      setOrbState("alert");
      setTimeout(() => setOrbState("idle"), 3000);
    } finally { setBusy(false); }
  }

  return (
    <main style={{ minHeight: "100vh", background: BG, color: "#F5F7FA", fontFamily: FONT }}>

      {/* ── CSS ──────────────────────────────────────────────────── */}
      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes orb-idle        { 0%,100%{box-shadow:0 0 24px rgba(139,92,246,.26),inset 0 0 14px rgba(167,139,250,.06)} 50%{box-shadow:0 0 48px rgba(139,92,246,.52),inset 0 0 28px rgba(167,139,250,.16)} }
        @keyframes orb-alert       { 0%,100%{box-shadow:0 0 24px rgba(239,68,68,.32)} 50%{box-shadow:0 0 56px rgba(239,68,68,.72)} }
        @keyframes orb-thinking    { 0%{filter:hue-rotate(0deg) brightness(1)} 50%{filter:hue-rotate(50deg) brightness(1.12)} 100%{filter:hue-rotate(100deg) brightness(1)} }
        @keyframes orb-outer-pulse { 0%,100%{opacity:.45;transform:scale(1)} 50%{opacity:1;transform:scale(1.07)} }
        @keyframes orb-alert-glow  { 0%,100%{opacity:.45} 50%{opacity:1} }
        @keyframes dot-bounce      { from{transform:translateY(0);opacity:.4} to{transform:translateY(-5px);opacity:1} }
        @keyframes live-blink      { 0%,100%{opacity:1} 50%{opacity:.35} }
        @keyframes cursor-blink    { 0%,49%{opacity:1} 50%,100%{opacity:0} }
        @keyframes fade-in         { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        * { box-sizing: border-box }
        ::-webkit-scrollbar { width: 3px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: rgba(255,255,255,.10); border-radius: 3px }
      `}} />

      {/* Subtle grid */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        backgroundImage: "linear-gradient(rgba(255,255,255,.016) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.016) 1px,transparent 1px)",
        backgroundSize: "44px 44px",
      }} />
      {/* Ambient purple */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 70% 55% at 50% -5%,rgba(139,92,246,.18) 0%,transparent 65%)",
      }} />

      {/* ── NAV ─────────────────────────────────────────────────── */}
      <nav style={{
        height: 52, display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 32px", borderBottom: "1px solid rgba(255,255,255,.06)",
        background: "rgba(7,8,11,.88)", backdropFilter: "blur(16px)",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <Link href="/" style={{ fontWeight: 700, fontSize: 14, color: "#F5F7FA", textDecoration: "none", letterSpacing: ".04em" }}>
            BR<span style={{ color: "#A78BFA" }}>Λ</span>INBASE
          </Link>
          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "rgba(255,255,255,.22)", letterSpacing: ".03em" }}>
            <span>Command Centre</span>
            <span>/</span>
            <span>Operations</span>
            <span>/</span>
            <span style={{ color: "rgba(167,139,250,.70)" }}>Today</span>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "3px 10px", borderRadius: 20,
            background: "rgba(139,92,246,.14)", border: "1px solid rgba(139,92,246,.30)",
          }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 5px #22C55E", animation: "live-blink 2.4s ease-in-out infinite" }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#C4B5FD", letterSpacing: ".03em" }}>Command Centre</span>
          </div>
          <Link href="/dashboards"
            style={{ fontSize: 13, color: "rgba(255,255,255,.40)", textDecoration: "none", fontWeight: 500, transition: "color .15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,.80)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,.40)")}>
            Dashboards
          </Link>
          <Link href="/dashboard"
            style={{ fontSize: 13, color: "rgba(255,255,255,.40)", textDecoration: "none", fontWeight: 500, transition: "color .15s" }}
            onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,.80)")}
            onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,.40)")}>
            HLN<span style={{ color: "#A78BFA" }}>Λ</span>
          </Link>
          {userRole === "super_admin" && (
            <Link href="/admin/users"
              style={{ fontSize: 13, color: "rgba(255,255,255,.40)", textDecoration: "none", fontWeight: 500, transition: "color .15s" }}
              onMouseEnter={e => (e.currentTarget.style.color = "rgba(255,255,255,.80)")}
              onMouseLeave={e => (e.currentTarget.style.color = "rgba(255,255,255,.40)")}>
              Users
            </Link>
          )}
        </div>
      </nav>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "22px 32px 96px", position: "relative", zIndex: 1 }}>

        {/* ── KPI STRIP ────────────────────────────────────────── */}
        <section style={{
          display: "grid", gridTemplateColumns: "repeat(5,1fr)",
          borderRadius: 14, overflow: "hidden",
          border: "1px solid rgba(255,255,255,.07)",
          marginBottom: 18,
        }}>
          {KPIS.map((kpi, i) => {
            const color = kpi.trendBad ? "#EF4444" : "#22C55E";
            return (
              <div key={kpi.label} style={{
                padding: "18px 20px",
                background: "rgba(7,8,11,.82)",
                backdropFilter: "blur(12px)",
                borderRight: i < KPIS.length - 1 ? "1px solid rgba(255,255,255,.06)" : "none",
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".10em", color: "rgba(255,255,255,.28)", textTransform: "uppercase", marginBottom: 10 }}>
                  {kpi.label}
                </div>
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 36, fontWeight: 700, letterSpacing: "-.04em", color: "#F5F7FA", lineHeight: 1, marginBottom: 7 }}>
                      {kpi.value}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, color }}>
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

        {/* ── HLNA HERO ────────────────────────────────────────── */}
        <section style={{
          padding: "28px 32px",
          borderRadius: 16,
          background: "rgba(139,92,246,.055)",
          border: "1px solid rgba(139,92,246,.16)",
          backdropFilter: "blur(20px)",
          marginBottom: 14,
          position: "relative", overflow: "hidden",
        }}>
          {/* Glow blob */}
          <div style={{
            position: "absolute", top: -130, right: -130,
            width: 400, height: 400, borderRadius: "50%", pointerEvents: "none",
            background: "radial-gradient(circle,rgba(139,92,246,.22) 0%,transparent 65%)",
          }} />

          <div style={{ display: "flex", alignItems: "center", gap: 40, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 320px" }}>
              {/* Live badge */}
              <div style={{
                display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 16,
                padding: "4px 12px", borderRadius: 20,
                background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.28)",
              }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 6px #22C55E", animation: "live-blink 2.4s ease-in-out infinite" }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: "rgba(167,139,250,.90)", letterSpacing: ".10em", textTransform: "uppercase" }}>
                  HLNΛ · Live Analysis
                </span>
              </div>

              {/* Summary — typing then highlighted */}
              <p style={{ fontSize: "clamp(15px,1.6vw,20px)", lineHeight: 1.78, color: "#E6EDF3", margin: "0 0 22px", maxWidth: 680 }}>
                {done
                  ? <HighlightedText text={HLNA_SUMMARY} />
                  : <>{shown}<span style={{ borderRight: "2px solid #A78BFA", animation: "cursor-blink .8s step-end infinite", marginLeft: 1 }} /></>
                }
              </p>

              {/* Action buttons */}
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link href="/dashboard/waste" style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "rgba(239,68,68,.14)", border: "1px solid rgba(239,68,68,.32)",
                  color: "#FCA5A5", textDecoration: "none", letterSpacing: ".02em", transition: "all .15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(239,68,68,.24)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(239,68,68,.22)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(239,68,68,.14)"; e.currentTarget.style.boxShadow = "none"; }}>
                  View impacted routes
                </Link>
                <button onClick={() => alert("Alert resolution workflow coming soon.")} style={{
                  padding: "9px 18px", borderRadius: 8, fontSize: 12, fontWeight: 600,
                  background: "rgba(139,92,246,.14)", border: "1px solid rgba(139,92,246,.32)",
                  color: "#C4B5FD", cursor: "pointer", fontFamily: FONT, letterSpacing: ".02em", transition: "all .15s",
                }}
                  onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,.24)"; e.currentTarget.style.boxShadow = "0 0 18px rgba(139,92,246,.22)"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,.14)"; e.currentTarget.style.boxShadow = "none"; }}>
                  Resolve alerts
                </button>
              </div>
            </div>

            {/* Orb + state label */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
              <HlnaOrb state={orbState} />
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".14em", color: "rgba(167,139,250,.85)", textTransform: "uppercase" }}>
                  HLN<span style={{ color: "#A78BFA" }}>Λ</span>
                </div>
                <div style={{ fontSize: 9, color: orbState === "thinking" ? "rgba(56,189,248,.75)" : orbState === "alert" ? "rgba(239,68,68,.75)" : "rgba(34,197,94,.70)", letterSpacing: ".06em", marginTop: 4, textTransform: "uppercase", transition: "color .4s" }}>
                  {orbState === "thinking" ? "Processing…" : orbState === "alert" ? "Alert mode" : "Monitoring systems"}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── SYSTEM STATUS STRIP ──────────────────────────────── */}
        <section style={{
          display: "grid", gridTemplateColumns: "repeat(6,1fr)",
          borderRadius: 10, overflow: "hidden",
          border: "1px solid rgba(255,255,255,.06)",
          marginBottom: 18,
        }}>
          {SYS_STATUS.map((sys, i) => {
            const color = sys.status === "ok" ? "#22C55E" : sys.status === "warn" ? "#F59E0B" : "#EF4444";
            const note  = sys.note;
            return (
              <div key={sys.label} style={{
                padding: "10px 14px",
                background: "rgba(7,8,11,.80)", backdropFilter: "blur(8px)",
                borderRight: i < SYS_STATUS.length - 1 ? "1px solid rgba(255,255,255,.05)" : "none",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}`, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.65)", lineHeight: 1.25 }}>{sys.label}</div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".06em", color, textTransform: "uppercase", marginTop: 1 }}>{note}</div>
                </div>
              </div>
            );
          })}
        </section>

        {/* ── MAIN CONTENT ─────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 16, alignItems: "start" }}>

          {/* LEFT: Action Cards + HLNA Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

            {/* ── ACTION CARDS ────────────────────────────────── */}
            <section>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: ".12em", color: "rgba(255,255,255,.28)", textTransform: "uppercase" }}>
                  Active Alerts
                </div>
                <span style={{ fontSize: 11, color: "rgba(239,68,68,.70)", fontWeight: 600 }}>
                  2 require immediate action
                </span>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: 10 }}>
                {ALERTS.map(alert => {
                  const s = S[alert.status];
                  return (
                    <div key={alert.id} style={{
                      padding: "18px", borderRadius: 12,
                      background: s.bg, border: `1px solid ${s.border}`,
                      backdropFilter: "blur(8px)",
                      display: "flex", flexDirection: "column", gap: 10,
                      transition: "all .18s", cursor: "default",
                    }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLDivElement).style.boxShadow = `0 8px 32px ${"glow" in s ? s.glow : "transparent"}`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.boxShadow = ""; }}
                    >
                      {/* Badge */}
                      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                        <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.dot, boxShadow: `0 0 7px ${s.dot}`, flexShrink: 0 }} />
                        <span style={{ fontSize: 10, fontWeight: 700, color: s.text, letterSpacing: ".09em", textTransform: "uppercase" }}>{("label" in s) ? s.label : ""}</span>
                      </div>
                      {/* Title */}
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#F5F7FA", lineHeight: 1.35 }}>{alert.title}</div>
                      {/* Big metric */}
                      <div>
                        <div style={{ fontSize: 34, fontWeight: 700, letterSpacing: "-.04em", color: s.text, lineHeight: 1 }}>{alert.metric}</div>
                        <div style={{ fontSize: 10, color: "rgba(255,255,255,.32)", marginTop: 3, letterSpacing: ".04em" }}>{alert.metricLabel}</div>
                      </div>
                      {/* Description */}
                      <div style={{ fontSize: 11, color: "rgba(230,237,243,.44)", lineHeight: 1.55 }}>{alert.description}</div>
                      {/* Action */}
                      <Link href={alert.href} style={{
                        display: "block", padding: "8px 14px", borderRadius: 7,
                        background: `${s.dot}18`, border: `1px solid ${s.dot}38`,
                        fontSize: 12, fontWeight: 600, color: s.text,
                        textDecoration: "none", textAlign: "center",
                        letterSpacing: ".02em", transition: "all .15s",
                      }}
                        onMouseEnter={e => { e.currentTarget.style.background = `${s.dot}2A`; e.currentTarget.style.boxShadow = `0 0 14px ${"glow" in s ? s.glow : "transparent"}`; }}
                        onMouseLeave={e => { e.currentTarget.style.background = `${s.dot}18`; e.currentTarget.style.boxShadow = ""; }}>
                        {alert.action} →
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* ── HLNA ASSISTANT ──────────────────────────────── */}
            <section style={{
              borderRadius: 14, overflow: "hidden",
              background: "rgba(7,8,11,.72)",
              border: "1px solid rgba(255,255,255,.07)",
              backdropFilter: "blur(16px)",
            }}>
              <div style={{
                padding: "11px 16px", borderBottom: "1px solid rgba(255,255,255,.05)",
                background: "rgba(139,92,246,.04)",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 5px #22C55E" }} />
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".10em", color: "rgba(255,255,255,.55)", textTransform: "uppercase" }}>
                  HLN<span style={{ color: "#A78BFA" }}>Λ</span> Assistant
                </span>
                <span style={{ fontSize: 9, color: "rgba(255,255,255,.20)", letterSpacing: ".06em", textTransform: "uppercase" }}>· Ask anything</span>
              </div>

              {/* Messages */}
              <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10, minHeight: 160, maxHeight: 240, overflowY: "auto" }}>
                {msgs.map((m, i) => (
                  <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", animation: "fade-in .2s ease" }}>
                    <div style={{
                      maxWidth: "84%", padding: "9px 13px", borderRadius: 9,
                      fontSize: 13, lineHeight: 1.6,
                      background: m.role === "user" ? "rgba(255,255,255,.06)" : "rgba(99,102,241,.16)",
                      border: m.role === "user" ? "1px solid rgba(255,255,255,.08)" : "1px solid rgba(99,102,241,.26)",
                      color: "rgba(255,255,255,.88)",
                    }}>
                      {m.text}
                    </div>
                  </div>
                ))}
                {busy && (
                  <div style={{ display: "flex" }}>
                    <div style={{ padding: "10px 14px", borderRadius: 9, background: "rgba(99,102,241,.10)", border: "1px solid rgba(99,102,241,.20)", display: "flex", gap: 5, alignItems: "center" }}>
                      {[0, 1, 2].map(j => <div key={j} style={{ width: 5, height: 5, borderRadius: "50%", background: "#A78BFA", animation: `dot-bounce .9s ${j * .15}s ease-in-out infinite alternate` }} />)}
                    </div>
                  </div>
                )}
                <div ref={bottomRef} />
              </div>

              {/* Suggested prompts */}
              <div style={{ padding: "0 16px 10px", display: "flex", gap: 6, flexWrap: "wrap" }}>
                {SUGGESTED.map(p => (
                  <button key={p} onClick={() => send(p)} style={{
                    padding: "5px 11px", borderRadius: 20, fontSize: 11, fontWeight: 500,
                    background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
                    color: "rgba(230,237,243,.50)", cursor: "pointer", transition: "all .15s",
                    whiteSpace: "nowrap", fontFamily: FONT,
                  }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,.14)"; e.currentTarget.style.color = "#C4B5FD"; e.currentTarget.style.borderColor = "rgba(139,92,246,.28)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.color = "rgba(230,237,243,.50)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.07)"; }}>
                    {p}
                  </button>
                ))}
              </div>

              {/* Input */}
              <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,.05)", display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  placeholder="Ask HLNΛ anything…"
                  style={{
                    flex: 1, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
                    borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#F5F7FA",
                    outline: "none", fontFamily: FONT, transition: "border-color .15s",
                  }}
                  onFocus={e => (e.currentTarget.style.borderColor = "rgba(139,92,246,.45)")}
                  onBlur={e =>  (e.currentTarget.style.borderColor = "rgba(255,255,255,.07)")}
                />
                <button onClick={() => send(input)} disabled={!input.trim() || busy} style={{
                  width: 36, height: 36, borderRadius: 8, flexShrink: 0,
                  background: input.trim() ? "rgba(139,92,246,.28)" : "rgba(255,255,255,.04)",
                  border: `1px solid ${input.trim() ? "rgba(139,92,246,.44)" : "rgba(255,255,255,.07)"}`,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  cursor: input.trim() ? "pointer" : "default", transition: "all .15s",
                }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke={input.trim() ? "#C4B5FD" : "rgba(255,255,255,.20)"}
                    strokeWidth="2" strokeLinecap="round">
                    <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
                  </svg>
                </button>
              </div>
            </section>
          </div>

          {/* RIGHT: Action Hub + 24h Changes */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>

            {/* ── ACTION HUB ──────────────────────────────────── */}
            <section style={{
              borderRadius: 14, overflow: "hidden",
              background: "rgba(7,8,11,.72)",
              border: "1px solid rgba(255,255,255,.07)",
              backdropFilter: "blur(16px)",
            }}>
              <div style={{ padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(255,255,255,.015)" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.42)", textTransform: "uppercase" }}>
                  Operational Actions
                </div>
              </div>

              <div style={{ padding: "12px" }}>
                {/* Immediate */}
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.20)", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>Immediate</div>
                {([
                  { label: "Resolve Alerts",   href: "/dashboard/waste",  color: "#EF4444", bg: "rgba(239,68,68,.10)",  border: "rgba(239,68,68,.25)",  icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> },
                  { label: "Reassign Routes",  href: "/dashboard/waste",  color: "#F59E0B", bg: "rgba(245,158,11,.10)", border: "rgba(245,158,11,.25)", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 014-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 01-4 4H3"/></svg> },
                  { label: "Dispatch Crew",    href: "/dashboard/fleet",  color: "#60A5FA", bg: "rgba(59,130,246,.10)", border: "rgba(59,130,246,.25)", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> },
                ] as { label: string; href: string; color: string; bg: string; border: string; icon: React.ReactNode }[]).map(btn => (
                  <Link key={btn.label} href={btn.href} style={{ textDecoration: "none", display: "block", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 9, background: btn.bg, border: `1px solid ${btn.border}`, cursor: "pointer", transition: "all .15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.transform = "translateX(2px)"; (e.currentTarget as HTMLDivElement).style.filter = "brightness(1.12)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.transform = ""; (e.currentTarget as HTMLDivElement).style.filter = ""; }}>
                      <span style={{ color: btn.color, flexShrink: 0 }}>{btn.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: btn.color, flex: 1 }}>{btn.label}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={btn.color} strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </Link>
                ))}

                <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "10px 0" }} />

                {/* Reporting */}
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.20)", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>Reporting</div>
                {([
                  { label: "Generate Monthly Report", action: () => alert("Report generation coming soon."), icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg> },
                  { label: "Export Data",              action: () => alert("Export coming soon."),           icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> },
                ] as { label: string; action: () => void; icon: React.ReactNode }[]).map(btn => (
                  <button key={btn.label} onClick={btn.action} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 9, width: "100%", textAlign: "left", background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.08)", cursor: "pointer", transition: "all .15s", fontFamily: FONT, marginBottom: 6 }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.07)"; (e.currentTarget as HTMLElement).style.transform = "translateX(2px)"; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,.04)"; (e.currentTarget as HTMLElement).style.transform = ""; }}>
                    <span style={{ color: "rgba(255,255,255,.40)", flexShrink: 0 }}>{btn.icon}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(230,237,243,.58)", flex: 1 }}>{btn.label}</span>
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                ))}

                <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "10px 0" }} />

                {/* Navigation */}
                <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.20)", textTransform: "uppercase", marginBottom: 8, paddingLeft: 2 }}>Navigation</div>
                {([
                  { label: "Waste Dashboard", href: "/dashboard/waste", color: "#34D399", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg> },
                  { label: "Fleet Dashboard", href: "/dashboard/fleet", color: "#60A5FA", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg> },
                  { label: "All Dashboards",  href: "/dashboards",      color: "rgba(167,139,250,.75)", icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
                ] as { label: string; href: string; color: string; icon: React.ReactNode }[]).map(btn => (
                  <Link key={btn.label} href={btn.href} style={{ textDecoration: "none", display: "block", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 13px", borderRadius: 9, background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.07)", cursor: "pointer", transition: "all .15s" }}
                      onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.06)"; (e.currentTarget as HTMLDivElement).style.transform = "translateX(2px)"; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = "rgba(255,255,255,.03)"; (e.currentTarget as HTMLDivElement).style.transform = ""; }}>
                      <span style={{ color: btn.color, flexShrink: 0 }}>{btn.icon}</span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "rgba(230,237,243,.60)", flex: 1 }}>{btn.label}</span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.22)" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            {/* ── LAST 24 HOURS ────────────────────────────────── */}
            <section style={{
              borderRadius: 14, overflow: "hidden",
              background: "rgba(7,8,11,.72)",
              border: "1px solid rgba(255,255,255,.07)",
              backdropFilter: "blur(16px)",
            }}>
              <div style={{ padding: "13px 16px", borderBottom: "1px solid rgba(255,255,255,.06)", background: "rgba(255,255,255,.015)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".12em", color: "rgba(255,255,255,.42)", textTransform: "uppercase" }}>
                  Last 24 Hours
                </div>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#22C55E", boxShadow: "0 0 5px #22C55E", animation: "live-blink 2.4s ease-in-out infinite" }} />
              </div>
              <div style={{ padding: "10px 14px" }}>
                {CHANGES.map((c, i) => {
                  const bad   = c.dir === "up";
                  const color = bad ? "#EF4444" : "#22C55E";
                  return (
                    <div key={c.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 4px", borderBottom: i < CHANGES.length - 1 ? "1px solid rgba(255,255,255,.04)" : "none" }}>
                      <div style={{ width: 22, height: 22, borderRadius: 6, background: `${color}14`, border: `1px solid ${color}28`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 11, color }}>
                        {c.dir === "up" ? "↑" : "↓"}
                      </div>
                      <span style={{ fontSize: 12, color: "rgba(230,237,243,.65)", flex: 1 }}>{c.label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color }}>{c.delta}</span>
                    </div>
                  );
                })}
              </div>
            </section>

          </div>
        </div>
      </div>
    </main>
  );
}
