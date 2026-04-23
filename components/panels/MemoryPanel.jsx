'use client';
import { useState, useEffect, useCallback } from 'react';
import { memoryManager } from '../../lib/memory/memoryManager';
import { useAppStore } from '../../lib/state/useAppStore';
import { GLASS_LIGHT, CYAN } from '../../lib/utils/constants';

function relativeTime(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function EmptyState({ label }) {
  return (
    <div style={{ textAlign: 'center', padding: '32px 0', color: 'rgba(255,255,255,.18)', fontSize: 12 }}>
      {label}
    </div>
  );
}

function MemoryItem({ item, onDelete }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderRadius: 8, background: hover ? 'rgba(255,255,255,.04)' : 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', marginBottom: 5, transition: 'background .15s' }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.80)', lineHeight: 1.45 }}>{item.fact}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', marginTop: 3 }}>{relativeTime(item.ts)}</div>
      </div>
      <button
        onClick={() => onDelete(item.ts)}
        style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.30)', fontSize: 11, cursor: 'pointer', opacity: hover ? 1 : 0, transition: 'opacity .15s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >×</button>
    </div>
  );
}

function SectionHeader({ title, count, onClear }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, marginTop: 18 }}>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.28)', letterSpacing: '.12em' }}>{title}</span>
      <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 3, background: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.30)' }}>{count}</span>
      <div style={{ flex: 1 }} />
      {count > 0 && (
        <button onClick={onClear} style={{ fontSize: 9, padding: '2px 8px', borderRadius: 4, border: '1px solid rgba(255,255,255,.08)', background: 'transparent', color: 'rgba(255,255,255,.25)', cursor: 'pointer' }}>
          Clear
        </button>
      )}
    </div>
  );
}

function MemoryTab({ longTerm, shortTerm, onDeleteLong, onDeleteShort, onClearLong, onClearShort }) {
  return (
    <div>
      <SectionHeader title="LONG-TERM" count={longTerm.length} onClear={onClearLong} />
      {longTerm.length === 0
        ? <EmptyState label="Nothing stored yet. Say 'remember…' to add." />
        : [...longTerm].reverse().map(item => <MemoryItem key={item.ts} item={item} onDelete={onDeleteLong} />)
      }

      <SectionHeader title="SHORT-TERM" count={shortTerm.length} onClear={onClearShort} />
      {shortTerm.length === 0
        ? <EmptyState label="No short-term memory." />
        : [...shortTerm].reverse().map(item => <MemoryItem key={item.ts} item={item} onDelete={onDeleteShort} />)
      }
    </div>
  );
}

function PrefsTab({ prefs, onDelete, onClear }) {
  const entries = Object.entries(prefs);
  return (
    <div>
      <SectionHeader title="PREFERENCES" count={entries.length} onClear={onClear} />
      {entries.length === 0
        ? <EmptyState label="No preferences saved. Helena learns them from conversation." />
        : entries.map(([key, value]) => (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.05)', marginBottom: 5 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: CYAN, letterSpacing: '.06em', fontWeight: 600, marginBottom: 2 }}>{key}</div>
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.72)' }}>{String(value)}</div>
              </div>
              <button onClick={() => onDelete(key)} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 5, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.30)', fontSize: 11, cursor: 'pointer' }}>×</button>
            </div>
          ))
      }
    </div>
  );
}

