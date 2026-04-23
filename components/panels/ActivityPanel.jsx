'use client';
import { CYAN } from "../../lib/utils/constants";
import { PANEL_SECTIONS } from "../../lib/data/activities";
import { AGENTS } from "../../lib/data/agents";

export function ActivityPanel({ items, latestId, open, onToggle }) {
  return (
    <div style={{ width: open ? 320 : 36, flexShrink: 0, transition: "width 280ms cubic-bezier(0.16,1,0.3,1)", background: "rgba(8,11,20,.50)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", borderLeft: "1px solid rgba(255,255,255,.05)", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }}>
      <button onClick={onToggle} style={{ position: "absolute", top: 14, right: open ? 10 : "50%", transform: open ? "none" : "translateX(50%)", width: 20, height: 20, border: "1px solid rgba(255,255,255,.07)", borderRadius: 5, background: "rgba(255,255,255,.04)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, flexShrink: 0, transition: "right 280ms cubic-bezier(0.16,1,0.3,1), transform 280ms cubic-bezier(0.16,1,0.3,1)" }}>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5">
          {open ? <path d="M3 2l4 3-4 3" /> : <path d="M7 2L3 5l4 3" />}
        </svg>
      </button>

      {open && (
        <div style={{ paddingTop: 10, overflowY: "auto", flex: 1 }}>

          {/* Agents section */}
          <div style={{ padding: "4px 14px 8px" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.25)", letterSpacing: ".12em" }}>AGENTS</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 10px 10px" }}>
            {AGENTS.map(agent => (
              <div key={agent.id} style={{ padding: "9px 10px", borderRadius: 8, background: "rgba(255,255,255,.025)", border: "1px solid rgba(255,255,255,.04)", cursor: "pointer", transition: "all .2s" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 3 }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: agent.color, boxShadow: `0 0 6px ${agent.color}`, flexShrink: 0, animation: agent.status === "active" ? "agentPulse 2s ease-in-out infinite" : undefined }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.80)", flex: 1 }}>{agent.label}</span>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(255,255,255,.06)", color: "rgba(255,255,255,.30)" }}>{agent.tasks}</span>
                </div>
                <div style={{ fontSize: 9, color: "rgba(255,255,255,.28)", lineHeight: 1.4, paddingLeft: 14 }}>{agent.last}</div>
              </div>
            ))}
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "0 10px 10px" }} />

          {/* Activity feed */}
          <div style={{ padding: "0 14px 8px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.25)", letterSpacing: ".12em" }}>ACTIVITY</span>
            <span style={{ fontSize: 9, color: "rgba(255,255,255,.22)", letterSpacing: ".08em" }}>{items.length} TOTAL</span>
          </div>

          {PANEL_SECTIONS.map(sec => {
            const secItems = items.filter(i => i.type === sec.type);
            return (
              <div key={sec.type} style={{ marginBottom: 4 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "8px 14px 6px" }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: sec.color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(255,255,255,.25)", letterSpacing: ".12em", flex: 1 }}>{sec.label}</span>
                  <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(255,255,255,.05)", color: "rgba(255,255,255,.28)" }}>{secItems.length}</span>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 3, padding: "0 10px" }}>
                  {secItems.length === 0 && <div style={{ fontSize: 10, color: "rgba(255,255,255,.12)", padding: "4px 4px" }}>No items</div>}
                  {secItems.map(item => {
                    const isNew = item.id === latestId;
                    return (
                      <div key={item.id} style={{ padding: "9px 10px", borderRadius: 8, background: isNew ? "rgba(0,207,234,.06)" : "rgba(255,255,255,.025)", border: `1px solid ${isNew ? "rgba(0,207,234,.18)" : "rgba(255,255,255,.04)"}`, animation: "slideInRight .3s cubic-bezier(0.16,1,0.3,1) both", cursor: "pointer", transition: "all .3s" }}>
                        <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                          <div style={{ width: 4, height: 4, borderRadius: "50%", background: sec.color, marginTop: 4, flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.80)", lineHeight: 1.35, marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</div>
                            {item.sub && <div style={{ fontSize: 10, color: "rgba(255,255,255,.30)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.sub}</div>}
                            {item.action && <div style={{ fontSize: 9, color: "rgba(0,207,234,.45)", lineHeight: 1.35, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{item.action}</div>}
                          </div>
                          <span style={{ fontSize: 9, color: "rgba(255,255,255,.18)", flexShrink: 0, marginTop: 1 }}>{item.time}</span>
                        </div>
                        {isNew && (
                          <div style={{ display: "flex", gap: 5, marginTop: 7, paddingLeft: 10 }}>
                            {["Approve", "Dismiss"].map(a => (
                              <button key={a} style={{ fontSize: 9, padding: "3px 8px", borderRadius: 4, border: `1px solid ${a === "Approve" ? "rgba(0,207,234,.30)" : "rgba(255,255,255,.08)"}`, background: a === "Approve" ? "rgba(0,207,234,.08)" : "rgba(255,255,255,.03)", color: a === "Approve" ? CYAN : "rgba(255,255,255,.35)", cursor: "pointer", fontWeight: 500 }}>{a}</button>
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
        </div>
      )}
    </div>
  );
}
