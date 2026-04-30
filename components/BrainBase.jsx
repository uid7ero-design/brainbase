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
import { CommandSuggestions } from "./hlna/CommandSuggestions";
import { KEYFRAMES } from "../lib/utils/constants";
import { getDeptConfig } from "../lib/hlna/departmentConfigs";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

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
  idle:       { label: 'ACTIVE',     color: 'rgba(167,139,250,.55)' },
  listening:  { label: 'LISTENING',  color: '#38BDF8' },
  processing: { label: 'THINKING',   color: '#FBBF24' },
  speaking:   { label: 'SPEAKING',   color: '#A78BFA' },
  alert:      { label: 'DETECTING',  color: '#FB7185' },
};

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
        style={{
          flex: 1, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)',
          borderRadius: 8, padding: '7px 11px', fontSize: 11, color: '#F4F4F5',
          fontFamily: FONT, outline: 'none', minWidth: 0,
        }}
        onFocus={e => { e.currentTarget.style.borderColor = 'rgba(124,58,237,.40)'; }}
        onBlur={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.09)'; }}
      />
      <button
        type="submit"
        style={{
          padding: '7px 13px', borderRadius: 8, fontSize: 12, fontWeight: 700,
          background: 'rgba(124,58,237,.20)', border: '1px solid rgba(124,58,237,.40)',
          color: '#C4B5FD', cursor: 'pointer', fontFamily: FONT, flexShrink: 0,
          transition: 'all .18s',
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,.32)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,.20)'; }}
      >
        →
      </button>
    </form>
  );
}

