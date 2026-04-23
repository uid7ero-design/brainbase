"use client";

import { useRef, useState } from "react";
import { Send, Mic } from "lucide-react";

const PROMPTS = [
  "Summarise my week",
  "What should I focus on?",
  "Draft a strategy note",
  "Review pipeline",
  "Show me insights",
];

export default function ChatInput({ onSend, isThinking }) {
  const [val, setVal] = useState("");
  const ref = useRef(null);

  const send = () => {
    if (!val.trim() || isThinking) return;
    onSend(val.trim());
    setVal("");
  };

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 520,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 9,
          background: "rgba(255,255,255,.95)",
          border: "1.5px solid",
          borderColor: isThinking ? "rgba(107,92,231,.45)" : "rgba(107,92,231,.2)",
          borderRadius: 13,
          padding: "11px 13px",
          boxShadow: isThinking
            ? "0 0 0 4px rgba(107,92,231,.08),0 4px 18px rgba(0,0,0,.06)"
            : "0 4px 14px rgba(0,0,0,.06)",
          transition: "all .25s",
        }}
      >
        <Mic size={15} color={isThinking ? "#7B6BFF" : "#9898B0"} style={{ flexShrink: 0 }} />

        <input
          ref={ref}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={isThinking ? "BrainBase is thinking…" : "Ask BrainBase anything…"}
          disabled={isThinking}
          style={{
            flex: 1,
            border: "none",
            background: "transparent",
            fontSize: 13.5,
            color: "#1A1A2E",
            outline: "none",
            fontFamily: "inherit",
          }}
        />

        <span
          style={{
            fontSize: 10,
            color: "#C8C8D8",
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          ⌘K
        </span>

        <button
          onClick={send}
          disabled={!val.trim() || isThinking}
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "none",
            cursor: val.trim() && !isThinking ? "pointer" : "default",
            background:
              val.trim() && !isThinking
                ? "linear-gradient(140deg,#5946E8,#7B6BFF)"
                : "rgba(89,70,232,.1)",
            transition: "all .2s",
            flexShrink: 0,
          }}
        >
          <Send size={12} color={val.trim() && !isThinking ? "#fff" : "#9898B0"} />
        </button>
      </div>

      <div style={{ display: "flex", gap: 7, flexWrap: "wrap", justifyContent: "center" }}>
        {PROMPTS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setVal(p);
              ref.current?.focus();
            }}
            style={{
              padding: "6px 13px",
              borderRadius: 20,
              fontSize: 12,
              fontWeight: 500,
              border: "1px solid rgba(89,70,232,.18)",
              background: "rgba(255,255,255,.85)",
              color: "#707088",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontFamily: "inherit",
            }}
          >
            {p}
          </button>
        ))}
      </div>
    </div>
  );
}