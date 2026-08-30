'use client';

// Dedicated full-screen HLNA conversation workspace (Phase C.2B).
//
// This is deliberately NOT a trimmed copy of components/BrainBase.jsx.
// It reuses the same underlying pieces BrainBase.jsx uses for its Helena
// surface (useHelena's state machine, the shared visual-state mapping, the
// production HelenaOrbital + speechPulseRef bridge, ChatPanel, MicButton)
// but omits everything that isn't genuinely conversational: the module
// switcher, Exec/Ops toggle, LeftSidebar, MorningBriefing/RecommendedActions
// (static mock department-briefing content — see lib/hlna/departmentConfigs
// .ts), and CommandSuggestions (also mock-department-driven). See the C.2B
// report for the full region-by-region reuse/exclusion rationale.
//
// Deliberately NOT wired here (kept out of this narrowly-scoped extraction,
// not silently dropped — flagged in the C.2B report): Spotify/Calendar/Task
// context refs and the dashboard nav (resolveRoute) integration. Those are
// operational-context enrichment for BrainBase's dashboard surface, not
// conversation primitives. Wake word and push-to-talk (hold Space) ARE
// wired, since "microphone" is explicit primary content for this page.

import { useEffect, useRef } from "react";
import { useHelena } from "../../hooks/useHelena";
import { useAppStore } from "../../lib/state/useAppStore";
import { HelenaOrbital } from "../brand/HelenaOrbital";
import { FloatingCard } from "../cards/FloatingCard";
import { ChatPanel } from "../chat/ChatPanel";
import { MicButton } from "../voice/MicButton";
import { BrainGraphPanel } from "../panels/BrainGraphPanel";
import { AskInput } from "./AskInput";
import { KEYFRAMES } from "../../lib/utils/constants";
import { mapHelenaPhaseToVisualState, HELENA_VISUAL_STATE_LABEL } from "../../lib/helena/visualState";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

