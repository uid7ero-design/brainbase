'use client';

// Dedicated full-screen HLNA conversation workspace (Phase C.2B, refined in
// C.2B.1 into a two-column "talk to HLNA" layout).
//
// This is deliberately NOT a trimmed copy of components/BrainBase.jsx.
// It reuses the same underlying pieces BrainBase.jsx uses for its Helena
// surface (useHelena's state machine, the shared visual-state mapping, the
// production HelenaOrbital + speechPulseRef bridge, ChatPanel in its new
// 'docked' layout mode) but omits everything that isn't genuinely
// conversational: the module switcher, Exec/Ops toggle, LeftSidebar,
// MorningBriefing/RecommendedActions/CommandSuggestions (all backed by
// static mock department data — see lib/hlna/departmentConfigs.ts), and
// the legacy floating MicButton dock (superseded here by HelenaMic in the
// left column — same helena.startConversation()/stopConversation() calls,
// no second voice engine). See the C.2B/C.2B.1 reports for the full
// region-by-region reuse/exclusion rationale.
//
// Deliberately NOT wired here (kept out of this narrowly-scoped extraction,
// not silently dropped — flagged in the C.2B report): Spotify/Calendar/Task
// context refs and the dashboard nav (resolveRoute) integration. Those are
// operational-context enrichment for BrainBase's dashboard surface, not
// conversation primitives. Wake word and push-to-talk (hold Space) ARE
// wired, since "microphone" is explicit primary content for this page.
//
// Floating response cards (FloatingCard) are deliberately NOT used here —
// C.2B.1 removed them in favour of the always-visible ChatPanel conversation
// thread, since showing the same reply in both places would be a duplicate
// presentation of the same answer.

import { useEffect, useRef, useState } from "react";
import { useHelena } from "../../hooks/useHelena";
import { useAppStore } from "../../lib/state/useAppStore";
import { HelenaOrbital } from "../brand/HelenaOrbital";
import { BrainBaseWordmark } from "../brand/BrainBaseWordmark";
import { ChatPanel } from "../chat/ChatPanel";
import { HelenaMic } from "./HelenaMic";
import { BrainGraphPanel } from "../panels/BrainGraphPanel";
import { KEYFRAMES } from "../../lib/utils/constants";
import { mapHelenaPhaseToVisualState, HELENA_VISUAL_STATE_LABEL } from "../../lib/helena/visualState";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

const NARROW_QUERY = '(max-width: 860px)';

// Neutral, tenant-agnostic — no industry/module assumption. Only shown
// before the very first message; ChatPanel's own empty state (below the
// conversation thread) also gets a neutral default this phase.
function defaultHint(messages, transcript, micError) {
  if (micError) return micError;
  if (transcript) return transcript;
  if (messages.length > 0) return 'Ready when you are.';
  return 'Type on the right, or tap the mic to talk.';
}