function HistoryTab({ history }) {
  if (history.length === 0) return <EmptyState label="No conversation history yet." />;
  return (
    <div>
      <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.28)', letterSpacing: '.12em', marginBottom: 12 }}>RECENT EXCHANGES</div>
      {[...history].reverse().map((entry, i) => (
        <div key={i} style={{ marginBottom: 12, ...GLASS_LIGHT, borderRadius: 10, overflow: 'hidden' }}>
          <div style={{ padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,.05)' }}>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,.28)', letterSpacing: '.08em', marginBottom: 3 }}>YOU · {relativeTime(entry.ts)}</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', lineHeight: 1.4 }}>{entry.user}</div>
          </div>
          <div style={{ padding: '9px 12px' }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: CYAN, letterSpacing: '.08em', marginBottom: 3 }}>HELENA</div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', lineHeight: 1.4 }}>{entry.assistant}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

const TABS = ['Memory', 'Preferences', 'History'];

export function MemoryPanel() {
  const { memoryPanelOpen, setMemoryPanelOpen } = useAppStore();
  const [tab, setTab]         = useState('Memory');
  const [longTerm, setLT]     = useState([]);
  const [shortTerm, setST]    = useState([]);
  const [prefs, setPrefs]     = useState({});
  const [history, setHistory] = useState([]);

  const refresh = useCallback(() => {
    setLT(memoryManager.getLongTerm());
    setST(memoryManager.getShortTerm());
    setPrefs(memoryManager.getPreferences());
    setHistory(memoryManager.getRecentHistory(20));
  }, []);

  useEffect(() => { if (memoryPanelOpen) { setTab('Memory'); refresh(); } }, [memoryPanelOpen, refresh]);

  // Esc to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setMemoryPanelOpen(false); }
    if (memoryPanelOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [memoryPanelOpen, setMemoryPanelOpen]);

  if (!memoryPanelOpen) return null;

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, display: 'flex', flexDirection: 'column', background: 'rgba(7,9,16,0.94)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', animation: 'chatSlideUp .25s cubic-bezier(0.16,1,0.3,1)' }}>

      {/* Header */}
      <div style={{ height: 52, display: 'flex', alignItems: 'center', padding: '0 20px', gap: 12, borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 5, background: 'rgba(0,207,234,.12)', border: '1px solid rgba(0,207,234,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <span style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.88)', letterSpacing: '-.02em' }}>Helena Memory</span>
        <div style={{ flex: 1 }} />
        <button
          onClick={() => { memoryManager.clearAll(); refresh(); }}
          style={{ fontSize: 10, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(239,68,68,.30)', background: 'rgba(239,68,68,.08)', color: 'rgba(239,68,68,.70)', cursor: 'pointer', letterSpacing: '.04em' }}
        >
          CLEAR ALL
        </button>
        <button
          onClick={() => setMemoryPanelOpen(false)}
          style={{ width: 30, height: 30, borderRadius: 7, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', color: 'rgba(255,255,255,.45)', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', padding: '0 20px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0, gap: 0 }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '10px 14px', fontSize: 11, fontWeight: tab === t ? 600 : 400, color: tab === t ? CYAN : 'rgba(255,255,255,.35)', background: 'none', border: 'none', borderBottom: tab === t ? `2px solid ${CYAN}` : '2px solid transparent', cursor: 'pointer', letterSpacing: '.04em', transition: 'all .2s', marginBottom: -1 }}>
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 32px', maxWidth: 720, width: '100%', margin: '0 auto', alignSelf: 'stretch' }}>
        {tab === 'Memory' && (
          <MemoryTab
            longTerm={longTerm}
            shortTerm={shortTerm}
            onDeleteLong={ts  => { memoryManager.forgetLongTerm(ts);  refresh(); }}
            onDeleteShort={ts => { memoryManager.forgetShortTerm(ts); refresh(); }}
            onClearLong={()   => { memoryManager.clearLongTerm();     refresh(); }}
            onClearShort={()  => { memoryManager.clearShortTerm();    refresh(); }}
          />
        )}
        {tab === 'Preferences' && (
          <PrefsTab
            prefs={prefs}
            onDelete={key => { memoryManager.removePreference(key); refresh(); }}
            onClear={()   => { memoryManager.clearPreferences();    refresh(); }}
          />
        )}
        {tab === 'History' && <HistoryTab history={history} />}
      </div>
    </div>
  );
}
