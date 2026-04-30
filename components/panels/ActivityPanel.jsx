'use client';

import { PANEL_SECTIONS } from "../../lib/data/activities";
import { AGENTS } from "../../lib/data/agents";
import { SYSTEM_HEALTH } from "../../lib/hlna/wasteIntelligence";
import { getDeptConfig } from "../../lib/hlna/departmentConfigs";
import { BrainWidget } from "../layout/LeftSidebar";
import { useAppStore } from "../../lib/state/useAppStore";

const FONT = "var(--font-inter),-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif";

const STATUS_CONFIG = {
  active:  { dot: '#34D399', glow: 'rgba(52,211,153,.45)',  pulse: true  },
  idle:    { dot: '#A78BFA', glow: 'rgba(167,139,250,.35)', pulse: false },
  standby: { dot: '#FBBF24', glow: 'rgba(251,191,36,.35)',  pulse: false },
  warning: { dot: '#FB7185', glow: 'rgba(251,113,133,.45)', pulse: true  },
  error:   { dot: '#FB7185', glow: 'rgba(251,113,133,.55)', pulse: true  },
};

const HEALTH_STATUS = {
  active:  { color: '#34D399', label: 'LIVE',    pulse: true  },
  warning: { color: '#FB7185', label: 'ALERT',   pulse: true  },
  pending: { color: '#FBBF24', label: 'PENDING', pulse: false },
  idle:    { color: '#52525B', label: 'IDLE',    pulse: false },
};

function SectionHeader({ label, count, accent }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px 5px" }}>
      {accent && <div style={{ width: 3, height: 12, borderRadius: 2, background: accent, flexShrink: 0 }} />}
      <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,.40)", letterSpacing: ".14em", flex: 1, textTransform: "uppercase" }}>
        {label}
      </span>
      {count != null && (
        <span style={{ fontSize: 8, padding: "1px 6px", borderRadius: 3, background: "rgba(255,255,255,.05)", color: "rgba(255,255,255,.38)", fontWeight: 600 }}>
          {count}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "4px 12px" }} />;
}

const MONITOR_COLORS = {
  stable:  { color: '#34D399', bg: 'rgba(52,211,153,.10)',  border: 'rgba(52,211,153,.20)',  label: 'STABLE'  },
  rising:  { color: '#FB7185', bg: 'rgba(251,113,133,.08)', border: 'rgba(251,113,133,.20)', label: 'RISING'  },
  falling: { color: '#FBBF24', bg: 'rgba(251,191,36,.08)',  border: 'rgba(251,191,36,.20)',  label: 'FALLING' },
  breach:  { color: '#FB7185', bg: 'rgba(251,113,133,.12)', border: 'rgba(251,113,133,.30)', label: 'BREACH'  },
};

const ALERT_COLORS = {
  high:   { color: '#FB7185', bg: 'rgba(251,113,133,.06)', border: 'rgba(251,113,133,.20)' },
  medium: { color: '#FBBF24', bg: 'rgba(251,191,36,.06)',  border: 'rgba(251,191,36,.18)'  },
  low:    { color: '#34D399', bg: 'rgba(52,211,153,.06)',  border: 'rgba(52,211,153,.15)'  },
};

