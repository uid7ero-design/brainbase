'use client';
import { useState, useEffect, useRef } from 'react';
import { CYAN } from "../../lib/utils/constants";
import { useWeather } from "../../hooks/useWeather";
import { useSpotify } from "../../hooks/useSpotify";
import { useAppStore } from "../../lib/state/useAppStore";
import { InlineBrainGraph } from "../panels/BrainGraphPanel";
import { useTasks } from "../../hooks/useTasks";
import { memoryManager } from "../../lib/memory/memoryManager";
import { useCalendar } from "../../hooks/useCalendar";

const NAV_ITEMS = [
  { label: "Dashboard",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> },
  { label: "Memory",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg> },
  { label: "Integrations",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg> },
  { label: "Analytics",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg> },
  { label: "News",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg> },
  { label: "Settings",
    icon: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg> },
];

const CLOCKS_KEY  = 'brainbase:clocks';
const METRICS_KEY = 'brainbase:metrics';

const DEFAULT_CLOCKS = [
  { id: 1, label: 'Adelaide', tz: 'Australia/Adelaide' },
  { id: 2, label: 'London',   tz: 'Europe/London' },
  { id: 3, label: 'New York', tz: 'America/New_York' },
];

const DEFAULT_METRICS = [
  { id: 1, label: 'Metric 1', url: '', path: '' },
  { id: 2, label: 'Metric 2', url: '', path: '' },
  { id: 3, label: 'Metric 3', url: '', path: '' },
];

