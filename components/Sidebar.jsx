"use client";

import { LayoutDashboard, BookOpen, Zap, Settings, Brain, ChevronRight } from "lucide-react";

const NAV = [
  { icon: LayoutDashboard, label: "Dashboard", id: "dashboard" },
  { icon: BookOpen, label: "Memory", id: "memory" },
  { icon: Zap, label: "Automations", id: "automations" },
  { icon: Settings, label: "Settings", id: "settings" },
];

export default function Sidebar({ active, onChange }) {
  return (
    <aside
      style={{
        width: 210,
        flexShrink: 0,
        height: "100%",
        background: "#fff",
        borderRight: "1px solid rgba(0,0,0,.06)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ padding: "22px 18px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 9,
              background: "linear-gradient(140deg,#3B2FC9,#6B5CE7)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(107,92,231,.4)",
            }}
          >
            <Brain size={15} color="#fff" />
          </div>
          <div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 700,
                color: "#1A1A2E",
                letterSpacing: "-.02em",
              }}
            >
              BrainBase
            </div>
            <div
              style={{
                fontSize: 9.5,
                color: "#9898B0",
                fontWeight: 600,
                letterSpacing: ".05em",
              }}
            >
              AI INTELLIGENCE
            </div>
          </div>
        </div>
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "7px 10px",
            borderRadius: 20,
            background: "rgba(107,92,231,.07)",
            border: "1px solid rgba(107,92,231,.14)",
          }}
        >
          <div
            style={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: "#22C55E",
              boxShadow: "0 0 5px rgba(34,197,94,.6)",
            }}
          />
          <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5946E8" }}>
            Orb online
          </span>
        </div>
      </div>

      <nav
        style={{
          flex: 1,
          padding: "0 10px",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <div
          style={{
            fontSize: 9.5,
            fontWeight: 700,
            color: "#C0C0D0",
            letterSpacing: ".07em",
            padding: "0 8px 8px",
            textTransform: "uppercase",
          }}
        >
          Navigation
        </div>

        {NAV.map(({ icon: Icon, label, id }) => {
          const a = active === id;

          return (
            <button
              key={id}
              onClick={() => onChange(id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                padding: "9px 11px",
                borderRadius: 9,
                fontSize: 13,
                fontWeight: a ? 600 : 500,
                color: a ? "#3B2FC9" : "#8888A0",
                background: a ? "rgba(89,70,232,.1)" : "transparent",
                border: "none",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
              }}
            >
              <Icon size={14} color={a ? "#5946E8" : "#A0A0B8"} />
              <span style={{ flex: 1 }}>{label}</span>
              {a && <ChevronRight size={11} color="#A098E8" />}
            </button>
          );
        })}
      </nav>

      <div
        style={{
          padding: "12px",
          margin: "0 10px 16px",
          borderRadius: 12,
          background: "rgba(240,238,255,.6)",
          border: "1px solid rgba(107,92,231,.12)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: "50%",
              background: "linear-gradient(140deg,#5946E8,#9080FF)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 13,
              fontWeight: 700,
              color: "#fff",
            }}
          >
            J
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#1A1A2E" }}>
              James
            </div>
            <div style={{ fontSize: 11, color: "#9898B0" }}>Chief Executive</div>
          </div>
        </div>
      </div>
    </aside>
  );
}