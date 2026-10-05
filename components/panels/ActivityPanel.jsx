'use client';

import { PANEL_SECTIONS } from "../../lib/data/activities";
import { AGENTS } from "../../lib/data/agents";
import { SYSTEM_HEALTH } from "../../lib/hlna/wasteIntelligence";
import { getDeptConfig } from "../../lib/hlna/departmentConfigs";
import { BrainWidget } from "../layout/LeftSidebar";
import { useAppStore } from "../../lib/state/useAppStore";
import { buttonProps } from "../ui/app/Button";
import styles from "./ActivityPanel.module.css";

// Visual (remaining visual islands pass): the glass rail, white-alpha
// neutrals, neon glow dots, old violet chrome and the local Inter stack are
// replaced by app tokens (ActivityPanel.module.css). Monitor / alert /
// agent / health status map onto the semantic status tokens below — hue on
// the dot and edge, label text on --text-primary. PANEL_SECTIONS' per-type
// dot colour is kept as a data encoding. The collapse toggle is named and
// exposes aria-expanded; the non-interactive agent / activity cards no longer
// pretend to be clickable. Handlers (fireHelena + setChatOpen, onToggle)
// are unchanged.

const STATUS_CONFIG = {
  active:  { state: 'success',  pulse: true  },
  idle:    { state: 'inactive', pulse: false },
  standby: { state: 'warning',  pulse: false },
  warning: { state: 'danger',   pulse: true  },
  error:   { state: 'danger',   pulse: true  },
};

const HEALTH_STATUS = {
  active:  { state: 'success',  label: 'LIVE',    pulse: true  },
  warning: { state: 'danger',   label: 'ALERT',   pulse: true  },
  pending: { state: 'warning',  label: 'PENDING', pulse: false },
  idle:    { state: 'inactive', label: 'IDLE',    pulse: false },
};

function SectionHeader({ label, count, accent }) {
  return (
    <div className={styles.sectionHeader}>
      {accent && <span className={styles.sectionAccent} style={{ background: accent }} aria-hidden="true" />}
      <h3 className={styles.sectionTitle}>
        {label}
      </h3>
      {count != null && (
        <span className={styles.count}>
          {count}
        </span>
      )}
    </div>
  );
}

function Divider() {
  return <div className={styles.divider} aria-hidden="true" />;
}

const MONITOR_COLORS = {
  stable:  { state: 'success', label: 'STABLE'  },
  rising:  { state: 'danger',  label: 'RISING'  },
  falling: { state: 'warning', label: 'FALLING' },
  breach:  { state: 'danger',  label: 'BREACH'  },
};

const ALERT_COLORS = {
  high:   { state: 'danger'  },
  medium: { state: 'warning' },
  low:    { state: 'success' },
};

