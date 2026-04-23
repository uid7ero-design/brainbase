"use client";

import { TrendingUp, Sparkles, Zap, CheckCircle, ArrowUpRight } from "lucide-react";

const TYPE_CFG = {
  insight: {
    icon: TrendingUp,
    bg: "rgba(89,70,232,.08)",
    col: "#5946E8",
    lbl: "Insight",
  },
  summary: {
    icon: Sparkles,
    bg: "rgba(16,185,129,.08)",
    col: "#059669",
    lbl: "Summary",
  },
  automation: {
    icon: Zap,
    bg: "rgba(245,158,11,.08)",
    col: "#D97706",
    lbl: "Automation",
  },
  completed: {
    icon: CheckCircle,
    bg: "rgba(34,197,94,.08)",
    col: "#16A34A",
    lbl: "Done",
  },
};

function RCard({ item, isNew }) {
  const c = TYPE_CFG[item.type] || TYPE_CFG.insight;
  const I = c.icon;

  return (
    <div
      style={{
        background: "#fff",
        border: "1px solid rgba(0,0,0,.055)",
        borderRadius: 14,
        padding: "16px 18px",
        boxShadow: "0 2px 14px rgba(0,0,0,.04)",
        animation: isNew ? "cardIn .4s ease-out" : "none",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            flexShrink: 0,
            background: c.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <I size={14} color={c.col} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 3 }}>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 700,
                padding: "2px 6px",
                borderRadius: 20,
                background: c.bg,
                color: c.col,
                letterSpacing: ".04em",
              }}
            >
              {c.lbl}
            </span>
            <span style={{ fontSize: 10.5, color: "#B0B0C4" }}>{item.time}</span>
          </div>

          <div
            style={{
              fontSize: 12.5,
              fontWeight: 700,
              color: "#1A1A2E",
              lineHeight: 1.3,
            }}
          >
            {item.title}
          </div>
        </div>

        <button
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            background: "rgba(0,0,0,.04)",
            border: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          <ArrowUpRight size={11} color="#B0B0C4" />
        </button>
      </div>

      <p style={{ margin: 0, fontSize: 12, color: "#5B5B72", lineHeight: 1.6 }}>
        {item.content}
      </p>

      {item.tags && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
          {item.tags.map((t) => (
            <span
              key={t}
              style={{
                fontSize: 10.5,
                fontWeight: 500,
                padding: "2px 8px",
                borderRadius: 5,
                background: "rgba(0,0,0,.04)",
                color: "#707088",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ResponsePanel({ responses, latestId }) {
  return (
    <aside
      style={{
        width: 296,
        flexShrink: 0,
        background: "rgba(255,255,255,.48)",
        backdropFilter: "blur(20px)",
        borderLeft: "1px solid rgba(0,0,0,.055)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "18px 16px 14px",
          borderBottom: "1px solid rgba(0,0,0,.055)",
          flexShrink: 0,
        }}
      >
        <div style={{ fontSize: 13.5, fontWeight: 700, color: "#1A1A2E" }}>AI Outputs</div>
        <div style={{ fontSize: 11.5, color: "#9898B0", marginTop: 2 }}>
          {responses.length} items · updated live
        </div>
      </div>

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 14px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {responses.map((item) => (
          <RCard key={item.id} item={item} isNew={item.id === latestId} />
        ))}
      </div>
    </aside>
  );
}