export function ActivityPanel({ items, latestId, open, onToggle }) {
  const { fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const deptConfig = getDeptConfig(activeDepartment);
  return (
    <div style={{
      width: open ? 300 : 34, flexShrink: 0,
      transition: "width 280ms cubic-bezier(0.16,1,0.3,1)",
      background: "rgba(6,5,12,.65)", backdropFilter: "blur(16px)",
      borderLeft: "1px solid rgba(255,255,255,.05)",
      display: "flex", flexDirection: "column",
      overflow: "hidden", position: "relative",
      fontFamily: FONT,
    }}>
      {/* Toggle */}
      <button
        onClick={onToggle}
        style={{
          position: "absolute", top: 14,
          right: open ? 9 : "50%",
          transform: open ? "none" : "translateX(50%)",
          width: 19, height: 19,
          border: "1px solid rgba(255,255,255,.07)", borderRadius: 5,
          background: "rgba(255,255,255,.04)", cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          zIndex: 2, flexShrink: 0,
          transition: "right 280ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1)",
        }}
      >
        <svg width="7" height="7" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5">
          {open ? <path d="M3 2l4 3-4 3" /> : <path d="M7 2L3 5l4 3" />}
        </svg>
      </button>

      {open && (
        <>
          <div style={{ flex: 1, overflowY: "auto", paddingTop: 8, scrollbarWidth: "none" }}>

            {/* ── LIVE SYSTEM PULSE header ──────────────────────────────── */}
            <div style={{ padding: "10px 14px 8px", display: "flex", alignItems: "center", gap: 7 }}>
              <div style={{ width: 5, height: 5, borderRadius: "50%", background: "#A78BFA", boxShadow: "0 0 6px rgba(167,139,250,.60)", animation: "agentPulse 2s ease-in-out infinite" }} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".14em", color: "rgba(167,139,250,.80)", textTransform: "uppercase" }}>
                Live System Pulse
              </span>
            </div>

            <Divider />

            {/* ── ACTIVE MONITORS ───────────────────────────────────────── */}
            <SectionHeader label="Active Monitors" count={deptConfig.monitors.length} accent="#FB7185" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 9px 8px" }}>
              {deptConfig.monitors.map(mon => {
                const mc = MONITOR_COLORS[mon.status] ?? MONITOR_COLORS.stable;
                const pulse = mon.status === 'breach';
                return (
                  <div key={mon.id} style={{
                    display: "flex", alignItems: "center", gap: 8,
                    padding: "8px 10px", borderRadius: 7,
                    background: mc.bg, border: `1px solid ${mc.border}`,
                  }}>
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: mc.color, boxShadow: `0 0 6px ${mc.color}55`, flexShrink: 0,
                      animation: pulse ? "agentPulse 2s ease-in-out infinite" : undefined,
                    }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.70)", flex: 1, fontWeight: 500 }}>{mon.label}</span>
                    <span style={{ fontSize: 12, color: mc.color, fontWeight: 700, flexShrink: 0 }}>{mon.arrow}</span>
                    <span style={{ fontSize: 11, color: "rgba(255,255,255,.80)", fontWeight: 700, fontFamily: "monospace", flexShrink: 0 }}>{mon.value}</span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                      color: mc.color, padding: "1px 5px", borderRadius: 3,
                      background: `${mc.color}18`, border: `1px solid ${mc.color}30`, flexShrink: 0,
                    }}>
                      {mc.label}
                    </span>
                  </div>
                );
              })}
            </div>

            <Divider />

            {/* ── ALERTS ────────────────────────────────────────────────── */}
            <SectionHeader label="Attention Required" count={deptConfig.alerts.length} accent="#FB7185" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 9px 8px" }}>
              {deptConfig.alerts.map(alert => {
                const ac = ALERT_COLORS[alert.severity] ?? ALERT_COLORS.medium;
                return (
                  <button
                    key={alert.id}
                    onClick={() => { fireHelena(alert.command); setChatOpen(true); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "8px 10px", borderRadius: 7, width: "100%",
                      background: ac.bg, border: `1px solid ${ac.border}`,
                      cursor: "pointer", textAlign: "left", transition: "all .15s",
                      fontFamily: FONT,
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = `${ac.bg.replace('.06', '.12')}`; e.currentTarget.style.borderColor = ac.color + '50'; }}
                    onMouseLeave={e => { e.currentTarget.style.background = ac.bg; e.currentTarget.style.borderColor = ac.border; }}
                  >
                    <div style={{
                      width: 5, height: 5, borderRadius: "50%",
                      background: ac.color, boxShadow: `0 0 5px ${ac.color}55`, flexShrink: 0,
                      animation: alert.severity === 'high' ? "agentPulse 2s ease-in-out infinite" : undefined,
                    }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.72)", flex: 1, lineHeight: 1.3, fontWeight: 500 }}>{alert.label}</span>
                    <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,.25)" strokeWidth="1.5" style={{ flexShrink: 0 }}>
                      <path d="M3 2l4 3-4 3" />
                    </svg>
                  </button>
                );
              })}
            </div>

            <Divider />

            {/* ── AGENTS ───────────────────────────────────────────────── */}
            <SectionHeader label="Agents" count={AGENTS.length} accent="#A78BFA" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 9px 8px" }}>
              {AGENTS.map(agent => {
                const sc = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
                return (
                  <div
                    key={agent.id}
                    style={{
                      padding: "9px 10px", borderRadius: 8,
                      background: "rgba(255,255,255,.025)",
                      border: "1px solid rgba(255,255,255,.05)",
                      cursor: "pointer", transition: "all .2s",
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = "rgba(255,255,255,.04)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.08)"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "rgba(255,255,255,.025)"; e.currentTarget.style.borderColor = "rgba(255,255,255,.05)"; }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                      <div style={{
                        width: 7, height: 7, borderRadius: "50%",
                        background: sc.dot, boxShadow: `0 0 7px ${sc.glow}`,
                        flexShrink: 0,
                        animation: sc.pulse ? "agentPulse 2s ease-in-out infinite" : undefined,
                      }} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.82)", flex: 1, lineHeight: 1.2 }}>
                        {agent.label}
                      </span>
                      <span style={{
                        fontSize: 8, padding: "1px 5px", borderRadius: 3,
                        background: sc.pulse ? `${sc.glow.replace('.45', '.12').replace('.35', '.10')}` : "rgba(255,255,255,.05)",
                        color: sc.pulse ? sc.dot : "rgba(255,255,255,.42)",
                        fontWeight: 700, letterSpacing: ".04em",
                      }}>
                        {agent.tasks}
                      </span>
                    </div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,.38)", lineHeight: 1.4, paddingLeft: 14 }}>
                      {agent.last}
                    </div>
                  </div>
                );
              })}
            </div>

            <Divider />

            {/* ── ACTIVITY FEED ─────────────────────────────────────────── */}
            <SectionHeader label="Activity" count={`${items.length}`} accent="#38BDF8" />

            {PANEL_SECTIONS.map(sec => {
              const secItems = items.filter(i => i.type === sec.type);
              if (secItems.length === 0) return null;
              return (
                <div key={sec.type} style={{ marginBottom: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 14px 4px" }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: sec.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.38)", letterSpacing: ".12em", flex: 1, textTransform: "uppercase" }}>
                      {sec.label}
                    </span>
                    <span style={{ fontSize: 8, padding: "1px 4px", borderRadius: 3, background: "rgba(255,255,255,.04)", color: "rgba(255,255,255,.35)" }}>
                      {secItems.length}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 9px" }}>
                    {secItems.map(item => {
                      const isNew = item.id === latestId;
                      return (
                        <div
                          key={item.id}
                          style={{
                            padding: "8px 10px", borderRadius: 7,
                            background: isNew ? "rgba(124,58,237,.07)" : "rgba(255,255,255,.02)",
                            border: `1px solid ${isNew ? "rgba(124,58,237,.22)" : "rgba(255,255,255,.04)"}`,
                            animation: "slideInRight .3s cubic-bezier(0.16,1,0.3,1) both",
                            cursor: "pointer", transition: "all .2s",
                          }}
                          onMouseEnter={e => { e.currentTarget.style.background = isNew ? "rgba(124,58,237,.10)" : "rgba(255,255,255,.04)"; }}
                          onMouseLeave={e => { e.currentTarget.style.background = isNew ? "rgba(124,58,237,.07)" : "rgba(255,255,255,.02)"; }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                            <div style={{ width: 4, height: 4, borderRadius: "50%", background: sec.color, marginTop: 4, flexShrink: 0 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.80)", lineHeight: 1.3, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.title}
                              </div>
                              {item.sub && (
                                <div style={{ fontSize: 10, color: "rgba(255,255,255,.42)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {item.sub}
                                </div>
                              )}
                            </div>
                            <span style={{ fontSize: 9, color: "rgba(255,255,255,.28)", flexShrink: 0, marginTop: 1 }}>{item.time}</span>
                          </div>
                          {isNew && (
                            <div style={{ display: "flex", gap: 5, marginTop: 6, paddingLeft: 10 }}>
                              {["Approve", "Dismiss"].map(a => (
                                <button
                                  key={a}
                                  style={{
                                    fontSize: 9, padding: "3px 8px", borderRadius: 4, fontWeight: 600,
                                    border: `1px solid ${a === "Approve" ? "rgba(124,58,237,.32)" : "rgba(255,255,255,.08)"}`,
                                    background: a === "Approve" ? "rgba(124,58,237,.10)" : "rgba(255,255,255,.03)",
                                    color: a === "Approve" ? "#C4B5FD" : "rgba(255,255,255,.35)",
                                    cursor: "pointer", fontFamily: FONT,
                                  }}
                                >
                                  {a}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            <Divider />

            {/* ── SYSTEM HEALTH ─────────────────────────────────────────── */}
            <SectionHeader label="System Health" accent="#34D399" />
            <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 9px 10px" }}>
              {SYSTEM_HEALTH.map(h => {
                const hc = HEALTH_STATUS[h.status] ?? HEALTH_STATUS.idle;
                return (
                  <div
                    key={h.id}
                    style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "7px 10px", borderRadius: 7,
                      background: "rgba(255,255,255,.02)",
                      border: "1px solid rgba(255,255,255,.04)",
                    }}
                  >
                    <div style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: hc.color, boxShadow: `0 0 6px ${hc.color}55`,
                      flexShrink: 0,
                      animation: hc.pulse ? "agentPulse 2.5s ease-in-out infinite" : undefined,
                    }} />
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.62)", flex: 1, fontWeight: 500 }}>{h.label}</span>
                    <span style={{
                      fontSize: 8, fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase",
                      color: hc.color, padding: "1px 6px", borderRadius: 3,
                      background: `${hc.color}14`,
                      border: `1px solid ${hc.color}30`,
                    }}>
                      {h.statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>

          </div>

          {/* ── Brain widget — pinned bottom ─────────────────────────── */}
          <div style={{ flexShrink: 0, borderTop: "1px solid rgba(255,255,255,.05)" }}>
            <BrainWidget />
          </div>
        </>
      )}
    </div>
  );
}
