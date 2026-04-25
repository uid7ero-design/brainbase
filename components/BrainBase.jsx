'use client';

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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
import { KEYFRAMES } from "../lib/utils/constants";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

export default function BrainBase() {
  const router   = useRouter();
  const helena   = useHelena();
  const spotify  = useSpotify();
  const tasks    = useTasks();
  const calendar = useCalendar();

  const orbSpeechRef = useRef(null);

  const {
    sidebarOpen, toggleSidebar,
    panelOpen,   togglePanel,
    chatOpen,    setChatOpen, toggleChat,
    items,       latestId,
    cards,       addCard,    removeCard,
    llmSource,   toggleBrainGraph,
  } = useAppStore();

  // ── Speech amplitude → orb glow sync ────────────────────────────────
  useEffect(() => {
    helena.speechPulseRef.current = (v) => orbSpeechRef.current?.(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Dashboard navigation via Helena ─────────────────────────────────
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
      if (e.target.tagName.match(/INPUT|TEXTAREA/i)) return;
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

  const orbState = helena.orbPhase;

  const STATUS = {
    idle:      { label: 'HLNΛ READY',      color: 'rgba(230,237,243,.22)' },
    listening: { label: 'HLNΛ LISTENING',  color: 'rgba(56,189,248,.90)'  },
    thinking:  { label: 'HLNΛ THINKING',   color: 'rgba(167,139,250,.75)' },
    responding:{ label: 'HLNΛ RESPONDING', color: 'rgba(167,139,250,.90)' },
  };
  const { label: statusLabel, color: statusColor } = STATUS[orbState] ?? STATUS.idle;

  return (
    <div style={{
      height: "100vh", overflow: "hidden",
      background: "radial-gradient(ellipse 120% 80% at 50% 0%, #070A10 0%, #020305 55%, #000000 100%)",
      fontFamily: FONT, position: "relative", display: "flex", flexDirection: "column",
    }}>

      {/* Vignette — dark edges draw focus to centre */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: "radial-gradient(ellipse 90% 90% at 50% 50%, transparent 38%, rgba(0,0,0,.55) 100%)",
      }} />

      {/* Ambient backdrop glow — reacts to orb state */}
      <div style={{
        position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none",
        background: helena.listening
          ? "radial-gradient(ellipse 45% 35% at 50% 48%, rgba(56,189,248,.07) 0%, transparent 65%)"
          : helena.responding
          ? "radial-gradient(ellipse 45% 35% at 50% 48%, rgba(139,92,246,.06) 0%, transparent 65%)"
          : "radial-gradient(ellipse 35% 25% at 50% 48%, rgba(90,50,200,.035) 0%, transparent 65%)",
        transition: "background 1.2s ease",
      }} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={{
        height: 52, flexShrink: 0, zIndex: 30, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 20px",
        background: "rgba(6,5,12,.80)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
      }}>
        {/* Left — wordmark + sidebar toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={toggleSidebar}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 6, color: "rgba(255,255,255,.40)", lineHeight: 0 }}
            aria-label="Toggle sidebar"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "#F5F7FA", userSelect: "none" }}>
            BR<span style={{ color: "#A78BFA" }}>Λ</span>INBASE
          </span>
        </div>

        {/* Right — status badge + command centre link */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* HLNΛ Active badge */}
          <div style={{
            display: "flex", alignItems: "center", gap: 6,
            padding: "4px 12px", borderRadius: 999,
            background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: helena.listening ? "#38BDF8" : helena.responding ? "#A78BFA" : "#7C3AED",
              boxShadow: helena.listening ? "0 0 6px #38BDF8" : helena.responding ? "0 0 6px #A78BFA" : "none",
              transition: "all .4s",
            }} />
            <span style={{
              fontSize: 10, fontWeight: 600, letterSpacing: ".10em",
              color: helena.listening ? "#38BDF8" : helena.responding ? "#C4B5FD" : "rgba(255,255,255,.40)",
              textTransform: "uppercase", transition: "color .4s",
            }}>
              HLNΛ {helena.listening ? "LISTENING" : helena.responding ? "ACTIVE" : "ACTIVE"}
            </span>
          </div>

          {/* Brain Graph toggle */}
          <button
            onClick={toggleBrainGraph}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              padding: "6px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600,
              background: "rgba(139,92,246,.14)", border: "1px solid rgba(139,92,246,.30)",
              color: "#C4B5FD", cursor: "pointer", letterSpacing: ".02em",
              transition: "background .15s", fontFamily: FONT,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
            </svg>
            Brain Graph
          </button>
        </div>
      </header>

      {/* ── Main shell ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10 }}>
        <LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} />

        {/* Centre stage */}
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>

          {/* Floating response cards — bottom-left */}
          <div style={{ position: "absolute", bottom: 110, left: 16, display: "flex", flexDirection: "column-reverse", gap: 8, zIndex: 20 }}>
            {cards.slice(-2).map(c => <FloatingCard key={c.id} card={c} onDismiss={() => removeCard(c.id)} />)}
          </div>

          {/* Orb anchor — two-layer radial ground plane */}
          <div style={{
            position: "absolute",
            width: 520, height: 520,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(80,44,200,.10) 0%, rgba(55,30,160,.04) 40%, transparent 68%)",
            pointerEvents: "none",
            zIndex: 0,
          }} />

          {/* Orb + identity */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, position: "relative", zIndex: 1 }}>
            <HlnaOrb size={200} state={orbState} speechRef={orbSpeechRef} />

            {/* Identity block */}
            <div style={{ textAlign: "center", pointerEvents: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 5 }}>
              {/* Primary — HLNΛ */}
              <div style={{
                fontSize: 15, fontWeight: 700, letterSpacing: ".24em",
                color: "#F5F7FA", textTransform: "uppercase",
              }}>
                HLN<span style={{ color: "#A78BFA" }}>Λ</span>
              </div>
              {/* Secondary — subtitle */}
              <div style={{
                fontSize: 8.5, fontWeight: 400, letterSpacing: ".15em",
                color: "rgba(230,237,243,.18)", textTransform: "uppercase",
              }}>
                Hyper Learning Neural Agent
              </div>
              {/* Tertiary — state */}
              <div style={{
                fontSize: 7.5, fontWeight: 500, letterSpacing: ".26em",
                color: statusColor, textTransform: "uppercase",
                transition: "color .6s", marginTop: 1,
                opacity: helena.listening || helena.responding ? 1 : 0.5,
              }}>
                {statusLabel}
              </div>
            </div>
          </div>

          {/* Transcript overlay — above mic bar */}
          {helena.transcript && (
            <div style={{
              position: "absolute", bottom: 168, left: "50%", transform: "translateX(-50%)",
              zIndex: 22, maxWidth: "min(480px,80vw)", pointerEvents: "none",
            }}>
              <div style={{
                padding: "7px 14px", borderRadius: 8,
                background: "rgba(6,5,12,.80)", border: "1px solid rgba(255,255,255,.08)",
                backdropFilter: "blur(12px)",
              }}>
                <span style={{ fontSize: 11, color: "rgba(230,237,243,.65)", fontStyle: "italic", letterSpacing: ".01em" }}>
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

      {/* ── Panel overlays ──────────────────────────────────────────────── */}
      <MemoryPanel />
      <BrainGraphPanel />
      <NewsPanel />
      <IntegrationsPanel />
      <InboxPanel />
      <ContactsPanel />

      {/* ── Mic bar ─────────────────────────────────────────────────────── */}
      <MicButton helena={helena} chatOpen={chatOpen} onChatToggle={toggleChat} llmSource={llmSource} />

      <style>{KEYFRAMES}</style>
    </div>
  );
}