export function ActivityPanel({ items, latestId, open, onToggle }) {
  const { fireHelena, setChatOpen, activeDepartment } = useAppStore();
  const deptConfig = getDeptConfig(activeDepartment);
  return (
    <aside className={styles.rail} style={{ width: open ? 300 : 34 }} aria-label="Activity">
      {/* Toggle */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={open ? "Collapse activity panel" : "Expand activity panel"}
        className={styles.toggle}
      >
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          {open ? <path d="M3 2l4 3-4 3" /> : <path d="M7 2L3 5l4 3" />}
        </svg>
      </button>

      {open && (
        <>
          <div className={styles.scroll}>

            {/* ── LIVE SYSTEM PULSE header ──────────────────────────────── */}
            <div className={styles.pulseHeader}>
              <span className={`${styles.dot} ${styles.pulse}`} data-state="accent" aria-hidden="true" />
              <h2 className={styles.pulseTitle}>
                Live System Pulse
              </h2>
            </div>

            <Divider />

            {/* ── ACTIVE MONITORS ───────────────────────────────────────── */}
            <SectionHeader label="Active Monitors" count={deptConfig.monitors.length} accent="var(--status-danger)" />
            <ul className={styles.stack}>
              {deptConfig.monitors.map(mon => {
                const mc = MONITOR_COLORS[mon.status] ?? MONITOR_COLORS.stable;
                const pulse = mon.status === 'breach';
                return (
                  <li key={mon.id} className={styles.row} data-state={mc.state}>
                    <span className={`${styles.dot} ${pulse ? styles.pulse : ''}`} data-state={mc.state} aria-hidden="true" />
                    <span className={styles.label}>{mon.label}</span>
                    <span className={styles.arrow} aria-hidden="true">{mon.arrow}</span>
                    <span className={styles.value}>{mon.value}</span>
                    <span className={styles.chip} data-state={mc.state}>
                      {mc.label}
                    </span>
                  </li>
                );
              })}
            </ul>

            <Divider />

            {/* ── ALERTS ────────────────────────────────────────────────── */}
            <SectionHeader label="Attention Required" count={deptConfig.alerts.length} accent="var(--status-danger)" />
            <ul className={styles.stack}>
              {deptConfig.alerts.map(alert => {
                const ac = ALERT_COLORS[alert.severity] ?? ALERT_COLORS.medium;
                return (
                  <li key={alert.id}>
                    <button
                      type="button"
                      onClick={() => { fireHelena(alert.command); setChatOpen(true); }}
                      className={`${styles.row} ${styles.rowButton}`}
                      data-state={ac.state}
                    >
                      <span
                        className={`${styles.dot} ${alert.severity === 'high' ? styles.pulse : ''}`}
                        data-state={ac.state}
                        aria-hidden="true"
                      />
                      <span className={styles.label}>
                        <span className="sr-only">{alert.severity} severity: </span>
                        {alert.label}
                      </span>
                      <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" className={styles.chevron} aria-hidden="true">
                        <path d="M3 2l4 3-4 3" />
                      </svg>
                    </button>
                  </li>
                );
              })}
            </ul>

            <Divider />

            {/* ── AGENTS ───────────────────────────────────────────────── */}
            <SectionHeader label="Agents" count={AGENTS.length} accent="var(--brand-brainbase-accent)" />
            <ul className={styles.stack}>
              {AGENTS.map(agent => {
                const sc = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.idle;
                return (
                  <li key={agent.id} className={styles.agent}>
                    <div className={styles.agentTop}>
                      <span
                        className={`${styles.dot} ${sc.pulse ? styles.pulse : ''}`}
                        data-state={sc.state}
                        aria-hidden="true"
                      />
                      <span className={styles.agentName}>
                        {agent.label}
                        <span className="sr-only"> ({agent.status})</span>
                      </span>
                      <span className={styles.chip} data-state={sc.pulse ? sc.state : undefined}>
                        {agent.tasks}
                      </span>
                    </div>
                    <div className={styles.agentLast}>
                      {agent.last}
                    </div>
                  </li>
                );
              })}
            </ul>

            <Divider />

            {/* ── ACTIVITY FEED ─────────────────────────────────────────── */}
            <SectionHeader label="Activity" count={`${items.length}`} accent="var(--status-info)" />

            {PANEL_SECTIONS.map(sec => {
              const secItems = items.filter(i => i.type === sec.type);
              if (secItems.length === 0) return null;
              return (
                <div key={sec.type} className={styles.feedGroup}>
                  <div className={styles.feedHeader}>
                    {/* Per-type hue from PANEL_SECTIONS — data encoding, dot only. */}
                    <span className={styles.typeDot} style={{ background: sec.color }} aria-hidden="true" />
                    <h4 className={styles.feedTitle}>
                      {sec.label}
                    </h4>
                    <span className={styles.count}>
                      {secItems.length}
                    </span>
                  </div>
                  <ul className={styles.feedList}>
                    {secItems.map(item => {
                      const isNew = item.id === latestId;
                      return (
                        <li
                          key={item.id}
                          className={styles.item}
                          data-new={isNew ? 'true' : 'false'}
                        >
                          <div className={styles.itemTop}>
                            <span className={`${styles.typeDot} ${styles.itemDot}`} style={{ background: sec.color }} aria-hidden="true" />
                            <div className={styles.itemText}>
                              <div className={styles.itemTitle}>
                                {item.title}
                              </div>
                              {item.sub && (
                                <div className={styles.itemSub}>
                                  {item.sub}
                                </div>
                              )}
                            </div>
                            <span className={styles.itemTime}>{item.time}</span>
                          </div>
                          {isNew && (
                            <div className={styles.itemActions}>
                              {["Approve", "Dismiss"].map(a => (
                                <button
                                  type="button"
                                  key={a}
                                  {...buttonProps(a === "Approve" ? 'primary' : 'secondary', 'sm')}
                                >
                                  {a}
                                </button>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}

            <Divider />

            {/* ── SYSTEM HEALTH ─────────────────────────────────────────── */}
            <SectionHeader label="System Health" accent="var(--status-success)" />
            <ul className={styles.stack}>
              {SYSTEM_HEALTH.map(h => {
                const hc = HEALTH_STATUS[h.status] ?? HEALTH_STATUS.idle;
                return (
                  <li key={h.id} className={styles.row}>
                    <span
                      className={`${styles.dot} ${hc.pulse ? styles.pulse : ''}`}
                      data-state={hc.state}
                      aria-hidden="true"
                    />
                    <span className={styles.label}>{h.label}</span>
                    <span className={styles.chip} data-state={hc.state}>
                      {h.statusLabel}
                    </span>
                  </li>
                );
              })}
            </ul>

          </div>

          {/* ── Brain widget — pinned bottom ─────────────────────────── */}
          <div className={styles.widget}>
            <BrainWidget />
          </div>
        </>
      )}
    </aside>
  );
}
