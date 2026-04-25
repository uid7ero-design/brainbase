'use client';
import { useState, useRef, useEffect } from "react";
import { GLASS, CYAN } from "../../lib/utils/constants";

export function ChatPanel({ messages, responding, transcript, onSend, onClose }) {
  const [input, setInput] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, transcript]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    onSend(t);
  };

  return (
    <div style={{ position: "fixed", bottom: 100, left: "50%", transform: "translateX(-50%)", width: "min(560px,88vw)", zIndex: 60, display: "flex", flexDirection: "column", gap: 0, animation: "chatSlideUp .3s cubic-bezier(0.16,1,0.3,1)" }}>
      <div style={{ maxHeight: 340, overflowY: "auto", ...GLASS, borderRadius: "14px 14px 0 0", padding: "14px 14px 10px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "20px 0" }}>
            <div style={{ fontSize: 22, marginBottom: 8 }}>✦</div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,.56)" }}>Say something or type below</div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ maxWidth: "78%", padding: "8px 12px", borderRadius: m.role === "user" ? "12px 12px 3px 12px" : "12px 12px 12px 3px", background: m.role === "user" ? "rgba(0,207,234,.15)" : "rgba(255,255,255,.06)", border: m.role === "user" ? "1px solid rgba(0,207,234,.25)" : "1px solid rgba(255,255,255,.07)" }}>
              {m.role === "assistant" && <div style={{ fontSize: 9, fontWeight: 700, color: CYAN, letterSpacing: ".08em", marginBottom: 4 }}>HELENA</div>}
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.85)", lineHeight: 1.5 }}>{m.content}</div>
            </div>
          </div>
        ))}

        {transcript && (
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <div style={{ maxWidth: "78%", padding: "8px 12px", borderRadius: "12px 12px 3px 12px", background: "rgba(0,207,234,.08)", border: "1px dashed rgba(0,207,234,.25)" }}>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,.70)", lineHeight: 1.5, fontStyle: "italic" }}>{transcript}</div>
            </div>
          </div>
        )}

        {responding && (
          <div style={{ display: "flex", gap: 5, padding: "4px 0", alignItems: "center" }}>
            {[0, .2, .4].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: CYAN, opacity: .6, animation: `agentPulse 1s ${d}s ease-in-out infinite` }} />)}
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.50)", marginLeft: 4 }}>Helena is thinking…</span>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div style={{ display: "flex", ...GLASS, borderRadius: "0 0 14px 14px", borderTop: "1px solid rgba(255,255,255,.06)", padding: "10px 12px", alignItems: "center", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && submit()}
          placeholder="Type a message…"
          style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "rgba(255,255,255,.82)", fontSize: 12, padding: "2px 0" }}
        />
        <button onClick={submit} disabled={!input.trim() || responding}
          style={{ padding: "5px 12px", borderRadius: 8, background: CYAN, border: "none", color: "#080A10", fontSize: 11, fontWeight: 700, cursor: "pointer", opacity: (!input.trim() || responding) ? 0.4 : 1, transition: "opacity .2s" }}>
          Send
        </button>
        <button onClick={onClose} style={{ background: "none", border: "1px solid rgba(255,255,255,.08)", borderRadius: 8, color: "rgba(255,255,255,.56)", fontSize: 11, padding: "5px 10px", cursor: "pointer" }}>✕</button>
      </div>
    </div>
  );
}