export default function HelenaWorkspace() {
  const helena = useHelena();
  const orbSpeechRef = useRef(null);
  const [isNarrow, setIsNarrow] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(NARROW_QUERY).matches : false
  );

  const {
    brainGraphOpen, toggleBrainGraph,
    orbAlert,
  } = useAppStore();

  // ── Responsive column-vs-stack breakpoint + orbital size. Plain
  // matchMedia listener — no new APIs, mirrors the CSS breakpoint below so
  // JS-driven size and CSS-driven layout switch at the same width. Initial
  // value comes from useState's lazy initializer (above), not a setState
  // call in this effect body — this effect only subscribes to changes.
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (e) => setIsNarrow(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

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

  const helenaVisualState = mapHelenaPhaseToVisualState(helena.orbPhase, orbAlert);
  const stateLabel = HELENA_VISUAL_STATE_LABEL[helenaVisualState] ?? HELENA_VISUAL_STATE_LABEL.idle;
  const hint = defaultHint(helena.messages, helena.transcript, helena.micError);
  const orbitalSize = isNarrow ? 220 : 320;

  return (
    <div style={{
      // Phase C.2B.2: app/layout.tsx renders the global TopNav (a <nav>,
      // ~52px tall in its single-row state) as a plain sibling before
      // {children} — not inside a flex container that would give this page
      // the true remaining height. A flat 100vh here stacks additively on
      // top of TopNav and produces ~52px of page-level scroll overflow
      // (confirmed live via getBoundingClientRect: html.scrollHeight 1191
      // vs window.innerHeight 1138). BrainBase.jsx has this same pattern —
      // this fix is scoped to this file only. If TopNav's height changes
      // (e.g. it wraps to two rows, or the super_admin org-impersonation
      // banner is showing) this approximation would need revisiting; a
      // fully robust fix belongs in app/layout.tsx, out of scope here.
      height: "calc(100vh - 52px)", overflow: "hidden",
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

      {/* ── Header — minimal: wordmark, BrainGraph toggle, profile ─────── */}
      <header style={{
        height: 50, flexShrink: 0, zIndex: 30, position: "relative",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px",
        background: "rgba(4,3,10,.88)", backdropFilter: "blur(14px)",
        borderBottom: "1px solid rgba(255,255,255,.06)",
        gap: 10, flexWrap: "wrap",
      }}>
        <a
          href="/dashboard"
          aria-label="BRΛINBΛSE home"
          style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0, textDecoration: "none" }}
        >
          <BrainBaseWordmark width={116} />
          <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".22em", color: "rgba(167,139,250,.55)", textTransform: "uppercase" }}>
            HLNΛ
          </span>
        </a>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
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

      {/* ── Two-column split: Helena (left) / conversation (right) ─────── */}
      <div className="hlna-split" style={{ flex: 1, position: "relative", zIndex: 10, overflow: "hidden" }}>
        <div className="hlna-left">
          <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{
              position: "absolute", width: orbitalSize * 1.7, height: orbitalSize * 1.7, borderRadius: "50%",
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
              position: "absolute", width: orbitalSize * 1.2, height: orbitalSize * 1.2, borderRadius: "50%",
              background: orbAlert
                ? "radial-gradient(circle, rgba(251,113,133,.14) 0%, transparent 70%)"
                : helena.listening
                ? "radial-gradient(circle, rgba(56,189,248,.14) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(124,58,237,.10) 0%, transparent 70%)",
              transition: "background 0.8s", pointerEvents: "none",
            }} />
            <HelenaOrbital size={orbitalSize} state={helenaVisualState} speechRef={orbSpeechRef} />
          </div>

          <div style={{ textAlign: "center", maxWidth: 340 }}>
            <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: ".01em", color: stateLabel.color, transition: "color .3s" }}>
              {stateLabel.label}
            </div>
            <p style={{ fontSize: 12, color: "rgba(161,161,170,.55)", margin: "6px 0 0", lineHeight: 1.5, minHeight: 18 }}>
              {hint}
            </p>
          </div>

          <HelenaMic helena={helena} size={isNarrow ? 56 : 64} />
        </div>

        <div className="hlna-right">
          <ChatPanel
            layout="docked"
            messages={helena.messages}
            responding={helena.responding}
            transcript={helena.transcript}
            onSend={helena.sendMessage}
            emptyStateTitle="Ask HLNΛ about your organisation."
            emptyStateHint="What would you like help with?"
            maxWidth={isNarrow ? '100%' : 860}
            maxHeight={isNarrow ? '100%' : '74vh'}
          />
        </div>
      </div>

      {/* ── BrainGraph: already on-demand via brainGraphOpen, kept that way ── */}
      <BrainGraphPanel />

      <style>{`
        .hlna-split {
          display: flex;
          flex-direction: row;
        }
        .hlna-left {
          flex: 0 0 38%;
          min-width: 320px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 22px;
          padding: 24px 20px;
          overflow: auto;
        }
        .hlna-right {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 24px;
          min-height: 0;
          overflow: hidden;
        }
        @media ${NARROW_QUERY} {
          .hlna-split {
            flex-direction: column;
            overflow: auto;
          }
          .hlna-left {
            flex: 0 0 auto;
            min-width: 0;
            width: 100%;
            padding: 20px 16px 12px;
            overflow: visible;
          }
          .hlna-right {
            flex: 1;
            width: 100%;
            padding: 12px;
            min-height: 460px;
            overflow: visible;
          }
        }
      `}</style>
      <style>{KEYFRAMES}</style>
    </div>
  );
}
