'use client';
import { useState, useEffect, useCallback } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { CYAN } from '../../lib/utils/constants';

const GLASS = {
  background: 'rgba(8,11,20,.82)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
};

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
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: status?.connected ? '1px solid rgba(255,255,255,.05)' : 'none' }}>
        <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(234,67,53,.12)', border: '1px solid rgba(234,67,53,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="rgba(234,67,53,.8)" strokeWidth="1.8"/>
            <polyline points="22,6 12,13 2,6" stroke="rgba(234,67,53,.8)" strokeWidth="1.8"/>
          </svg>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.85)', marginBottom: 2 }}>Gmail</div>
          <div style={{ fontSize: 10, color: status?.connected ? 'rgba(134,239,172,.7)' : 'rgba(255,255,255,.30)' }}>
            {status === null ? 'Checking…' : status.connected ? (status.email ?? 'Connected') : 'Not connected'}
          </div>
        </div>
        {status?.connected ? (
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'rgba(134,239,172,.8)', boxShadow: '0 0 6px rgba(134,239,172,.5)' }} />
            <button onClick={disconnect} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 5, background: 'none', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.52)', cursor: 'pointer', fontWeight: 600 }}>
              Disconnect
            </button>
          </div>
        ) : (
          <button onClick={connect} style={{ padding: '7px 14px', borderRadius: 7, background: 'rgba(234,67,53,.10)', border: '1px solid rgba(234,67,53,.28)', color: 'rgba(234,67,53,.9)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
            Connect
          </button>
        )}
      </div>

      {/* Inbox preview */}
      {status?.connected && (
        <div style={{ padding: '10px 14px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.46)', letterSpacing: '.10em' }}>INBOX</span>
            <button onClick={loadMessages} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'rgba(255,255,255,.42)', display: 'flex' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            </button>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,.62)' }}>{messages.length} messages</span>
          </div>

          {loading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0' }}>
              <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(234,67,53,.5)', animation: 'agentPulse 1.2s ease-in-out infinite' }} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,.46)' }}>Loading inbox…</span>
            </div>
          ) : messages.length === 0 ? (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.62)', fontStyle: 'italic' }}>No messages found.</div>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {visible.map(msg => (
                  <div key={msg.id} style={{ padding: '8px 10px', borderRadius: 7, background: msg.unread ? 'rgba(234,67,53,.05)' : 'rgba(255,255,255,.02)', border: `1px solid ${msg.unread ? 'rgba(234,67,53,.15)' : 'rgba(255,255,255,.04)'}`, cursor: 'default' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 2 }}>
                      {msg.unread && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(234,67,53,.8)', flexShrink: 0, marginTop: 2 }} />}
                      <span style={{ fontSize: 11, fontWeight: msg.unread ? 600 : 400, color: msg.unread ? 'rgba(255,255,255,.82)' : 'rgba(255,255,255,.55)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {msg.subject}
                      </span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,.42)', flexShrink: 0 }}>{msg.time}</span>
                    </div>
                    <div style={{ fontSize: 9, color: 'rgba(255,255,255,.70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: msg.unread ? 11 : 0 }}>
                      {msg.from}
                    </div>
                  </div>
                ))}
              </div>
              {messages.length > 5 && (
                <button onClick={() => setExpanded(e => !e)} style={{ marginTop: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: 'rgba(255,255,255,.46)', padding: 0 }}>
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
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.03)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: 'rgba(29,185,84,.10)', border: '1px solid rgba(29,185,84,.22)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/></svg>
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.85)', marginBottom: 2 }}>Spotify</div>
        <div style={{ fontSize: 10, color: connected ? 'rgba(134,239,172,.7)' : 'rgba(255,255,255,.30)' }}>
          {connected ? 'Connected — use sidebar to control' : 'Not connected — use sidebar to connect'}
        </div>
      </div>
      {connected && <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#1DB954', boxShadow: '0 0 6px rgba(29,185,84,.6)' }} />}
    </div>
  );
}

// ── Coming soon card ─────────────────────────────────────────────────────────
function ComingSoonCard({ icon, label, color }) {
  return (
    <div style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,.05)', background: 'rgba(255,255,255,.015)', padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10, opacity: 0.45 }}>
      <div style={{ width: 34, height: 34, borderRadius: 8, background: `${color}12`, border: `1px solid ${color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: 16 }}>
        {icon}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.78)', marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.62)' }}>Coming soon</div>
      </div>
    </div>
  );
}

// ── Panel ────────────────────────────────────────────────────────────────────
export function IntegrationsPanel() {
  const { integrationsOpen, setIntegrationsOpen } = useAppStore();

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
      style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.55)', backdropFilter: 'blur(4px)' }}
    >
      <div style={{ width: 520, maxHeight: '82vh', borderRadius: 16, border: '1px solid rgba(255,255,255,.10)', ...GLASS, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '18px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: `rgba(0,207,234,.12)`, border: `1px solid rgba(0,207,234,.25)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="1.8"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.90)', letterSpacing: '-.02em' }}>Integrations</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,.52)' }}>Connect your tools to Helena</div>
          </div>
          <button onClick={() => setIntegrationsOpen(false)} style={{ marginLeft: 'auto', width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.62)' }}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>

          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.46)', letterSpacing: '.12em', marginBottom: 2 }}>COMMUNICATION</div>
          <GmailCard />

          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.46)', letterSpacing: '.12em', marginTop: 6, marginBottom: 2 }}>MEDIA & PRODUCTIVITY</div>
          <SpotifyStatusCard />

          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.46)', letterSpacing: '.12em', marginTop: 6, marginBottom: 2 }}>COMING SOON</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ComingSoonCard icon="📅" label="Google Calendar" color="rgba(66,133,244)" />
            <ComingSoonCard icon="💬" label="Slack" color="rgba(74,21,75)" />
            <ComingSoonCard icon="🔷" label="Linear" color="rgba(94,106,210)" />
            <ComingSoonCard icon="📝" label="Notion" color="rgba(255,255,255)" />
          </div>
        </div>
      </div>
    </div>
  );
}
