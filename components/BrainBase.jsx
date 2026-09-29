'use client';

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useHelena } from "../hooks/useHelena";
import { resolveRoute } from "../lib/dashboard/registry";
import { useSpotify } from "../hooks/useSpotify";
import { useTasks } from "../hooks/useTasks";
import { useCalendar } from "../hooks/useCalendar";
import { useAppStore } from "../lib/state/useAppStore";
import { HlnaOrb } from "./brand/HlnaOrb";
import { HelenaOrbital } from "./brand/HelenaOrbital";
import { LeftSidebar } from "./layout/LeftSidebar";
import { FloatingCard } from "./cards/FloatingCard";
import { ActivityPanel } from "./panels/ActivityPanel";
import { MemoryPanel } from "./panels/MemoryPanel";
import { BrainGraphPanel } from "./panels/BrainGraphPanel";
import { NewsPanel } from "./panels/NewsPanel";
import { IntegrationsPanel } from "./panels/IntegrationsPanel";
import { InboxPanel } from "./panels/InboxPanel";
import { ContactsPanel } from "./panels/ContactsPanel";
import { ChatPanel } from "./chat/ChatPanel";
import { MicButton } from "./voice/MicButton";
import { MorningBriefing } from "./hlna/MorningBriefing";
import { RecommendedActions } from "./hlna/RecommendedActions";
import { ModuleAccessCard } from "./dashboard/ModuleAccessCard";
import { CommandSuggestions } from "./hlna/CommandSuggestions";
import { KEYFRAMES } from "../lib/utils/constants";
import { getDeptConfig } from "../lib/hlna/departmentConfigs";
import { buttonProps } from "./ui/app/Button";

// Visual (authenticated visual-completion pass): this shell's own chrome —
// page, header, controls, the HLNA operator panel, the ask input and the
// transcript overlay — is on app tokens so it reads in light and dark. The
// decorative vignette, ambient/halo radial glows, glow shadows, gradient
// accent bars and backdrop blur were removed; HelenaOrbital (and the text
// state label beside it) carry the assistant state. MODULE_COLORS below is
// a per-module category encoding (dots only; text stays --text-primary).
// The private mapHelenaPhaseToVisualState copy is deliberately untouched.

// Looping status pulse, switched off under prefers-reduced-motion.
const BRAINBASE_MOTION_CSS = `
  .bb-hlna-pulse { animation: agentPulse 1.2s ease-in-out infinite; }
  .bb-hlna-pulse-alert { animation: agentPulse 1.5s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) {
    .bb-hlna-pulse, .bb-hlna-pulse-alert { animation: none; }
  }
`;

const MODULE_COLORS = {
  waste_recycling:   '#34D399',
  fleet_management:  '#38BDF8',
  service_requests:  '#FBBF24',
  logistics_freight: '#F97316',
  utilities:         '#818CF8',
  construction:      '#FB7185',
};

// Orb state labels
const ORB_STATE_LABEL = {
  idle:       { label: 'ACTIVE',     color: 'var(--text-secondary)' },
  listening:  { label: 'LISTENING',  color: 'var(--status-info)' },
  processing: { label: 'THINKING',   color: 'var(--status-warning)' },
  speaking:   { label: 'SPEAKING',   color: 'var(--brand-brainbase-accent)' },
  alert:      { label: 'DETECTING',  color: 'var(--status-danger)' },
};

// Phase C — Hybrid Orbit / HelenaOrbital integration.
// Flip to false to instantly revert the main Helena orb to the legacy
// HlnaOrb visual without touching anything else below.
const USE_HELENA_ORBITAL = true;