export default function BrainBase() {
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
  const activeModColor = activeModule ? (MODULE_COLORS[activeModule] ?? '#A78BFA') : '#A78BFA';
  const activeModName  = enabledModules.find(m => m.key === activeModule)?.name ?? 'Select module';

  // Active operator state — derived from current department config
  const deptConfig      = getDeptConfig(activeDepartment ?? 'waste');
  const hasHighAlerts   = deptConfig.alerts.some(a => a.severity === 'high');
  const priorityActions = deptConfig.actions.filter(a => a.urgency === 'high');
  const primaryAction   = priorityActions[0] ?? deptConfig.actions[0];

  return (
    <div style={{
      height: "100vh", overflow: "hidden",
      background: "radial-gradient(ellipse 130% 90% at 50% 0%, #07050F 0%, #050309 50%, #020205 100%)",
      fontFamily: FONT, position: "relative", display: "flex", flexDirection: "column",
    }}>

      {/* Vignette */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 90% 90% at 50% 50%, transparent 35%, rgba(0,0,0,.60) 100%)",
      }} />

      {/* Ambient glow — shifts with HLNA state */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: helena.listening
          ? "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(56,189,248,.07) 0%, transparent 65%)"
          : helena.responding
          ? "radial-gradient(ellipse 50% 40% at 50% 50%, rgba(139,92,246,.07) 0%, transparent 65%)"
          : orbAlert
          ? "radial-gradient(ellipse 45% 35% at 50% 50%, rgba(251,113,133,.06) 0%, transparent 65%)"
          : "radial-gradient(ellipse 40% 30% at 50% 50%, rgba(90,50,200,.04) 0%, transparent 65%)",
        transition: "background 1.2s ease",
      }} />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header style={{
        height: 50, flexShrink: 0, zIndex: 30, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        background: "rgba(4,3,10,.88)", backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        gap: 10,
      }}>
        {/* Left — toggle + wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button
            onClick={toggleSidebar}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "rgba(255,255,255,.35)", lineHeight: 0 }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "#F5F7FA", userSelect: "none", whiteSpace: "nowrap" }}>
            BR<span style={{ color: "#A78BFA" }}>Λ</span>INBASE
          </span>
          {enabledModules.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: 6 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: activeModColor, boxShadow: `0 0 5px ${activeModColor}` }} />
              <select
                value={activeModule ?? ''}
                onChange={e => setActiveModule(e.target.value)}
                style={{
                  background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)",
                  borderRadius: 6, color: "#D4D4D8", fontSize: 11, fontWeight: 600,
                  padding: "3px 7px", cursor: "pointer", fontFamily: FONT,
                  outline: "none", letterSpacing: "-0.01em",
                }}
              >
                {enabledModules.map(m => (
                  <option key={m.key} value={m.key} style={{ background: "#0D0D15" }}>{m.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Centre — Exec / Ops toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 1, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 8, padding: 2, flexShrink: 0 }}>
          {['executive', 'operational'].map(mode => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              style={{
                padding: "3px 10px", borderRadius: 6, fontSize: 10, fontWeight: 700,
                letterSpacing: "0.05em", cursor: "pointer", border: "none",
                background: viewMode === mode ? "rgba(124,58,237,.28)" : "transparent",
                color: viewMode === mode ? "#C4B5FD" : "rgba(255,255,255,.28)",
                transition: "all 0.18s", textTransform: "capitalize", fontFamily: FONT,
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
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: orbLabel.color,
              boxShadow: `0 0 7px ${orbLabel.color}`,
              transition: "all .4s",
              animation: helena.listening || helena.responding ? "agentPulse 1.2s ease-in-out infinite" : undefined,
            }} />
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: ".10em",
              color: orbLabel.color, textTransform: "uppercase",
              transition: "color .3s",
            }}>
              HLNΛ {orbLabel.label}
            </span>
          </div>

          <button
            onClick={toggleBrainGraph}
            title="Performance Graph"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: "rgba(139,92,246,.10)", border: "1px solid rgba(139,92,246,.22)",
              color: "#B4A0E8", cursor: "pointer", fontFamily: FONT, transition: "all .18s",
            }}
            onMouseEnter={e => { e.currentTarget.style.background = "rgba(139,92,246,.18)"; e.currentTarget.style.borderColor = "rgba(139,92,246,.38)"; }}
            onMouseLeave={e => { e.currentTarget.style.background = "rgba(139,92,246,.10)"; e.currentTarget.style.borderColor = "rgba(139,92,246,.22)"; }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
            Performance
          </button>

          <a
            href="/account/profile"
            title="Profile"
            style={{
              width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center",
              background: "rgba(124,58,237,.14)", border: "1px solid rgba(124,58,237,.26)",
              color: "#C4B5FD", textDecoration: "none", fontSize: 11, fontWeight: 700,
              transition: "all .18s",
            }}
          >
            ◎
          </a>
        </div>
      </header>

      {/* ── Main shell ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10 }}>
        <LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} />

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
                  borderRadius: 16,
                  background: "linear-gradient(145deg, rgba(8,6,20,.97) 0%, rgba(14,10,28,.95) 100%)",
                  border: hasHighAlerts
                    ? "1px solid rgba(251,113,133,.38)"
                    : "1px solid rgba(167,139,250,.18)",
                  boxShadow: hasHighAlerts
                    ? "0 0 48px rgba(251,113,133,.10), 0 0 80px rgba(251,113,133,.04)"
                    : helena.listening
                    ? "0 0 36px rgba(56,189,248,.09)"
                    : helena.responding
                    ? "0 0 32px rgba(124,58,237,.09)"
                    : "0 0 24px rgba(124,58,237,.06)",
                  transition: "border-color .4s, box-shadow .4s",
                  position: "relative", overflow: "hidden",
                }}>

                  {/* Left accent bar */}
                  <div style={{
                    position: "absolute", left: 0, top: 0, bottom: 0, width: 3,
                    background: hasHighAlerts
                      ? "linear-gradient(180deg, #FB7185 0%, #A78BFA 60%, #38BDF8 100%)"
                      : "linear-gradient(180deg, #A78BFA 0%, #38BDF8 100%)",
                    borderRadius: "16px 0 0 16px",
                  }} />

                  {/* ── Wordmark + live detection state ── */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 10, width: "100%" }}>
                    <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".28em", color: "rgba(255,255,255,.25)", textTransform: "uppercase" }}>
                      HLN<span style={{ color: "rgba(167,139,250,.60)" }}>Λ</span>
                    </span>
                    <div style={{ width: 1, height: 10, background: "rgba(255,255,255,.12)", flexShrink: 0 }} />
                    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <div style={{
                        width: 5, height: 5, borderRadius: "50%",
                        background: hasHighAlerts ? "#FB7185" : orbLabel.color,
                        boxShadow: `0 0 7px ${hasHighAlerts ? "#FB7185" : orbLabel.color}`,
                        transition: "all .4s",
                        animation: hasHighAlerts ? "agentPulse 1.5s ease-in-out infinite" : (helena.listening || helena.responding ? "agentPulse 1.2s ease-in-out infinite" : undefined),
                      }} />
                      <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: ".12em",
                        color: hasHighAlerts ? "#FB7185" : orbLabel.color,
                        textTransform: "uppercase", transition: "color .3s",
                      }}>
                        {hasHighAlerts && (orbState === "idle" || orbState === "alert") ? "ISSUE DETECTED" : orbLabel.label}
                      </span>
                    </div>
                  </div>

                  {/* ── Orb ── */}
                  <div style={{ position: "relative", display: "flex", alignItems: "center", marginBottom: 10 }}>
                    <div style={{
                      position: "absolute", width: 220, height: 220, borderRadius: "50%",
                      background: hasHighAlerts
                        ? "radial-gradient(circle, rgba(251,113,133,.09) 0%, transparent 65%)"
                        : helena.listening
                        ? "radial-gradient(circle, rgba(56,189,248,.10) 0%, transparent 65%)"
                        : helena.responding
                        ? "radial-gradient(circle, rgba(139,92,246,.09) 0%, transparent 65%)"
                        : "radial-gradient(circle, rgba(80,44,200,.07) 0%, transparent 65%)",
                      transition: "background 1.2s", pointerEvents: "none",
                      top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    }} />
                    <div style={{
                      position: "absolute", width: 145, height: 145, borderRadius: "50%",
                      background: hasHighAlerts
                        ? "radial-gradient(circle, rgba(251,113,133,.14) 0%, transparent 70%)"
                        : helena.listening
                        ? "radial-gradient(circle, rgba(56,189,248,.14) 0%, transparent 70%)"
                        : "radial-gradient(circle, rgba(124,58,237,.10) 0%, transparent 70%)",
                      transition: "background 0.8s", pointerEvents: "none",
                      top: "50%", left: "50%", transform: "translate(-50%, -50%)",
                    }} />
                    <HlnaOrb size={120} state={orbState} speechRef={orbSpeechRef} />
                  </div>

                  {/* ── Active intelligence content ── */}
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
                    {hasHighAlerts ? (
                      <>
                        {/* Detection card */}
                        <div style={{
                          padding: "10px 12px", borderRadius: 9,
                          background: "rgba(251,113,133,.04)",
                          border: "1px solid rgba(251,113,133,.14)",
                        }}>
                          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".12em", color: "#FB7185", textTransform: "uppercase", marginBottom: 5 }}>
                            HLNΛ detected an issue
                          </div>
                          <p style={{ margin: 0, fontSize: 11, color: "rgba(230,237,243,.72)", lineHeight: 1.55 }}>
                            {deptConfig.briefing.action}
                          </p>
                        </div>

                        {/* Priority actions reference */}
                        {priorityActions.length > 0 && (
                          <div style={{
                            padding: "8px 10px", borderRadius: 8,
                            background: "rgba(124,58,237,.06)",
                            border: "1px solid rgba(124,58,237,.15)",
                          }}>
                            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".10em", color: "rgba(167,139,250,.55)", textTransform: "uppercase", marginBottom: 6 }}>
                              I've identified {priorityActions.length} priority action{priorityActions.length !== 1 ? "s" : ""}
                            </div>
                            {priorityActions.slice(0, 2).map(action => (
                              <div key={action.id} style={{ display: "flex", alignItems: "flex-start", gap: 6, marginBottom: 4 }}>
                                <span style={{ color: "#A78BFA", fontSize: 10, flexShrink: 0, marginTop: 2 }}>→</span>
                                <span style={{ fontSize: 11, color: "rgba(196,181,253,.82)", lineHeight: 1.4 }}>{action.title}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Execute Action — primary */}
                        <button
                          onClick={() => { fireHelena(primaryAction.command); setChatOpen(true); }}
                          style={{
                            width: "100%", padding: "10px 0", borderRadius: 8, fontSize: 12, fontWeight: 700,
                            background: "linear-gradient(135deg, rgba(124,58,237,.34) 0%, rgba(109,40,217,.26) 100%)",
                            border: "1px solid rgba(124,58,237,.52)", color: "#DDD6FE",
                            cursor: "pointer", fontFamily: FONT, letterSpacing: ".04em",
                            boxShadow: "0 0 14px rgba(124,58,237,.14)",
                            transition: "all .18s",
                          }}
                          onMouseEnter={e => {
                            e.currentTarget.style.background = "linear-gradient(135deg, rgba(124,58,237,.52) 0%, rgba(109,40,217,.42) 100%)";
                            e.currentTarget.style.boxShadow = "0 0 22px rgba(124,58,237,.26)";
                          }}
                          onMouseLeave={e => {
                            e.currentTarget.style.background = "linear-gradient(135deg, rgba(124,58,237,.34) 0%, rgba(109,40,217,.26) 100%)";
                            e.currentTarget.style.boxShadow = "0 0 14px rgba(124,58,237,.14)";
                          }}
                        >
                          ⚡ Execute Action
                        </button>

                        {/* Review Details — secondary */}
                        <button
                          onClick={() => { fireHelena(`Analyse the current situation and give me a detailed briefing on ${deptConfig.label} performance, priority issues, and recommended actions.`); setChatOpen(true); }}
                          style={{
                            width: "100%", padding: "8px 0", borderRadius: 8, fontSize: 11, fontWeight: 600,
                            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)",
                            color: "rgba(212,212,216,.65)", cursor: "pointer", fontFamily: FONT, letterSpacing: ".02em",
                            transition: "all .18s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,.08)"; e.currentTarget.style.color = "rgba(212,212,216,.85)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.color = "rgba(212,212,216,.65)"; }}
                        >
                          Review Details / Analyse
                        </button>
                      </>
                    ) : (
                      <>
                        {/* Idle state */}
                        <div style={{ textAlign: "center" }}>
                          <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".18em", color: orbLabel.color, textTransform: "uppercase" }}>
                            {orbLabel.label}
                          </div>
                          <p style={{ fontSize: 11, color: "rgba(161,161,170,.50)", margin: "4px 0 0", lineHeight: 1.4 }}>
                            All systems normal. No priority issues detected.
                          </p>
                          {activeModule && (
                            <div style={{ display: "inline-flex", alignItems: "center", gap: 5, marginTop: 8, padding: "3px 10px", borderRadius: 20, background: `${activeModColor}14`, border: `1px solid ${activeModColor}30` }}>
                              <div style={{ width: 5, height: 5, borderRadius: "50%", background: activeModColor, boxShadow: `0 0 5px ${activeModColor}` }} />
                              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".10em", color: activeModColor, textTransform: "uppercase" }}>{activeModName}</span>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => { fireHelena(`Give me today's full operations briefing for ${deptConfig.label}.`); setChatOpen(true); }}
                          style={{
                            width: "100%", padding: "9px 0", borderRadius: 8, fontSize: 11, fontWeight: 700,
                            background: "rgba(124,58,237,.20)", border: "1px solid rgba(124,58,237,.38)",
                            color: "#C4B5FD", cursor: "pointer", fontFamily: FONT, transition: "all .18s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = "rgba(124,58,237,.32)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = "rgba(124,58,237,.20)"; }}
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
                    <div style={{ height: 1, background: "rgba(255,255,255,.06)" }} />
                    <AskInput onSend={(q) => { helena.sendMessage(q); setChatOpen(true); }} />
                    <div>
                      <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: ".12em", color: "rgba(255,255,255,.20)", textTransform: "uppercase", marginBottom: 6 }}>
                        Explore further
                      </div>
                      <CommandSuggestions panelMode />
                    </div>
                  </div>

                </div>
              </div>

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
                padding: "7px 14px", borderRadius: 8,
                background: "rgba(4,3,10,.88)", border: "1px solid rgba(255,255,255,.08)",
                backdropFilter: "blur(12px)",
              }}>
                <span style={{ fontSize: 11, color: "rgba(230,237,243,.65)", fontStyle: "italic" }}>
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
    </div>
  );
}
