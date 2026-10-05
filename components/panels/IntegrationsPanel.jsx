'use client';
import { useState, useEffect, useId, useRef } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { buttonProps } from '../ui/app/Button';
import { useOverlayFocus } from './useOverlayFocus';
import overlay from './PanelOverlay.module.css';
import styles from './IntegrationsPanel.module.css';

// Visual (remaining visual islands pass): the glass modal, white-alpha
// neutrals and the old violet "CYAN" chrome are replaced by the shared app
// tokens (PanelOverlay.module.css + this module) so the overlay reads in
// light and dark. The dialog now carries dialog semantics, a labelled close
// control and focus containment/return; Escape keeps its existing handler.
// Fetch URLs, methods and connect/disconnect effects are unchanged.

// ── Gmail card ───────────────────────────────────────────────────────────────
function GmailCard() {
  const [status,   setStatus]   = useState(null); // null=loading, {connected,email}
  const [messages, setMessages] = useState([]);
  const [loading,  setLoading]  = useState(false);
  const [expanded, setExpanded] = useState(false);

  async function loadStatus() {
    try {
      const r = await fetch('/api/integrations/gmail/status');
      setStatus(await r.json());
    } catch { setStatus({ connected: false }); }
  }

  async function loadMessages() {
    setLoading(true);
    try {
      const r = await fetch('/api/integrations/gmail/messages');
      const d = await r.json();
      setMessages(d.messages ?? []);
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { loadStatus(); }, []);
  useEffect(() => { if (status?.connected) loadMessages(); }, [status?.connected]);

  async function connect() {
    const r = await fetch('/api/integrations/gmail/login');
    const { url, error } = await r.json();
    if (error) { alert(error); return; }
    window.location.href = url;
  }

  async function disconnect() {
    await fetch('/api/integrations/gmail/status', { method: 'DELETE' });
    setStatus({ connected: false });
    setMessages([]);
  }

  const visible = expanded ? messages : messages.slice(0, 5);

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.cardHeader} data-divided={status?.connected ? 'true' : 'false'}>
        <div className={styles.cardIcon} aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
            <polyline points="22,6 12,13 2,6"/>
          </svg>
        </div>
        <div className={styles.cardText}>
          <h4 className={styles.cardName}>Gmail</h4>
          <div className={styles.cardStatus}>
            <span className={styles.statusDot} data-state={status?.connected ? 'success' : 'inactive'} aria-hidden="true" />
            <span className={overlay.truncate}>
              {status === null ? 'Checking…' : status.connected ? (status.email ?? 'Connected') : 'Not connected'}
            </span>
          </div>
        </div>
        {status?.connected ? (
          <div className={styles.cardActions}>
            <button type="button" onClick={disconnect} {...buttonProps('secondary', 'sm')}>
              Disconnect
            </button>
          </div>
        ) : (
          <button type="button" onClick={connect} {...buttonProps('primary', 'sm')}>
            Connect
          </button>
        )}
      </div>

      {/* Inbox preview */}
      {status?.connected && (
        <div className={styles.inbox}>
          <div className={styles.inboxHeader}>
            <h5 className={overlay.sectionLabel}>INBOX</h5>
            <button type="button" onClick={loadMessages} title="Refresh" aria-label="Refresh" className={overlay.iconButton}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            </button>
            <span className={styles.count}>{messages.length} messages</span>
          </div>

          {loading ? (
            <div className={overlay.loading} role="status">
              <span className={overlay.pulseDot} aria-hidden="true" />
              <span>Loading inbox…</span>
            </div>
          ) : messages.length === 0 ? (
            <p className={styles.emptyNote}>No messages found.</p>
          ) : (
            <>
              <ul className={styles.messages}>
                {visible.map(msg => (
                  <li key={msg.id} className={styles.message} data-unread={msg.unread ? 'true' : 'false'}>
                    <div className={styles.messageTop}>
                      {msg.unread && <span className={styles.unreadDot} aria-hidden="true" />}
                      <span className={`${styles.subject} ${overlay.truncate}`}>
                        {msg.unread && <span className="sr-only">Unread: </span>}
                        {msg.subject}
                      </span>
                      <span className={styles.time}>{msg.time}</span>
                    </div>
                    <div className={`${styles.from} ${overlay.truncate}`}>
                      {msg.from}
                    </div>
                  </li>
                ))}
              </ul>
              {messages.length > 5 && (
                <button type="button" onClick={() => setExpanded(e => !e)} aria-expanded={expanded} {...buttonProps('ghost', 'sm')} className={`${buttonProps('ghost', 'sm').className} ${styles.more}`}>
                  {expanded ? 'show less ↑' : `+${messages.length - 5} more ↓`}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Spotify status card (read-only, links to sidebar) ───────────────────────
function SpotifyStatusCard() {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    fetch('/api/spotify/now-playing')
      .then(r => r.ok ? r.json() : null)
      .then(d => setConnected(!!d?.is_playing || d !== null))
      .catch(() => setConnected(false));
  }, []);

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <div className={styles.cardIcon} aria-hidden="true">
          {/* Spotify brand mark — the one brand fill in this panel. */}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
        </div>
        <div className={styles.cardText}>
          <h4 className={styles.cardName}>Spotify</h4>
          <div className={styles.cardStatus}>
            <span className={styles.statusDot} data-state={connected ? 'success' : 'inactive'} aria-hidden="true" />
            <span>{connected ? 'Connected — use sidebar to control' : 'Not connected — use sidebar to connect'}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Coming soon card ─────────────────────────────────────────────────────────
function ComingSoonCard({ icon, label }) {
  return (
    <div className={styles.soonCard}>
      <div className={styles.cardIcon} aria-hidden="true">
        {icon}
      </div>
      <div className={styles.cardText}>
        <h4 className={styles.cardName}>{label}</h4>
        <div className={styles.soonNote}>Coming soon</div>
      </div>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
export function IntegrationsPanel() {
  const { integrationsOpen, setIntegrationsOpen } = useAppStore();
  const titleId = useId();
  const panelRef = useRef(null);
  useOverlayFocus(integrationsOpen, panelRef);

  useEffect(() => {
    if (!integrationsOpen) return;
    function onKey(e) { if (e.key === 'Escape') setIntegrationsOpen(false); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [integrationsOpen, setIntegrationsOpen]);

  if (!integrationsOpen) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) setIntegrationsOpen(false); }}
      className={overlay.root}
      style={{ zIndex: 60 }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`${overlay.dialog} ${styles.dialog}`}
      >

        {/* Header */}
        <div className={overlay.header}>
          <div className={overlay.headerIcon} aria-hidden="true">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div>
            <h2 id={titleId} className={overlay.title}>Integrations</h2>
            <p className={overlay.subtitle}>Connect your tools to Helena</p>
          </div>
          <div className={overlay.headerActions}>
            <button type="button" onClick={() => setIntegrationsOpen(false)} aria-label="Close integrations" className={overlay.iconButton}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className={overlay.body} data-dialog-body="">
          <div className={styles.content}>
            <h3 className={overlay.sectionLabel}>COMMUNICATION</h3>
            <GmailCard />

            <h3 className={`${overlay.sectionLabel} ${styles.group}`}>MEDIA &amp; PRODUCTIVITY</h3>
            <SpotifyStatusCard />

            <h3 className={`${overlay.sectionLabel} ${styles.group}`}>COMING SOON</h3>
            <div className={styles.soonGrid}>
              <ComingSoonCard icon="📅" label="Google Calendar" />
              <ComingSoonCard icon="💬" label="Slack" />
              <ComingSoonCard icon="🔷" label="Linear" />
              <ComingSoonCard icon="📝" label="Notion" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
