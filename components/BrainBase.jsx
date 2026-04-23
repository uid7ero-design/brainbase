'use client';

import { useRef, useEffect } from "react";
import { useHelena } from "../hooks/useHelena";
import { useSpotify } from "../hooks/useSpotify";
import { useTasks } from "../hooks/useTasks";
import { useAppStore } from "../lib/state/useAppStore";
import { buildScene } from "./orb/buildScene";
import { StarCanvas } from "./orb/StarCanvas";
import { GlassHeader } from "./layout/GlassHeader";
import { MetricsStrip } from "./layout/MetricsStrip";
import { LeftSidebar } from "./layout/LeftSidebar";
import { NeuralMapCard }  from "./cards/NeuralMapCard";
import { FloatingCard } from "./cards/FloatingCard";
import { ActivityPanel } from "./panels/ActivityPanel";
import { MemoryPanel }     from "./panels/MemoryPanel";
import { BrainGraphPanel } from "./panels/BrainGraphPanel";
import { NewsPanel }       from "./panels/NewsPanel";
import { ChatPanel } from "./chat/ChatPanel";
import { MicButton } from "./voice/MicButton";
import { NEBULA, KEYFRAMES } from "../lib/utils/constants";

export default function BrainBase() {
  const canvasWrapRef = useRef(null);
  const sceneRef      = useRef(null);
  const helena        = useHelena();
  const spotify       = useSpotify();
  const tasks         = useTasks();

  const {
    sidebarOpen, toggleSidebar,
    panelOpen,   togglePanel,
    chatOpen,    setChatOpen, toggleChat,
    items,       latestId,
    cards,       addCard,
    llmSource,
  } = useAppStore();

  // ── Three.js scene lifecycle ───────────────────────────────────────
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    const sc = buildScene(el);
    sceneRef.current = sc;
    const onResize = () => sc.resize();
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); sc.dispose(); sceneRef.current = null; };
  }, []);

  // ── Enable wake word on mount ─────────────────────────────────────
  useEffect(() => {
    helena.enableWakeWord();
    return () => helena.disableWakeWord();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync orb state ────────────────────────────────────────────────
  useEffect(() => {
    const s = helena.listening ? "listening" : helena.responding ? "processing" : "idle";
    sceneRef.current?.setState(s);
  }, [helena.listening, helena.responding]);

  // ── Shift orb with sidebar ────────────────────────────────────────
  useEffect(() => {
    sceneRef.current?.setOffset(sidebarOpen ? -0.32 : 0);
  }, [sidebarOpen]);

  // ── Wire speech pulse → orb bloom ────────────────────────────────
  useEffect(() => {
    helena.speechPulseRef.current = (v) => sceneRef.current?.setSpeechLevel(v);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync Spotify state into Helena's context ──────────────────────
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

  // ── Wire task controls for Helena voice commands ─────────────────
  useEffect(() => {
    helena.taskControlRef.current = {
      add:           tasks.add,
      completeByText: tasks.completeByText,
      clearDone:     tasks.clearDone,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.add, tasks.completeByText, tasks.clearDone]);

  // ── Wire Spotify controls for Helena voice commands ───────────────
  useEffect(() => {
    helena.spotifyControlRef.current = {
      play:  spotify.play,
      pause: spotify.pause,
      next:  spotify.next,
      prev:  spotify.prev,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spotify.play, spotify.pause, spotify.next, spotify.prev]);

  // ── Add floating card when Helena responds ────────────────────────
  useEffect(() => {
    const last = helena.messages[helena.messages.length - 1];
    if (!last || last.role !== 'assistant') return;
    addCard({
      id:    Date.now(),
      type:  last.meta?.intent ?? 'insight',
      title: last.content.slice(0, 60) + (last.content.length > 60 ? '…' : ''),
      sub:   'Helena · just now',
      time:  'now',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helena.messages.length]);

  // ── Keyboard shortcuts ────────────────────────────────────────────
  useEffect(() => {
    function onKeyDown(e) {
      // Ctrl/Cmd+K — toggle chat
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
        return;
      }
      // Esc — close chat / memory panel
      if (e.key === 'Escape') {
        setChatOpen(false);
        return; // MemoryPanel handles its own Esc
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleChat, setChatOpen]);

  // ── Push-to-talk: hold Space ──────────────────────────────────────
  useEffect(() => {
    let held = false;
    function onDown(e) {
      if (e.code !== 'Space' || held) return;
      if (e.target.tagName.match(/INPUT|TEXTAREA/i)) return;
      if (helena.conversational) return; // conversation mode uses its own flow
      e.preventDefault();
      held = true;
      helena.startListening();
    }
    function onUp(e) {
      if (e.code !== 'Space' || !held) return;
      e.preventDefault();
      held = false;
      helena.stopAndSend();
    }
    window.addEventListener('keydown', onDown);
    window.addEventListener('keyup',   onUp);
    return () => {
      window.removeEventListener('keydown', onDown);
      window.removeEventListener('keyup',   onUp);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helena.conversational]);

  const orbState   = helena.listening ? "listening" : helena.responding ? "responding" : "idle";
  const stateLabel = helena.responding ? "Helena is speaking…" : helena.listening ? "Listening…" : "Helena is ready";

  return (
    <div style={{ height: "100vh", overflow: "hidden", background: "#070910", fontFamily: "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif", position: "relative", display: "flex", flexDirection: "column" }}>

      {/* Nebula */}
      <div style={{ position: "fixed", inset: 0, zIndex: 0, pointerEvents: "none", animation: "nebulaBreath 22s ease-in-out infinite alternate", background: NEBULA }} />

      {/* Three.js canvas */}
      <div ref={canvasWrapRef} style={{ position: "fixed", inset: 0, zIndex: 1, pointerEvents: "none" }} />
      <StarCanvas />

      {/* UI shell */}
      <GlassHeader appState={orbState} />
      <MetricsStrip />

      <div style={{ flex: 1, display: "flex", overflow: "hidden", position: "relative", zIndex: 10 }}>
        <LeftSidebar open={sidebarOpen} onToggle={toggleSidebar} />

        <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <NeuralMapCard />

          {/* Floating response cards */}
          <div style={{ position: "absolute", bottom: 110, left: 16, display: "flex", flexDirection: "column-reverse", gap: 8, zIndex: 20, perspective: 600 }}>
            {cards.slice(-2).map(c => <FloatingCard key={c.id} card={c} />)}
          </div>

          {/* Live transcript overlay — visible even when chat is closed */}
          {helena.transcript && (
            <div style={{ position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)", zIndex: 22, maxWidth: "min(480px,80vw)", pointerEvents: "none" }}>
              <div style={{ padding: "8px 14px", borderRadius: 20, background: "rgba(0,207,234,.08)", border: "1px dashed rgba(0,207,234,.30)", backdropFilter: "blur(8px)" }}>
                <span style={{ fontSize: 12, color: "rgba(255,255,255,.60)", fontStyle: "italic" }}>{helena.transcript}</span>
              </div>
            </div>
          )}

          {/* State / LLM source label */}
          <div style={{ position: "absolute", bottom: 84, left: "50%", transform: "translateX(-50%)", pointerEvents: "none", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
            <span style={{ fontSize: 12, fontWeight: 400, color: "rgba(255,255,255,.25)", letterSpacing: ".02em" }}>{stateLabel}</span>
            {llmSource && llmSource !== 'error' && (
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: llmSource === 'ollama' ? "rgba(134,239,172,.08)" : "rgba(0,207,234,.08)", border: `1px solid ${llmSource === 'ollama' ? "rgba(134,239,172,.20)" : "rgba(0,207,234,.20)"}`, color: llmSource === 'ollama' ? "rgba(134,239,172,.70)" : "rgba(0,207,234,.70)", letterSpacing: ".06em", fontWeight: 600 }}>
                {llmSource === 'ollama' ? '⬡ LOCAL' : '◈ CLOUD'}
              </span>
            )}
          </div>
        </div>

        <ActivityPanel items={items} latestId={latestId} open={panelOpen} onToggle={togglePanel} />
      </div>

      {/* Chat panel */}
      {chatOpen && (
        <ChatPanel
          messages={helena.messages}
          responding={helena.responding}
          transcript={helena.transcript}
          onSend={helena.sendMessage}
          onClose={() => setChatOpen(false)}
        />
      )}

      {/* Memory manager overlay */}
      <MemoryPanel />

      {/* Brain graph overlay */}
      <BrainGraphPanel />

      {/* News feed overlay */}
      <NewsPanel />

      <MicButton helena={helena} chatOpen={chatOpen} onChatToggle={toggleChat} />

      <style>{KEYFRAMES}</style>
    </div>
  );
}