// Maps the existing, authoritative useHelena.js phase machine (orbPhase:
// 'idle'|'listening'|'processing'|'speaking') plus the pre-existing
// dashboard-anomaly override (orbAlert, from useAppStore, set by
// InsightBanner) onto HelenaOrbital's HelenaVisualState. This relabels the
// same signals ORB_STATE_LABEL already keys off of — no new state, no new
// transitions. 'error' reflects the existing orbAlert override, preserved
// for visual parity with the prior 'alert' HlnaOrb state; useHelena.js
// exposes no genuine voice/API error phase today (see Phase C report).
function mapHelenaPhaseToVisualState(orbPhase, orbAlert) {
  if (orbAlert) return 'error';
  if (orbPhase === 'processing') return 'thinking';
  if (orbPhase === 'speaking') return 'speaking';
  if (orbPhase === 'listening') return 'listening';
  return 'idle';
}

function AskInput({ onSend }) {
  const [val, setVal] = useState('');
  return (
    <form
      onSubmit={e => { e.preventDefault(); const q = val.trim(); if (q) { onSend(q); setVal(''); } }}
      style={{ width: '100%', display: 'flex', gap: 6, padding: '0 2px' }}
    >
      <input
        value={val}
        onChange={e => setVal(e.target.value)}
        placeholder="Ask HLNA…"
        aria-label="Ask HLNA"
        style={{
          flex: 1, background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-md)', padding: '7px 11px', fontSize: 12, color: 'var(--text-primary)',
          fontFamily: 'inherit', minWidth: 0,
        }}
      />
      <button
        type="submit"
        aria-label="Send to HLNA"
        {...buttonProps('primary', 'sm')}
        style={{ flexShrink: 0 }}
      >
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}

