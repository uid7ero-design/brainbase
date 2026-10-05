'use client';
import { useState, useEffect, useCallback, useId, useRef } from 'react';
import { memoryManager } from '../../lib/memory/memoryManager';
import { useAppStore } from '../../lib/state/useAppStore';
import { buttonProps } from '../ui/app/Button';
import { useOverlayFocus } from './useOverlayFocus';
import overlay from './PanelOverlay.module.css';
import styles from './MemoryPanel.module.css';

// Visual (remaining visual islands pass): the near-black glass sheet,
// white-alpha neutrals, GLASS_LIGHT cards and the old violet "CYAN" accent
// are replaced by app tokens (PanelOverlay.module.css + this module) so the
// sheet reads in light and dark. The sheet carries dialog semantics, the
// tabs are a real tablist, the hover-only forget buttons also appear on
// keyboard focus and every icon-only control is named. memoryManager calls
// and the Escape handler are unchanged.

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
    <p className={styles.empty}>
      {label}
    </p>
  );
}

function MemoryItem({ item, onDelete }) {
  return (
    <li className={styles.item}>
      <div className={styles.itemText}>
        <div className={styles.fact}>{item.fact}</div>
        <div className={styles.meta}>{relativeTime(item.ts)}</div>
      </div>
      <button
        type="button"
        onClick={() => onDelete(item.ts)}
        aria-label="Forget this memory"
        className={`${overlay.iconButton} ${styles.reveal}`}
      ><span aria-hidden="true">×</span></button>
    </li>
  );
}

function SectionHeader({ title, count, onClear }) {
  return (
    <div className={styles.sectionHeader}>
      <h3 className={overlay.sectionLabel}>{title}</h3>
      <span className={styles.count}>{count}</span>
      <div className={styles.spacer} />
      {count > 0 && (
        <button type="button" onClick={onClear} aria-label={`Clear ${title.toLowerCase()}`} {...buttonProps('ghost', 'sm')}>
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
        : <ul className={styles.list}>{[...longTerm].reverse().map(item => <MemoryItem key={item.ts} item={item} onDelete={onDeleteLong} />)}</ul>
      }

      <SectionHeader title="SHORT-TERM" count={shortTerm.length} onClear={onClearShort} />
      {shortTerm.length === 0
        ? <EmptyState label="No short-term memory." />
        : <ul className={styles.list}>{[...shortTerm].reverse().map(item => <MemoryItem key={item.ts} item={item} onDelete={onDeleteShort} />)}</ul>
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
        : <ul className={styles.list}>{entries.map(([key, value]) => (
            <li key={key} className={styles.item}>
              <div className={styles.itemText}>
                <div className={styles.prefKey}>{key}</div>
                <div className={styles.prefValue}>{String(value)}</div>
              </div>
              <button type="button" onClick={() => onDelete(key)} aria-label={`Remove preference ${key}`} className={overlay.iconButton}><span aria-hidden="true">×</span></button>
            </li>
          ))}</ul>
      }
    </div>
  );
}

function HistoryTab({ history }) {
  if (history.length === 0) return <EmptyState label="No conversation history yet." />;
  return (
    <div>
      <h3 className={`${overlay.sectionLabel} ${styles.historyHeading}`}>RECENT EXCHANGES</h3>
      {[...history].reverse().map((entry, i) => (
        <div key={i} className={styles.exchange}>
          <div className={styles.turn}>
            <div className={styles.speaker}>YOU · {relativeTime(entry.ts)}</div>
            <div className={styles.said}>{entry.user}</div>
          </div>
          <div className={styles.turn}>
            <div className={styles.speaker} data-speaker="helena">HELENA</div>
            <div className={styles.said}>{entry.assistant}</div>
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
  const panelRef = useRef(null);
  const uid = useId();

  useOverlayFocus(memoryPanelOpen, panelRef);

  const refresh = useCallback(() => {
    setLT(memoryManager.getLongTerm());
    setST(memoryManager.getShortTerm());
    setPrefs(memoryManager.getPreferences());
    setHistory(memoryManager.getRecentHistory(20));
  }, []);

  useEffect(() => { if (memoryPanelOpen) { setTab('Memory'); refresh(); } }, [memoryPanelOpen, refresh]);

  // WAI-ARIA tabs keyboard model: arrows / Home / End move between tabs (roving tabindex).
  function onTabKeyDown(e) {
    const i = TABS.indexOf(tab);
    const next = e.key === 'ArrowRight' ? TABS[(i + 1) % TABS.length]
      : e.key === 'ArrowLeft' ? TABS[(i - 1 + TABS.length) % TABS.length]
      : e.key === 'Home' ? TABS[0]
      : e.key === 'End' ? TABS[TABS.length - 1]
      : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`${uid}-tab-${next}`)?.focus();
  }

  // Esc to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') setMemoryPanelOpen(false); }
    if (memoryPanelOpen) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [memoryPanelOpen, setMemoryPanelOpen]);

  if (!memoryPanelOpen) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${uid}-title`}
      tabIndex={-1}
      className={`${overlay.sheet} ${styles.sheet}`}
      style={{ zIndex: 80 }}
    >

      {/* Header */}
      <div className={`${overlay.header} ${styles.header}`}>
        <div className={overlay.headerIcon} aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg>
        </div>
        <h2 id={`${uid}-title`} className={overlay.title}>Helena Memory</h2>
        <div className={overlay.headerActions}>
          <button
            type="button"
            onClick={() => { memoryManager.clearAll(); refresh(); }}
            {...buttonProps('danger', 'sm')}
          >
            CLEAR ALL
          </button>
          <button
            type="button"
            onClick={() => setMemoryPanelOpen(false)}
            aria-label="Close Helena memory"
            className={overlay.iconButton}
          ><span aria-hidden="true">×</span></button>
        </div>
      </div>

      {/* Tabs */}
      <div className={styles.tabs} role="tablist" aria-label="Memory views" onKeyDown={onTabKeyDown}>
        {TABS.map(t => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`${uid}-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`${uid}-panel`}
            tabIndex={tab === t ? 0 : -1}
            data-initial-focus={tab === t ? '' : undefined}
            onClick={() => setTab(t)}
            className={styles.tab}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div
        className={styles.content}
        role="tabpanel"
        id={`${uid}-panel`}
        aria-labelledby={`${uid}-tab-${tab}`}
        data-dialog-body=""
      >
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