// ── Agenda + Pomodoro ────────────────────────────────────────────────────────
function AgendaWidget() {
  const { tasks, add, toggle, clearDone } = useTasks();
  const [input, setInput]   = useState('');
  const [mode, setMode]     = useState('work');
  const [seconds, setSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      setSeconds(s => {
        if (s <= 1) {
          setRunning(false);
          const next = mode === 'work' ? 'break' : 'work';
          setMode(next);
          return next === 'work' ? 25 * 60 : 5 * 60;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [running, mode]);

  function addTask() {
    if (!input.trim()) return;
    add(input.trim());
    setInput('');
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');
  const pending = tasks.filter(t => !t.done);
  const done    = tasks.filter(t => t.done);
  const accent  = mode === 'work' ? CYAN : "rgba(134,239,172,.8)";

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>AGENDA</span>
        <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: "monospace", color: accent, fontWeight: 700 }}>{mm}:{ss}</span>
        <button onClick={() => setRunning(r => !r)} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: accent }}>
          {running
            ? <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            : <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
        </button>
        <button onClick={() => { setRunning(false); setSeconds(mode === 'work' ? 25 * 60 : 5 * 60); }}
          style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(255,255,255,.42)" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
        </button>
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
        {['work', 'break'].map(m => (
          <button key={m} onClick={() => { setRunning(false); setMode(m); setSeconds(m === 'work' ? 25 * 60 : 5 * 60); }}
            style={{ flex: 1, padding: "3px 0", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 8, fontWeight: 700, letterSpacing: ".06em",
              background: mode === m ? (m === 'work' ? "rgba(124,58,237,.10)" : "rgba(134,239,172,.10)") : "rgba(255,255,255,.03)",
              color: mode === m ? (m === 'work' ? CYAN : "rgba(134,239,172,.8)") : "rgba(255,255,255,.20)" }}>
            {m === 'work' ? 'FOCUS 25' : 'BREAK 5'}
          </button>
        ))}
      </div>

      {pending.length > 0 && (
        <div style={{ marginBottom: 7, display: "flex", flexDirection: "column", gap: 3 }}>
          {pending.slice(0, 6).map(task => (
            <button key={task.id} onClick={() => toggle(task.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 7, background: "none", border: "none", cursor: "pointer", padding: "2px 0", textAlign: "left" }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, border: "1px solid rgba(124,58,237,.35)", flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 10, color: "rgba(255,255,255,.65)", lineHeight: 1.3, flex: 1 }}>{task.text}</span>
            </button>
          ))}
        </div>
      )}

      {done.length > 0 && (
        <div style={{ marginBottom: 7 }}>
          {done.slice(-2).map(task => (
            <button key={task.id} onClick={() => toggle(task.id)}
              style={{ display: "flex", alignItems: "flex-start", gap: 7, background: "none", border: "none", cursor: "pointer", padding: "2px 0", textAlign: "left", opacity: 0.4 }}>
              <div style={{ width: 12, height: 12, borderRadius: 3, border: "1px solid rgba(255,255,255,.15)", background: "rgba(255,255,255,.10)", flexShrink: 0, marginTop: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.5)" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <span style={{ fontSize: 10, color: "rgba(255,255,255,.52)", lineHeight: 1.3, flex: 1, textDecoration: "line-through" }}>{task.text}</span>
            </button>
          ))}
          <button onClick={clearDone} style={{ fontSize: 9, color: "rgba(255,255,255,.62)", background: "none", border: "none", cursor: "pointer", padding: "2px 0" }}>
            clear {done.length} done
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: 5 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && addTask()}
          placeholder="Add task…"
          style={{ flex: 1, padding: "5px 8px", borderRadius: 6, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.75)", fontSize: 10, outline: "none" }}
        />
        <button onClick={addTask} style={{ padding: "5px 10px", borderRadius: 6, background: "rgba(124,58,237,.08)", border: "1px solid rgba(124,58,237,.20)", color: CYAN, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>+</button>
      </div>
    </div>
  );
}

// ── World Clocks ─────────────────────────────────────────────────────────────
function ClocksWidget() {
  const [clocks] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_CLOCKS;
    try { return JSON.parse(localStorage.getItem(CLOCKS_KEY)) ?? DEFAULT_CLOCKS; } catch { return DEFAULT_CLOCKS; }
  });
  const [times, setTimes] = useState({});

  useEffect(() => {
    function tick() {
      const now = new Date();
      const t = {};
      clocks.forEach(c => {
        try { t[c.id] = now.toLocaleTimeString('en-GB', { timeZone: c.tz, hour: '2-digit', minute: '2-digit' }); }
        catch { t[c.id] = '--:--'; }
      });
      setTimes(t);
    }
    tick();
    const id = setInterval(tick, 15000);
    return () => clearInterval(id);
  }, [clocks]);

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>WORLD CLOCKS</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {clocks.map(c => (
          <div key={c.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.38)" }}>{c.label}</span>
            <span style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,.80)", fontFamily: "monospace", letterSpacing: ".02em" }}>{times[c.id] ?? '--:--'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Memory Snapshot ──────────────────────────────────────────────────────────
function MemoryWidget() {
  const [memories, setMemories] = useState([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setMemories(memoryManager.getLongTerm(3));
  }, [tick]);

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,130,255,.7)" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>MEMORY</span>
        <button onClick={() => setTick(t => t + 1)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(255,255,255,.42)" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
        </button>
      </div>
      {memories.length === 0 ? (
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.62)", fontStyle: "italic" }}>No memories yet. Ask HLNA something.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {memories.map((m, i) => (
            <div key={i} style={{ fontSize: 10, color: "rgba(255,255,255,.70)", lineHeight: 1.4, padding: "4px 7px", borderRadius: 5, background: "rgba(180,130,255,.05)", border: "1px solid rgba(180,130,255,.10)" }}>
              {m.fact}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Quick Metrics ────────────────────────────────────────────────────────────
function MetricsWidget() {
  const [config, setConfig] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_METRICS;
    try { return JSON.parse(localStorage.getItem(METRICS_KEY)) ?? DEFAULT_METRICS; } catch { return DEFAULT_METRICS; }
  });
  const [values, setValues]   = useState({});
  const [editId, setEditId]   = useState(null);
  const [editData, setEditData] = useState({ label: '', url: '', path: '' });

  useEffect(() => {
    try { localStorage.setItem(METRICS_KEY, JSON.stringify(config)); } catch {}
  }, [config]);

  useEffect(() => {
    async function poll() {
      for (const m of config) {
        if (!m.url) continue;
        try {
          const r = await fetch('/api/metrics', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: m.url, path: m.path }) });
          const d = await r.json();
          if (d.value !== undefined) setValues(prev => ({ ...prev, [m.id]: String(d.value) }));
        } catch {}
      }
    }
    poll();
    const id = setInterval(poll, 60000);
    return () => clearInterval(id);
  }, [config]);

  function startEdit(m) { setEditId(m.id); setEditData({ label: m.label, url: m.url, path: m.path }); }
  function saveEdit() { setConfig(prev => prev.map(m => m.id === editId ? { ...m, ...editData } : m)); setEditId(null); }

  const inputSx = { width: "100%", boxSizing: "border-box", marginBottom: 4, padding: "4px 6px", borderRadius: 4, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.10)", color: "rgba(255,255,255,.75)", fontSize: 9, outline: "none" };

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>METRICS</span>
      </div>
      {config.map(m => editId === m.id ? (
        <div key={m.id} style={{ marginBottom: 10, padding: "8px", borderRadius: 6, background: "rgba(124,58,237,.04)", border: "1px solid rgba(124,58,237,.15)" }}>
          <input value={editData.label} onChange={e => setEditData(p => ({ ...p, label: e.target.value }))} placeholder="Label" style={inputSx} />
          <input value={editData.url}   onChange={e => setEditData(p => ({ ...p, url: e.target.value }))}   placeholder="URL (optional)" style={inputSx} />
          <input value={editData.path}  onChange={e => setEditData(p => ({ ...p, path: e.target.value }))}  placeholder="JSON path e.g. data.count" style={{ ...inputSx, marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 4 }}>
            <button onClick={saveEdit} style={{ flex: 1, padding: "3px 0", borderRadius: 4, background: "rgba(124,58,237,.10)", border: "1px solid rgba(124,58,237,.25)", color: CYAN, fontSize: 9, fontWeight: 600, cursor: "pointer" }}>Save</button>
            <button onClick={() => setEditId(null)} style={{ padding: "3px 8px", borderRadius: 4, background: "none", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.46)", fontSize: 9, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      ) : (
        <div key={m.id} style={{ display: "flex", alignItems: "center", marginBottom: 10, gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 8, color: "rgba(255,255,255,.50)", letterSpacing: ".06em", fontWeight: 600, marginBottom: 1 }}>{m.label.toUpperCase()}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "rgba(255,255,255,.80)", fontFamily: "monospace", letterSpacing: "-.02em", lineHeight: 1 }}>
              {values[m.id] ?? (m.url ? '…' : '--')}
            </div>
          </div>
          <button onClick={() => startEdit(m)} style={{ background: "none", border: "none", cursor: "pointer", padding: 3, color: "rgba(255,255,255,.38)", flexShrink: 0 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </div>
      ))}
    </div>
  );
}

// ── News Feed Widget ──────────────────────────────────────────────────────────
const CAT_DOT = { tech: "rgba(124,58,237,.8)", ai: "rgba(130,180,255,.8)", cyber: "rgba(255,120,80,.8)" };

function NewsWidget() {
  const [articles, setArticles] = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [expanded, setExpanded] = useState(false);
  const setNewsOpen = useAppStore(s => s.setNewsOpen);

  async function fetchNews() {
    try {
      const r = await fetch('/api/news');
      const d = await r.json();
      setArticles(d.articles ?? []);
    } catch {} finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchNews();
    const id = setInterval(fetchNews, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const visible = expanded ? articles : articles.slice(0, 4);

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>NEWS FEED</span>
        <button onClick={fetchNews} style={{ background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(255,255,255,.42)" }}>
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
        </button>
        <button onClick={() => setNewsOpen(true)} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2, color: "rgba(124,58,237,.45)", fontSize: 8, fontWeight: 600, letterSpacing: ".04em" }}>
          ALL →
        </button>
      </div>
      {loading ? (
        <div style={{ height: 28, display: "flex", alignItems: "center" }}>
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(124,58,237,.4)", animation: "agentPulse 1.2s ease-in-out infinite" }} />
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {visible.map((a, i) => (
              <a key={a.id ?? i} href={a.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "block", textDecoration: "none" }}
                onMouseEnter={e => e.currentTarget.querySelector('.nt').style.color = "rgba(255,255,255,.85)"}
                onMouseLeave={e => e.currentTarget.querySelector('.nt').style.color = "rgba(255,255,255,.55)"}>
                <div className="nt" style={{ fontSize: 10, color: "rgba(255,255,255,.74)", lineHeight: 1.35, marginBottom: 2, transition: "color .15s" }}>
                  {a.title}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 4, height: 4, borderRadius: "50%", background: CAT_DOT[a.category] ?? CAT_DOT.tech, flexShrink: 0 }} />
                  <span style={{ fontSize: 8, color: "rgba(255,255,255,.46)" }}>{a.source}</span>
                  {a.points != null && <span style={{ fontSize: 8, color: "rgba(255,180,0,.45)" }}>▲{a.points}</span>}
                </div>
              </a>
            ))}
          </div>
          {articles.length > 4 && (
            <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 7, background: "none", border: "none", cursor: "pointer", fontSize: 9, color: "rgba(255,255,255,.42)", padding: 0 }}>
              {expanded ? 'show less ↑' : `+${articles.length - 4} more ↓`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ── Weather ──────────────────────────────────────────────────────────────────
function WeatherWidget() {
  const { loading, current, forecast } = useWeather();

  if (loading) return (
    <div style={{ padding: "12px 14px", borderTop: "1px solid rgba(255,255,255,.05)", display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(124,58,237,.4)", animation: "agentPulse 1.2s ease-in-out infinite" }} />
      <span style={{ fontSize: 10, color: "rgba(255,255,255,.42)" }}>Loading weather…</span>
    </div>
  );
  if (!current) return null;

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.28)" strokeWidth="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>SEAFORD RISE</span>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.38)", marginLeft: "auto" }}>SA</span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 28, lineHeight: 1 }}>{current.icon}</span>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.90)", lineHeight: 1, letterSpacing: "-.03em" }}>{current.temp}°</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.62)", marginTop: 2 }}>{current.label}</div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.56)" }}>Feels {current.feelsLike}°</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.50)", marginTop: 2 }}>💧 {current.humidity}%</div>
          <div style={{ fontSize: 10, color: "rgba(255,255,255,.50)", marginTop: 2 }}>💨 {current.wind} km/h</div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 3, marginTop: 8 }}>
        {forecast.slice(0, 5).map((day, i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2, padding: "5px 2px", borderRadius: 6, background: i === 0 ? "rgba(124,58,237,.06)" : "rgba(255,255,255,.03)", border: i === 0 ? "1px solid rgba(124,58,237,.12)" : "1px solid transparent" }}>
            <span style={{ fontSize: 8, color: i === 0 ? "rgba(124,58,237,.8)" : "rgba(255,255,255,.30)", fontWeight: 600, letterSpacing: ".04em" }}>{i === 0 ? "NOW" : day.day.toUpperCase()}</span>
            <span style={{ fontSize: 13, lineHeight: 1 }}>{day.icon}</span>
            <span style={{ fontSize: 9, fontWeight: 600, color: "rgba(255,255,255,.75)" }}>{day.high}°</span>
            <span style={{ fontSize: 8, color: "rgba(255,255,255,.52)" }}>{day.low}°</span>
            {day.rain > 0 && <span style={{ fontSize: 7, color: "rgba(100,200,255,.6)" }}>{day.rain}%</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Spotify ──────────────────────────────────────────────────────────────────
const SPOTIFY_ICON = (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="#1DB954">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
  </svg>
);

function SpotifyWidget() {
  const { connected, loading, isPlaying, track, connect, toggle, next, prev, search, playUri } = useSpotify();
  const [searchMode, setSearchMode] = useState(false);
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const inputRef = useRef(null);

  const progressPct = track ? Math.min(100, (track.progress / track.duration) * 100) : 0;

  useEffect(() => {
    if (searchMode) setTimeout(() => inputRef.current?.focus(), 60);
    else { setQuery(''); setResults([]); }
  }, [searchMode]);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      const r = await search(query);
      setResults(r);
      setSearching(false);
    }, 380);
    return () => clearTimeout(t);
  }, [query, search]);

  function handlePlay(uri) { playUri(uri); setSearchMode(false); }

  return (
    <div style={{ padding: "14px 14px 16px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {SPOTIFY_ICON}
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>NOW PLAYING</span>
        {connected && (
          <button onClick={() => setSearchMode(m => !m)} title={searchMode ? "Close search" : "Search music"}
            style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: 2, color: searchMode ? "#1DB954" : "rgba(255,255,255,.45)", display: "flex", alignItems: "center" }}>
            {searchMode
              ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              : <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>}
          </button>
        )}
        {connected && !searchMode && (
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "#1DB954", boxShadow: "0 0 5px #1DB954", flexShrink: 0 }} />
        )}
      </div>

      {loading ? (
        <div style={{ height: 38, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(29,185,84,.4)", animation: "agentPulse 1.2s ease-in-out infinite" }} />
        </div>
      ) : !connected ? (
        <button onClick={connect} style={{ width: "100%", padding: "8px 0", borderRadius: 7, background: "rgba(29,185,84,.10)", border: "1px solid rgba(29,185,84,.25)", color: "#1DB954", fontSize: 11, fontWeight: 600, cursor: "pointer", letterSpacing: ".02em" }}>
          Connect Spotify
        </button>
      ) : searchMode ? (
        <div>
          <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search songs, artists…"
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 6, background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.10)", color: "rgba(255,255,255,.85)", fontSize: 11, outline: "none", marginBottom: 8 }} />
          {searching ? (
            <div style={{ height: 28, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(29,185,84,.4)", animation: "agentPulse 1.2s ease-in-out infinite" }} />
            </div>
          ) : results.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {results.slice(0, 5).map(t => (
                <button key={t.id} onClick={() => handlePlay(t.uri)}
                  style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 4px 4px 2px", background: "none", border: "none", cursor: "pointer", borderRadius: 5, textAlign: "left" }}>
                  {t.albumArt
                    ? <img src={t.albumArt} alt="" style={{ width: 30, height: 30, borderRadius: 3, objectFit: "cover", flexShrink: 0 }} />
                    : <div style={{ width: 30, height: 30, borderRadius: 3, background: "rgba(29,185,84,.10)", flexShrink: 0 }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: "rgba(255,255,255,.80)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 9, color: "rgba(255,255,255,.56)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.artist}</div>
                  </div>
                </button>
              ))}
            </div>
          ) : query.trim() ? (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.42)", textAlign: "center", padding: "10px 0" }}>No results</div>
          ) : (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.38)", textAlign: "center", padding: "10px 0" }}>Type to search</div>
          )}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 9 }}>
            {track?.albumArt
              ? <img src={track.albumArt} alt="album" style={{ width: 38, height: 38, borderRadius: 5, objectFit: "cover", flexShrink: 0 }} />
              : <div style={{ width: 38, height: 38, borderRadius: 5, background: "rgba(29,185,84,.10)", border: "1px solid rgba(29,185,84,.20)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="rgba(29,185,84,.5)"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>
                </div>}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.82)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 2 }}>
                {track?.name || "Nothing playing"}
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,.56)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {track?.artist || "Use 🔍 to find something"}
              </div>
            </div>
          </div>
          <div style={{ height: 2, borderRadius: 1, background: "rgba(255,255,255,.08)", marginBottom: 9, overflow: "hidden" }}>
            <div style={{ width: `${progressPct}%`, height: "100%", background: "#1DB954", borderRadius: 1, transition: "width .5s linear" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 18 }}>
            <button onClick={prev} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", opacity: .55 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5" stroke="white" strokeWidth="2.5"/></svg>
            </button>
            <button onClick={toggle} style={{ width: 30, height: 30, borderRadius: "50%", background: "rgba(29,185,84,.15)", border: "1px solid rgba(29,185,84,.35)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
              {isPlaying
                ? <svg width="10" height="10" viewBox="0 0 24 24" fill="#1DB954"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
                : <svg width="10" height="10" viewBox="0 0 24 24" fill="#1DB954"><polygon points="5 3 19 12 5 21 5 3"/></svg>}
            </button>
            <button onClick={next} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", opacity: .55 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19" stroke="white" strokeWidth="2.5"/></svg>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ── Brain / Obsidian connector ───────────────────────────────────────────────
export function BrainWidget() {
  const [status, setStatus]   = useState(null);
  const [editing, setEditing] = useState(false);
  const [input, setInput]     = useState('');
  const [saving, setSaving]   = useState(false);
  const inputRef = useRef(null);

  async function loadStatus() {
    try { const r = await fetch('/api/brain'); setStatus(await r.json()); } catch {}
  }

  useEffect(() => { loadStatus(); const t = setInterval(loadStatus, 3000); return () => clearInterval(t); }, []);
  useEffect(() => { if (editing) setTimeout(() => inputRef.current?.focus(), 60); }, [editing]);

  async function save() {
    if (!input.trim()) return;
    setSaving(true);
    try {
      await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'configure', vaultPath: input.trim() }) });
      setEditing(false);
      loadStatus();
    } finally { setSaving(false); }
  }

  async function syncNow() {
    await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sync' }) });
    loadStatus();
  }

  async function forget() {
    await fetch('/api/brain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'forget' }) });
    setStatus(null);
    loadStatus();
  }

  const syncing   = status?.status?.state === 'syncing';
  const hasVault  = !!status?.vaultPath;
  const vaultName = status?.vaultPath?.replace(/\\/g, '/').split('/').pop() ?? '';

  return (
    <div style={{ padding: "14px 14px 16px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(180,130,255,.7)" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.50)", letterSpacing: ".10em", fontWeight: 600 }}>BRAIN</span>
        {hasVault && !syncing && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(180,130,255,.8)", boxShadow: "0 0 5px rgba(180,130,255,.6)", marginLeft: "auto", flexShrink: 0 }} />}
        {syncing && <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(180,130,255,.4)", animation: "agentPulse 1.2s ease-in-out infinite", marginLeft: "auto" }} />}
      </div>

      {editing ? (
        <div>
          <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && save()} placeholder="Paste Obsidian vault path…"
            style={{ width: "100%", boxSizing: "border-box", padding: "6px 9px", borderRadius: 6, background: "rgba(255,255,255,.07)", border: "1px solid rgba(180,130,255,.30)", color: "rgba(255,255,255,.85)", fontSize: 10, outline: "none", marginBottom: 6 }} />
          <div style={{ display: "flex", gap: 5 }}>
            <button onClick={save} disabled={saving || !input.trim()} style={{ flex: 1, padding: "5px 0", borderRadius: 6, background: "rgba(180,130,255,.12)", border: "1px solid rgba(180,130,255,.30)", color: "rgba(180,130,255,.9)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>
              {saving ? 'Saving…' : 'Connect'}
            </button>
            <button onClick={() => setEditing(false)} style={{ padding: "5px 8px", borderRadius: 6, background: "none", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.52)", fontSize: 10, cursor: "pointer" }}>✕</button>
          </div>
        </div>
      ) : !hasVault ? (
        <button onClick={() => { setInput(''); setEditing(true); }} style={{ width: "100%", padding: "8px 0", borderRadius: 7, background: "rgba(180,130,255,.08)", border: "1px solid rgba(180,130,255,.22)", color: "rgba(180,130,255,.85)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          Connect Obsidian Vault
        </button>
      ) : (
        <>
          <div style={{ padding: "8px 10px", borderRadius: 7, background: "rgba(180,130,255,.06)", border: "1px solid rgba(180,130,255,.14)", marginBottom: 8 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,.75)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>📁 {vaultName}</div>
            <div style={{ fontSize: 9, color: "rgba(255,255,255,.52)" }}>
              {syncing ? (status?.status?.message || 'Syncing…') : `${status?.stats?.files ?? 0} files · ${status?.stats?.chunks ?? 0} chunks`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 5, marginBottom: 10 }}>
            <button onClick={syncNow} disabled={syncing} style={{ flex: 1, padding: "5px 0", borderRadius: 6, background: "rgba(180,130,255,.08)", border: "1px solid rgba(180,130,255,.20)", color: "rgba(180,130,255,.75)", fontSize: 10, fontWeight: 600, cursor: "pointer", opacity: syncing ? 0.5 : 1 }}>
              {syncing ? 'Syncing…' : 'Sync Now'}
            </button>
            <button onClick={() => { setInput(status?.vaultPath ?? ''); setEditing(true); }} style={{ padding: "5px 8px", borderRadius: 6, background: "none", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.52)", fontSize: 10, cursor: "pointer" }}>✎</button>
            <button onClick={forget} style={{ padding: "5px 8px", borderRadius: 6, background: "none", border: "1px solid rgba(255,255,255,.08)", color: "rgba(255,255,255,.46)", fontSize: 10, cursor: "pointer" }} title="Disconnect vault">✕</button>
          </div>

          {/* Mini brain graph orb */}
          <div style={{ height: 170, borderRadius: 8, overflow: "hidden", background: "#020408", border: "1px solid rgba(180,130,255,.10)", position: "relative" }}>
            <InlineBrainGraph />
          </div>
          <div style={{ textAlign: "center", marginTop: 8 }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,.88)", lineHeight: 1 }}>{status?.stats?.chunks ?? 0}</div>
            <div style={{ fontSize: 9, color: "rgba(180,130,255,.55)", letterSpacing: ".08em", marginTop: 3 }}>notes connected</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── Google Calendar ───────────────────────────────────────────────────────────
function CalendarWidget() {
  const { connected, accounts, events, loading, connect, disconnect } = useCalendar();

  function formatTime(iso) {
    if (!iso) return '';
    try { return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    catch { return ''; }
  }

  const today = new Date().toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

  // Assign a distinct tint to each account for the event dot
  const ACCOUNT_COLORS = ['rgba(100,180,255,.7)', 'rgba(180,130,255,.7)', 'rgba(100,220,180,.7)', 'rgba(255,160,100,.7)'];

  return (
    <div style={{ padding: "12px 14px 14px", borderTop: "1px solid rgba(255,255,255,.05)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="rgba(100,180,255,.7)" strokeWidth="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span style={{ fontSize: 9, color: "rgba(255,255,255,.28)", letterSpacing: ".10em", fontWeight: 600 }}>CALENDAR</span>
        {connected && (
          <button onClick={connect} title="Add another account" style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", padding: "1px 5px", color: "rgba(100,180,255,.5)", fontSize: 13, lineHeight: 1 }}>+</button>
        )}
      </div>

      {loading ? (
        <div style={{ height: 28, display: "flex", alignItems: "center" }}>
          <div style={{ width: 4, height: 4, borderRadius: "50%", background: "rgba(100,180,255,.4)", animation: "agentPulse 1.2s ease-in-out infinite" }} />
        </div>
      ) : !connected ? (
        <button onClick={connect} style={{ width: "100%", padding: "8px 0", borderRadius: 7, background: "rgba(100,180,255,.08)", border: "1px solid rgba(100,180,255,.22)", color: "rgba(100,180,255,.85)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>
          Connect Google Calendar
        </button>
      ) : (
        <>
          {/* Connected accounts */}
          <div style={{ display: "flex", flexDirection: "column", gap: 3, marginBottom: 8 }}>
            {accounts.map((email, i) => (
              <div key={email} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 5, height: 5, borderRadius: "50%", background: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length], flexShrink: 0 }} />
                <span style={{ fontSize: 8, color: "rgba(255,255,255,.30)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
                <button onClick={() => disconnect(email)} title="Disconnect" style={{ background: "none", border: "none", cursor: "pointer", padding: 1, color: "rgba(255,255,255,.15)", fontSize: 9, flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>

          <div style={{ fontSize: 9, color: "rgba(100,180,255,.55)", marginBottom: 8, letterSpacing: ".02em" }}>{today}</div>

          {events.length === 0 ? (
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.20)", fontStyle: "italic" }}>No events today</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              {events.map(ev => {
                const acctIdx = accounts.indexOf(ev.account);
                const dot = ACCOUNT_COLORS[acctIdx % ACCOUNT_COLORS.length] ?? ACCOUNT_COLORS[0];
                return (
                  <div key={ev.id} style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
                    <div style={{ width: 4, height: 4, borderRadius: "50%", background: dot, flexShrink: 0, marginTop: 4 }} />
                    <span style={{ fontSize: 9, color: "rgba(100,180,255,.60)", fontFamily: "monospace", flexShrink: 0, marginTop: 1, minWidth: 32 }}>
                      {ev.allDay ? 'ALL' : formatTime(ev.start)}
                    </span>
                    <span style={{ fontSize: 10, color: "rgba(255,255,255,.65)", lineHeight: 1.3, flex: 1 }}>{ev.title}</span>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main sidebar ─────────────────────────────────────────────────────────────
export function LeftSidebar({ open, onToggle }) {
  const [activeTab, setActiveTab] = useState('nav');
  const { activeNav, setActiveNav, setMemoryPanelOpen, setNewsOpen, setIntegrationsOpen, setBrainGraphOpen } = useAppStore();

  const sidebarWidth = open ? (activeTab === 'brain' ? 360 : 220) : 48;

  function handleNav(item) {
    setActiveNav(item.label);
    if (item.label === 'Memory')       setMemoryPanelOpen(true);
    if (item.label === 'Brain')        { setActiveTab('brain'); return; }
    if (item.label === 'News')         setNewsOpen(true);
    if (item.label === 'Integrations') setIntegrationsOpen(true);
  }

  return (
    <div style={{ width: sidebarWidth, flexShrink: 0, transition: "width 280ms cubic-bezier(0.16,1,0.3,1)", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", borderRight: "1px solid rgba(255,255,255,.10)", background: "rgba(6,9,18,.82)", backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)" }}>

      <button onClick={onToggle} style={{ position: "absolute", top: 14, right: open ? 10 : 8, width: 20, height: 20, borderRadius: 5, border: "1px solid rgba(255,255,255,.07)", background: "rgba(255,255,255,.04)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 2, transition: "right 280ms cubic-bezier(0.16,1,0.3,1)" }}>
        <svg width="8" height="8" viewBox="0 0 10 10" fill="none" stroke="rgba(255,255,255,.35)" strokeWidth="1.5">
          {open ? <path d="M7 2L3 5l4 3" /> : <path d="M3 2l4 3-4 3" />}
        </svg>
      </button>

      {open && (
        <>
          <div style={{ display: "flex", gap: 3, padding: "12px 10px 0", paddingRight: 36, flexShrink: 0 }}>
            <button onClick={() => setActiveTab('nav')}
              style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", transition: "all .2s",
                background: activeTab === 'nav' ? "rgba(124,58,237,.10)" : "rgba(255,255,255,.03)",
                color:      activeTab === 'nav' ? CYAN              : "rgba(255,255,255,.28)" }}>
              NAV
            </button>
            <button onClick={() => setActiveTab('brain')}
              style={{ flex: 1, padding: "5px 0", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 9, fontWeight: 700, letterSpacing: ".08em", transition: "all .2s",
                background: activeTab === 'brain' ? "rgba(180,130,255,.12)" : "rgba(255,255,255,.03)",
                color:      activeTab === 'brain' ? "rgba(180,130,255,.9)" : "rgba(255,255,255,.28)" }}>
              BRAIN
            </button>
          </div>

          <div style={{ height: 1, background: "rgba(255,255,255,.05)", margin: "10px 10px 0", flexShrink: 0 }} />

          {activeTab === 'nav' && (
            <>
              <div style={{ padding: "10px 10px 6px", flexShrink: 0 }}>
                {NAV_ITEMS.map(item => {
                  const isActive = activeNav === item.label;
                  return (
                    <button key={item.label} onClick={() => handleNav(item)}
                      style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "7px 8px", paddingLeft: isActive ? 10 : 8, borderRadius: 7, background: isActive ? "rgba(124,58,237,.10)" : "transparent", border: isActive ? "1px solid rgba(124,58,237,.20)" : "1px solid transparent", borderLeft: isActive ? `2px solid ${CYAN}` : "2px solid transparent", color: isActive ? CYAN : "rgba(255,255,255,.42)", fontSize: 11, fontWeight: isActive ? 600 : 400, cursor: "pointer", textAlign: "left", marginBottom: 2, transition: "all .2s", boxShadow: isActive ? "0 0 12px rgba(124,58,237,.08) inset" : "none" }}>
                      <span style={{ flexShrink: 0 }}>{item.icon}</span>
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ flex: 1, overflowY: "auto", position: "relative" }}>
                <div style={{ padding: "6px 14px 2px" }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.28)", letterSpacing: ".12em" }}>PRODUCTIVITY</span>
                </div>
                <AgendaWidget />
                <CalendarWidget />

                <div style={{ padding: "6px 14px 2px", marginTop: 4 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.28)", letterSpacing: ".12em" }}>INTELLIGENCE</span>
                </div>
                <NewsWidget />
                <MemoryWidget />

                <div style={{ padding: "6px 14px 2px", marginTop: 4 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.28)", letterSpacing: ".12em" }}>ENVIRONMENT</span>
                </div>
                <WeatherWidget />
                <ClocksWidget />
                <MetricsWidget />

                <div style={{ padding: "6px 14px 2px", marginTop: 4 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.28)", letterSpacing: ".12em" }}>INTEGRATIONS</span>
                </div>
                <SpotifyWidget />
                <BrainWidget />

                <div style={{ padding: "6px 14px 2px", marginTop: 4 }}>
                  <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.38)", letterSpacing: ".12em" }}>SYSTEM</span>
                </div>
                <div style={{ margin: "4px 10px 8px", padding: "10px 12px", borderRadius: 8, background: "rgba(124,58,237,.04)", border: "1px solid rgba(124,58,237,.10)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <div style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(124,58,237,.70)", boxShadow: "0 0 5px rgba(124,58,237,.5)" }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(124,58,237,.80)", letterSpacing: ".10em" }}>HLNA</span>
                    <span style={{ fontSize: 8, color: "rgba(255,255,255,.28)", letterSpacing: ".06em" }}>Hyper Learning Neural Agent</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 9, color: "rgba(255,255,255,.38)", lineHeight: 1.55 }}>
                    An adaptive AI layer designed to analyse operational data, generate insights, and assist with decision-making across dashboards.
                  </p>
                </div>

                {/* Scroll fade — hints there's more below */}
                <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, height: 28, background: "linear-gradient(to top, rgba(8,11,20,.70), transparent)", pointerEvents: "none" }} />
              </div>
            </>
          )}

          {activeTab === 'brain' && (
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", background: "#020408" }}>
              <div style={{ flexShrink: 0, padding: "8px 10px", borderBottom: "1px solid rgba(255,255,255,.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 9, fontWeight: 700, color: "rgba(180,130,255,.70)", letterSpacing: ".10em" }}>BRAIN GRAPH</span>
                <button
                  onClick={() => setBrainGraphOpen(true)}
                  style={{ display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5, background: "rgba(180,130,255,.08)", border: "1px solid rgba(180,130,255,.20)", color: "rgba(180,130,255,.75)", fontSize: 9, fontWeight: 600, cursor: "pointer", letterSpacing: ".04em" }}
                >
                  Fullscreen ↗
                </button>
              </div>
              <div style={{ flex: 1, minHeight: 0 }}>
                <InlineBrainGraph />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