/** @param {{ enabledCapabilities?: string[], isSuperAdmin?: boolean }} props */
export default function BrainBase({ enabledCapabilities = [], isSuperAdmin = false }) {
  const router   = useRouter();
  const helena   = useHelena();
  const spotify  = useSpotify();
  const tasks    = useTasks();
  const calendar = useCalendar();

  const orbSpeechRef = useRef(null);

  const {
    sidebarOpen,  toggleSidebar,
    panelOpen,    togglePanel,
    chatOpen,     setChatOpen, toggleChat,
    items,        latestId,
    cards,        addCard,    removeCard,
    llmSource,    toggleBrainGraph,
    activeModule, setActiveModule,
    enabledModules, setEnabledModules,
    orbAlert,
    viewMode,     setViewMode,
    fireHelena,   activeDepartment,
  } = useAppStore();

  // ── Load enabled modules ─────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        if (data.enabledModules?.length) {
          setEnabledModules(data.enabledModules);
          if (!activeModule) setActiveModule(data.enabledModules[0].key);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Speech → orb sync ────────────────────────────────────────────────
  useEffect(() => {
    helena.speechPulseRef.current = (v) => orbSpeechRef.current?.(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dashboard navigation ─────────────────────────────────────────────
  useEffect(() => {
    helena.navRef.current = (target) => {
      const route = resolveRoute(target);
      if (route) router.push(route);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wake word ────────────────────────────────────────────────────────
  useEffect(() => {
    helena.enableWakeWord();
    return () => helena.disableWakeWord();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Spotify context ──────────────────────────────────────────────────
  useEffect(() => {
    if (spotify.loading) return;
    if (spotify.connected && spotify.track) {
      helena.spotifyContextRef.current =
        `Connected. ${spotify.isPlaying ? 'Now playing' : 'Paused'}: "${spotify.track.name}" by ${spotify.track.artist} from album "${spotify.track.album}".`;
    } else if (spotify.connected) {
      helena.spotifyContextRef.current = 'Connected. Nothing currently playing.';
    } else {
      helena.spotifyContextRef.current = 'Not connected.';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify.connected, spotify.isPlaying, spotify.track, spotify.loading]);

  // ── Task controls ────────────────────────────────────────────────────
  useEffect(() => {
    helena.taskControlRef.current = {
      add:            tasks.add,
      completeByText: tasks.completeByText,
      clearDone:      tasks.clearDone,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.add, tasks.completeByText, tasks.clearDone]);

  // ── Calendar context ─────────────────────────────────────────────────
  useEffect(() => {
    if (calendar.loading) return;
    if (calendar.connected && calendar.events.length > 0) {
      const lines = calendar.events.map(ev => {
        const time = ev.allDay ? 'all day' : new Date(ev.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `- ${time}: ${ev.title}`;
      });
      helena.calendarContextRef.current = `Connected (${(calendar.accounts ?? []).join(', ')}). Today:\n${lines.join('\n')}`;
    } else if (calendar.connected) {
      helena.calendarContextRef.current = `Connected (${(calendar.accounts ?? []).join(', ')}). No events today.`;
    } else {
      helena.calendarContextRef.current = 'Not connected.';
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.connected, calendar.events, calendar.loading]);

  useEffect(() => {
    helena.calendarControlRef.current = { create: calendar.createEvent };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calendar.createEvent]);

  // ── Spotify controls ─────────────────────────────────────────────────
  useEffect(() => {
    helena.spotifyControlRef.current = {
      play:  spotify.play,
      pause: spotify.pause,
      next:  spotify.next,
      prev:  spotify.prev,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify.play, spotify.pause, spotify.next, spotify.prev]);

  // ── Floating card on Helena response ────────────────────────────────
  useEffect(() => {
    const last = helena.messages[helena.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    addCard({
      id:    Date.now(),
      type:  last.meta?.intent ?? 'insight',
      title: last.content.slice(0, 60) + (last.content.length > 60 ? '…' : ''),
      sub:   'HLNA · just now',
      time:  'now',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helena.messages.length]);

  // ── Keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); toggleChat(); return; }
      if (e.key === 'Escape') { setChatOpen(false); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleChat, setChatOpen]);

  // ── Push-to-talk: hold Space ─────────────────────────────────────────
  useEffect(() => {
    let held = false;
    function onDown(e) {
      if (e.code !== 'Space' || held) return;
      if (e.target.tagName.match(/INPUT|TEXTAREA|SELECT/i)) return;
      if (helena.conversational) return;
      e.preventDefault(); held = true; helena.startListening();
    }
    function onUp(e) {
      if (e.code !== 'Space' || !held) return;
      e.preventDefault(); held = false; helena.stopAndSend();
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helena.conversational]);

  const orbState     = orbAlert ? 'alert' : helena.orbPhase;
  const orbLabel     = ORB_STATE_LABEL[orbState] ?? ORB_STATE_LABEL.idle;
  const helenaVisualState = mapHelenaPhaseToVisualState(helena.orbPhase, orbAlert);
  const activeModColor = activeModule ? (MODULE_COLORS[activeModule] ?? 'var(--brand-brainbase-accent)') : 'var(--brand-brainbase-accent)';
  const activeModName  = enabledModules.find(m => m.key === activeModule)?.name ?? 'Select module';

  // Active operator state — derived from current department config
  const deptConfig      = getDeptConfig(activeDepartment ?? 'waste');
  const hasHighAlerts   = deptConfig.alerts.some(a => a.severity === 'high');
  const priorityActions = deptConfig.actions.filter(a => a.urgency === 'high');
  const primaryAction   = priorityActions[0] ?? deptConfig.actions[0];

  return (
    <div style={{
      height: "100vh", overflow: "hidden",
      background: "var(--bg-base)", color: "var(--text-primary)",
      fontFamily: "var(--bb-font-sans)", position: "relative", display: "flex", flexDirection: "column",
    }}>
      {/* Page heading for assistive tech: this /dashboard fallback shell has no
          other h1 (the header shows the wordmark). Visually hidden, so layout is
          unchanged. */}
      <h1 className="bb-visually-hidden">Dashboard</h1>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{
        height: 50, flexShrink: 0, zIndex: 30, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        background: "var(--bg-surface)",
        borderBottom: "1px solid var(--border)",
        gap: 10,
      }}>
        {/* Left — toggle + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label="Toggle sidebar"
            aria-expanded={!!sidebarOpen}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "var(--text-secondary)", lineHeight: 0, borderRadius: "var(--radius-sm)" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "var(--text-primary)", userSelect: "none", whiteSpace: "nowrap" }}>
            BR<span style={{ color: "var(--brand-brainbase-accent)" }}>Λ</span>INBASE
          </span>
          {enabledModules.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 6 }}>
              <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: activeModColor }} />
              <select
                value={activeModule ?? ''}
                onChange={e => setActiveModule(e.target.value)}
                aria-label="Active module"
                style={{
                  background: "var(--bg-raised)", border: "1px solid var(--border-strong)",
                  borderRadius: "var(--radius-md)", color: "var(--text-primary)", fontSize: 12, fontWeight: 600,
                  padding: "3px 7px", cursor: "pointer", fontFamily: "inherit",
                }}
              >
                {enabledModules.map(m => (
                  <option key={m.key} value={m.key}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Centre — Exec / Ops toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 2, background: "var(--bg-sunken)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: 2, flexShrink: 0 }}>
          {['executive', 'operational'].map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => setViewMode(mode)}
              aria-pressed={viewMode === mode}
              style={{
                padding: "3px 10px", borderRadius: "var(--radius-sm)", fontSize: 11, fontWeight: 700,
                letterSpacing: "0.04em", cursor: "pointer", border: "none",
                background: viewMode === mode ? "var(--brand-brainbase-accent-muted)" : "transparent",
                color: viewMode === mode ? "var(--brand-brainbase-accent)" : "var(--text-secondary)",
                textTransform: "capitalize", fontFamily: "inherit",
              }}
            >
              {mode === 'executive' ? '◈ Exec' : '⚙ Ops'}
            </button>
          ))}
        </div>

        {/* Right — HLNA state pill + graph + profile */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 5,
            padding: "4px 10px", borderRadius: 999,
            background: "var(--bg-sunken)", border: "1px solid var(--border)",
          }}>
            <div
              aria-hidden="true"
              className={helena.listening || helena.responding ? "bb-hlna-pulse" : undefined}
              style={{ width: 6, height: 6, borderRadius: "50%", background: orbLabel.color }}
            />
            <span style={{
              fontSize: 10, fontWeight: 700, letterSpacing: ".10em",
              color: orbLabel.color, textTransform: "uppercase",
            }}>
              HLNΛ {orbLabel.label}
            </span>
          </div>

          <button
            type="button"
            onClick={toggleBrainGraph}
            title="Performance Graph"
            {...buttonProps('secondary', 'sm')}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Performance
          </button>

          <a
            href="/account/profile"
            title="Profile"
            aria-label="Profile"
            style={{
              width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--bg-raised)", border: "1px solid var(--border-strong)",
              color: "var(--text-secondary)", textDecoration: "none", fontSize: 12, fontWeight: 700,
            }}
          >
            <span aria-hidden="true">◎</span>
          </a>
        </div>
      </header>

      {/* ── Main shell ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10 }}>
        <LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} isSuperAdmin={isSuperAdmin} />

        {/* ── Command Hub centre ─────────────────────────────────────────── */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column" }}>

          {/* Scrollable content */}
          <div style={{
            flex: 1, overflowY: "auto", overflowX: "hidden",
            display: "flex", flexDirection: "column", alignItems: "center",
            padding: "8px 24px 130px",
            scrollbarWidth: "none",
          }}>

            {/* Command module — constrained to 920px max */}
            <div style={{ width: "100%", maxWidth: 920, display: "flex", flexDirection: "column", gap: 14 }}>

              {/* ① TOP SPLIT: Briefing (left 62%) + HLNA Orb panel (right 38%) */}
              <div style={{ display: "flex", gap: 14, alignItems: "stretch" }}>

                {/* LEFT — Operations Briefing */}
                <div style={{ flex: "62", minWidth: 0 }}>
                  <MorningBriefing />
                </div>

                {/* RIGHT — HLNA Active Operator */}
                <div style={{
                  flex: "38", minWidth: 0,
                  display: "flex", flexDirection: "column", alignItems: "center",
                  padding: "16px 14px 14px",
                  borderRadius: "var(--radius-lg)",
                  background: "var(--bg-surface)",
                  border: hasHighAlerts
                    ? "1px solid var(--status-danger-border)"
                    : "1px solid var(--border)",
                  boxShadow: hasHighAlerts
                    ? "inset 3px 0 0 var(--status-danger)"
                    : "inset 3px 0 0 var(--brand-brainbase-accent)",
                  position: "relative", overflow: "hidden",
                }}>

                  {/* ── Wordmark + live detection state ── */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, width: "100%" }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: ".28em", color: "var(--text-muted)", textTransform: "uppercase" }}>
                      HLN<span style={{ color: "var(--brand-brainbase-accent)" }}>Λ</span>
                    </span>
                    <div aria-hidden="true" style={{ width: 1, height: 10, background: "var(--border-strong)", flexShrink: 0 }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div
                        aria-hidden="true"
                        className={hasHighAlerts ? "bb-hlna-pulse-alert" : (helena.listening || helena.responding ? "bb-hlna-pulse" : undefined)}
                        style={{ width: 6, height: 6, borderRadius: "50%", background: hasHighAlerts ? "var(--status-danger)" : orbLabel.color }}
                      />
                      <span style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: ".12em",
                        color: hasHighAlerts ? "var(--status-danger)" : orbLabel.color,
                        textTransform: "uppercase",
                      }}>
                        {hasHighAlerts && (orbState === "idle" || orbState === "alert") ? "ISSUE DETECTED" : orbLabel.label}
                      </span>
                    </div>
                  </div>

                  {/* ── Orb ── */}
                  <div style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: 10 }}>
                    {USE_HELENA_ORBITAL ? (
                      <HelenaOrbital size={120} state={helenaVisualState} speechRef={orbSpeechRef} />
                    ) : (
                      <HlnaOrb size={120} state={orbState} speechRef={orbSpeechRef} />
                    )}
                  </div>

                  {/* ── Active intelligence content ── */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                    {hasHighAlerts ? (
                      <>
                        {/* Detection card */}
                        <div style={{
                          padding: "10px 12px", borderRadius: "var(--radius-md)",
                          background: "var(--status-danger-muted)",
                          border: "1px solid var(--status-danger-border)",
                        }}>
                          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: "var(--status-danger)", textTransform: "uppercase", marginBottom: 5 }}>
                            HLNΛ detected an issue
                          </div>
                          <p style={{ margin: 0, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
                            {deptConfig.briefing.action}
                          </p>
                        </div>

                        {/* Priority actions reference */}
                        {priorityActions.length > 0 && (
                          <div style={{
                            padding: "8px 10px", borderRadius: "var(--radius-md)",
                            background: "var(--bg-sunken)",
                            border: "1px solid var(--border)",
                          }}>
                            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".10em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
                              I've identified {priorityActions.length} priority action{priorityActions.length !== 1 ? "s" : ""}
                            </div>
                            {priorityActions.slice(0, 2).map(action => (
                              <div key={action.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                                <span aria-hidden="true" style={{ color: "var(--brand-brainbase-accent)", fontSize: 11, flexShrink: 0, marginTop: 1 }}>→</span>
                                <span style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.4 }}>{action.title}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Execute Action — primary */}
                        <button
                          type="button"
                          onClick={() => { fireHelena(primaryAction.command); setChatOpen(true); }}
                          {...buttonProps('primary')}
                          style={{ width: "100%" }}
                        >
                          ⚡ Execute Action
                        </button>

                        {/* Review Details — secondary */}
                        <button
                          type="button"
                          onClick={() => { fireHelena(`Analyse the current situation and give me a detailed briefing on ${deptConfig.label} performance, priority issues, and recommended actions.`); setChatOpen(true); }}
                          {...buttonProps('secondary')}
                          style={{ width: "100%" }}
                        >
                          Review Details / Analyse
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Idle state */}
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".18em", color: orbLabel.color, textTransform: "uppercase" }}>
                            {orbLabel.label}
                          </div>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: "4px 0 0", lineHeight: 1.4 }}>
                            All systems normal. No priority issues detected.
                          </p>
                          {activeModule && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "3px 10px", borderRadius: 20, background: "var(--bg-sunken)", border: "1px solid var(--border)" }}>
                              <div aria-hidden="true" style={{ width: 6, height: 6, borderRadius: "50%", background: activeModColor }} />
                              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".10em", color: "var(--text-primary)", textTransform: "uppercase" }}>{activeModName}</span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => { fireHelena(`Give me today's full operations briefing for ${deptConfig.label}.`); setChatOpen(true); }}
                          {...buttonProps('primary')}
                          style={{ width: "100%" }}
                        >
                          Run Briefing
                        </button>
                      </>
                    )}
                  </div>

                  {/* Spacer — pushes input to bottom */}
                  <div style={{ flex: 1 }} />

                  {/* ── Input + Explore further ── */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                    <div aria-hidden="true" style={{ height: 1, background: "var(--border)" }} />
                    <AskInput onSend={(q) => { helena.sendMessage(q); setChatOpen(true); }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".12em", color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 6 }}>
                        Explore further
                      </div>
                      <CommandSuggestions panelMode />
                    </div>
                  </div>

                </div>
              </div>

              {/* Module access — capability-gated entry points (e.g. Events
                  & Ticketing) for whatever this organisation is actually
                  entitled to. Renders nothing when no module is enabled —
                  see ModuleAccessCard's own comment. */}
              <ModuleAccessCard enabledCapabilities={enabledCapabilities} />

              {/* ② RECOMMENDED ACTIONS */}
              <RecommendedActions />

            </div>
          </div>

          {/* Floating response cards */}
          <div style={{ position: "absolute", bottom: 100, left: 16, display: "flex", flexDirection: "column-reverse", gap: 8, zIndex: 20, pointerEvents: "none" }}>
            {cards.slice(-2).map(c => (
              <div key={c.id} style={{ pointerEvents: "auto" }}>
                <FloatingCard card={c} onDismiss={() => removeCard(c.id)} />
              </div>
            ))}
          </div>

          {/* Transcript overlay */}
          {helena.transcript && (
            <div style={{
              position: "absolute", bottom: 168, left: "50%", transform: "translateX(-50%)",
              zIndex: 22, maxWidth: "min(520px,80vw)", pointerEvents: "none",
            }}>
              <div style={{
                padding: "7px 14px", borderRadius: "var(--radius-md)",
                background: "var(--bg-overlay)", border: "1px solid var(--border)",
                boxShadow: "var(--shadow-popover)",
              }}>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>
                  {helena.transcript}
                </span>
              </div>
            </div>
          )}
        </div>

        <ActivityPanel items={items} latestId={latestId} open={panelOpen} onToggle={togglePanel} />
      </div>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      {chatOpen && (
        <ChatPanel
          messages={helena.messages}
          responding={helena.responding}
          transcript={helena.transcript}
          onSend={helena.sendMessage}
          onClose={() => setChatOpen(false)}
          pendingOrganiserAction={helena.pendingOrganiserAction}
          organiserActionSubmitting={helena.organiserActionSubmitting}
          onConfirmOrganiserAction={helena.confirmOrganiserAction}
          onCancelOrganiserAction={helena.cancelOrganiserAction}
        />
      )}

      {/* ── Overlays ────────────────────────────────────────────────────── */}
      <MemoryPanel />
      <BrainGraphPanel />
      <NewsPanel />
      <IntegrationsPanel />
      <InboxPanel />
      <ContactsPanel />

      {/* ── Mic bar ─────────────────────────────────────────────────────── */}
      <MicButton helena={helena} chatOpen={chatOpen} onChatToggle={toggleChat} llmSource={llmSource} orbAlert={orbAlert} />

      <style>{KEYFRAMES}</style>
      <style>{BRAINBASE_MOTION_CSS}</style>
    </div>
  );
}