export default function HelenaWorkspace() {
  const helena = useHelena();
  const orbSpeechRef = useRef(null);

  const {
    chatOpen, setChatOpen, toggleChat,
    cards, addCard, removeCard,
    llmSource,
    brainGraphOpen, toggleBrainGraph,
    orbAlert,
  } = useAppStore();

  // ── Speech → orb sync — identical contract to BrainBase.jsx's Phase C
  // bridge (helena.speechPulseRef.current is a mutable ref the existing TTS
  // playback path already calls; HelenaOrbital's speechRef prop expects the
  // exact same ref-callback shape). No new audio API, no new state machine.
  useEffect(() => {
    helena.speechPulseRef.current = (v) => orbSpeechRef.current?.(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Wake word ("Hey HLNA") — same as BrainBase.jsx.
  useEffect(() => {
    helena.enableWakeWord();
    return () => helena.disableWakeWord();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Push-to-talk: hold Space — same as BrainBase.jsx.
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

  // ── Floating response card on each Helena reply — same as BrainBase.jsx.
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

  // This page's whole purpose is conversation, so open it by default rather
  // than requiring Cmd+K — it stays a normal toggle after that (Escape /
  // the panel's own close button / the header's Conversation button all
  // still work, matching ChatPanel's existing behaviour unchanged).
  useEffect(() => { setChatOpen(true); }, [setChatOpen]);

  useEffect(() => {
    function onKeyDown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); toggleChat(); return; }
      if (e.key === 'Escape') { setChatOpen(false); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleChat, setChatOpen]);

  const helenaVisualState = mapHelenaPhaseToVisualState(helena.orbPhase, orbAlert);
  const stateLabel = HELENA_VISUAL_STATE_LABEL[helenaVisualState] ?? HELENA_VISUAL_STATE_LABEL.idle;

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

      {/* Ambient glow — shifts with HLNA state, same treatment as BrainBase.jsx */}
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
        gap: 10, flexWrap: "wrap",
      }}>
        {/* Left — wordmark, links back to the organisation dashboard */}
        <a
          href="/dashboard"
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, textDecoration: "none" }}
        >
          <span style={{ fontSize: 14, fontWeight: 700, letterSpacing: ".04em", color: "#F5F7FA", userSelect: "none", whiteSpace: "nowrap" }}>
            BR<span style={{ color: "#A78BFA" }}>Λ</span>INBASE
          </span>
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".22em", color: "rgba(167,139,250,.55)", textTransform: "uppercase" }}>
            HLNΛ
          </span>
        </a>

        {/* Right — state pill + conversation/graph toggles + profile */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <div
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "4px 10px", borderRadius: 999,
              background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.07)",
            }}
          >
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: stateLabel.color,
              boxShadow: `0 0 7px ${stateLabel.color}`,
              transition: "all .4s",
              animation: helena.listening || helena.responding ? "agentPulse 1.2s ease-in-out infinite" : undefined,
            }} />
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: ".10em",
              color: stateLabel.color, textTransform: "uppercase",
              transition: "color .3s",
            }}>
              HLNΛ {stateLabel.label}
            </span>
          </div>

          <button
            onClick={toggleChat}
            title="Conversation"
            style={{
              padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: chatOpen ? "rgba(167,139,250,.16)" : "rgba(255,255,255,.04)",
              border: `1px solid ${chatOpen ? "rgba(167,139,250,.34)" : "rgba(255,255,255,.09)"}`,
              color: chatOpen ? "#C4B5FD" : "rgba(212,212,216,.55)",
              cursor: "pointer", fontFamily: FONT, transition: "all .18s",
            }}
          >
            Conversation
          </button>

          <button
            onClick={toggleBrainGraph}
            title="Performance Graph"
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "5px 10px", borderRadius: 7, fontSize: 11, fontWeight: 600,
              background: brainGraphOpen ? "rgba(139,92,246,.18)" : "rgba(139,92,246,.10)",
              border: `1px solid ${brainGraphOpen ? "rgba(139,92,246,.38)" : "rgba(139,92,246,.22)"}`,
              color: "#B4A0E8", cursor: "pointer", fontFamily: FONT, transition: "all .18s",
            }}
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
              transition: "all .18s", flexShrink: 0,
            }}
          >
            ◎
          </a>
        </div>
      </header>

      {/* ── Main: HelenaOrbital + status + quick input ─────────────────── */}
      <div style={{
        flex: 1, position: "relative", overflow: "auto", zIndex: 10,
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px 20px 140px", gap: 22,
      }}>
        <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{
            position: "absolute", width: 380, height: 380, borderRadius: "50%",
            background: orbAlert
              ? "radial-gradient(circle, rgba(251,113,133,.09) 0%, transparent 65%)"
              : helena.listening
              ? "radial-gradient(circle, rgba(56,189,248,.10) 0%, transparent 65%)"
              : helena.responding
              ? "radial-gradient(circle, rgba(139,92,246,.09) 0%, transparent 65%)"
              : "radial-gradient(circle, rgba(80,44,200,.07) 0%, transparent 65%)",
            transition: "background 1.2s", pointerEvents: "none",
          }} />
          <div style={{
            position: "absolute", width: 260, height: 260, borderRadius: "50%",
            background: orbAlert
              ? "radial-gradient(circle, rgba(251,113,133,.14) 0%, transparent 70%)"
              : helena.listening
              ? "radial-gradient(circle, rgba(56,189,248,.14) 0%, transparent 70%)"
              : "radial-gradient(circle, rgba(124,58,237,.10) 0%, transparent 70%)",
            transition: "background 0.8s", pointerEvents: "none",
          }} />
          <HelenaOrbital size={220} state={helenaVisualState} speechRef={orbSpeechRef} />
        </div>

        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".18em", color: stateLabel.color, textTransform: "uppercase" }}>
            {stateLabel.label}
          </div>
          <p style={{ fontSize: 12, color: "rgba(161,161,170,.55)", margin: "4px 0 0", lineHeight: 1.5 }}>
            {helena.transcript
              ? helena.transcript
              : helena.messages.length === 0
              ? "Ask HLNΛ anything, or press the mic to talk."
              : "Ready for your next question."}
          </p>
        </div>

        <div style={{ width: "100%", maxWidth: 420 }}>
          <AskInput onSend={(q) => { helena.sendMessage(q); setChatOpen(true); }} />
        </div>

        {/* Floating response cards */}
        <div style={{ position: "fixed", bottom: 100, left: 16, display: "flex", flexDirection: "column-reverse", gap: 8, zIndex: 20, pointerEvents: "none" }}>
          {cards.slice(-2).map(c => (
            <div key={c.id} style={{ pointerEvents: "auto" }}>
              <FloatingCard card={c} onDismiss={() => removeCard(c.id)} />
            </div>
          ))}
        </div>
      </div>

      {/* ── Chat panel: full conversation history ──────────────────────── */}
      {chatOpen && (
        <ChatPanel
          messages={helena.messages}
          responding={helena.responding}
          transcript={helena.transcript}
          onSend={helena.sendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* ── BrainGraph: already on-demand via brainGraphOpen, kept that way ── */}
      <BrainGraphPanel />

      {/* ── Mic bar ─────────────────────────────────────────────────────── */}
      <MicButton helena={helena} chatOpen={chatOpen} onChatToggle={toggleChat} llmSource={llmSource} orbAlert={orbAlert} />

      <style>{KEYFRAMES}</style>
    </div>
  );
}
