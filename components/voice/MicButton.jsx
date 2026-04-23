'use client';
import { CYAN } from "../../lib/utils/constants";

export function MicButton({ helena, chatOpen, onChatToggle }) {
  const { listening, responding, conversational, micError, wakeActive } = helena;
  const active = listening || conversational;

  const hint = micError         ? micError
    : responding                ? "HELENA IS SPEAKING…"
    : listening                 ? "LISTENING…"
    : conversational            ? "TAP TO END · SPACE TO TALK"
    : wakeActive                ? `WAKE WORD ACTIVE · SAY "HEY HELENA"`
    : "TAP TO TALK · HOLD SPACE";

  const hintColor = micError
    ? "rgba(239,100,100,.75)"
    : responding || listening || conversational
    ? CYAN
    : wakeActive
    ? "rgba(255,255,255,.28)"
    : "rgba(255,255,255,.25)";

  function handleMic() {
    if (conversational) { helena.stopConversation(); return; }
    helena.startConversation();
  }

  return (
    <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, display: "flex", flexDirection: "column", alignItems: "center", paddingBottom: 22, gap: 8, pointerEvents: "none", zIndex: 50 }}>

      {/* Toolbar row */}
      <div style={{ display: "flex", gap: 8, pointerEvents: "auto", marginBottom: 2, alignItems: "center" }}>
        <button onClick={onChatToggle} style={{ padding: "5px 12px", borderRadius: 20, background: chatOpen ? "rgba(0,207,234,.12)" : "rgba(10,13,22,.70)", border: chatOpen ? "1px solid rgba(0,207,234,.35)" : "1px solid rgba(255,255,255,.08)", color: chatOpen ? CYAN : "rgba(255,255,255,.40)", fontSize: 10, fontWeight: 600, letterSpacing: ".05em", cursor: "pointer", backdropFilter: "blur(8px)", transition: "all .25s" }}>
          {chatOpen ? "CLOSE CHAT" : "OPEN CHAT"}
        </button>
      </div>

      {/* Mic button + ripple rings */}
      <div style={{ position: "relative", pointerEvents: "auto" }} onClick={handleMic}>
        {active && <>
          <div style={{ position: "absolute", inset: -4,  borderRadius: "50%", border: "2px solid rgba(0,207,234,.55)", animation: "micRipple 1.4s cubic-bezier(0.16,1,0.3,1) infinite" }} />
          <div style={{ position: "absolute", inset: -12, borderRadius: "50%", border: "1px solid rgba(0,207,234,.20)", animation: "micRipple 1.4s cubic-bezier(0.16,1,0.3,1) .3s infinite" }} />
        </>}

        <div style={{
          width: 58, height: 58, borderRadius: "50%", cursor: "pointer",
          background:  active ? "rgba(0,207,234,.12)"   : "rgba(10,13,22,.80)",
          border:      active ? `2px solid ${CYAN}`     : "1px solid rgba(255,255,255,.10)",
          boxShadow:   active ? "0 0 22px rgba(0,207,234,.5),0 0 55px rgba(0,207,234,.18)" : "0 4px 20px rgba(0,0,0,.6)",
          display: "flex", alignItems: "center", justifyContent: "center",
          backdropFilter: "blur(8px)", transition: "all .35s cubic-bezier(0.16,1,0.3,1)",
        }}>
          {responding
            ? /* pulsing dots when Helena speaks */
              <div style={{ display: "flex", gap: 3 }}>
                {[0, .15, .3].map(d => <div key={d} style={{ width: 5, height: 5, borderRadius: "50%", background: CYAN, animation: `agentPulse .9s ${d}s ease-in-out infinite` }} />)}
              </div>
            : active
            ? <svg width="18" height="18" viewBox="0 0 24 24" fill="rgba(255,255,255,.95)"><rect x="5" y="5" width="14" height="14" rx="3" /></svg>
            : <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.85)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="22"/><line x1="8" y1="22" x2="16" y2="22"/></svg>
          }
        </div>
      </div>

      <span style={{ fontSize: 10, letterSpacing: ".07em", color: hintColor, textTransform: "uppercase", pointerEvents: "none", transition: "color .3s" }}>{hint}</span>
    </div>
  );
}
