'use client';
import { useState, useEffect, useRef } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { CYAN } from '../../lib/utils/constants';

const GLASS = { background: 'rgba(8,11,20,.90)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)' };
const CONTACTS_KEY = 'brainbase:contacts';

function loadContacts() {
  try { return JSON.parse(localStorage.getItem(CONTACTS_KEY)) ?? []; } catch { return []; }
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function senderName(from) {
  if (!from) return 'Unknown';
  const match = from.match(/^"?([^"<]+)"?\s*</);
  return match ? match[1].trim() : from.replace(/<.*>/, '').trim();
}

function senderEmail(from) {
  const match = from?.match(/<(.+)>/);
  return match ? match[1] : from;
}

// ── Contact autocomplete for To field ──────────────────────────────────────
function ToField({ value, onChange }) {
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const contacts = loadContacts();

  function handleInput(val) {
    onChange(val);
    if (!val.trim()) { setSuggestions([]); setOpen(false); return; }
    const q = val.toLowerCase();
    const matches = contacts.flatMap(c =>
      (c.emails ?? []).filter(Boolean).map(email => ({
        label: c.name ? `${c.name} <${email}>` : email,
        value: c.name ? `${c.name} <${email}>` : email,
      }))
    ).filter(s => s.label.toLowerCase().includes(q)).slice(0, 6);
    setSuggestions(matches);
    setOpen(matches.length > 0);
  }

  function pick(s) { onChange(s.value); setOpen(false); setSuggestions([]); }

  return (
    <div style={{ position: 'relative' }}>
      <input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder="To: name or email…"
        style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.80)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
      />
      {open && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, marginTop: 3, borderRadius: 8, background: 'rgba(12,16,30,.97)', border: '1px solid rgba(255,255,255,.10)', overflow: 'hidden' }}>
          {suggestions.map((s, i) => (
            <button key={i} onMouseDown={() => pick(s)} style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 11, color: 'rgba(255,255,255,.72)', borderBottom: '1px solid rgba(255,255,255,.04)' }}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Compose view ─────────────────────────────────────────────────────────────
function ComposeView({ onClose, onSent }) {
  const [to,      setTo]      = useState('');
  const [subject, setSubject] = useState('');
  const [body,    setBody]    = useState('');
  const [sending, setSending] = useState(false);
  const [error,   setError]   = useState('');

  async function send() {
    if (!to.trim() || !body.trim()) return;
    setSending(true);
    setError('');
    try {
      const r = await fetch('/api/integrations/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), subject: subject.trim() || '(no subject)', body }),
      });
      const d = await r.json();
      if (d.ok) { onSent(); }
      else setError(d.error ?? 'Send failed');
    } catch (e) { setError(e.message); } finally { setSending(false); }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.85)', letterSpacing: '-.02em' }}>New Message</div>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <ToField value={to} onChange={setTo} />
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject"
          style={{ width: '100%', boxSizing: 'border-box', padding: '7px 10px', borderRadius: 7, background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.80)', fontSize: 11, outline: 'none', fontFamily: 'inherit' }}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message…"
          style={{ flex: 1, minHeight: 240, width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.78)', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.6, fontFamily: 'inherit' }}
        />
        {error && <div style={{ fontSize: 10, color: 'rgba(234,67,53,.80)', padding: '6px 10px', borderRadius: 6, background: 'rgba(234,67,53,.08)', border: '1px solid rgba(234,67,53,.18)' }}>{error}</div>}
      </div>

      <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '12px 16px', display: 'flex', gap: 8, flexShrink: 0 }}>
        <button onClick={send} disabled={sending || !to.trim() || !body.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', borderRadius: 7, background: 'rgba(234,67,53,.12)', border: '1px solid rgba(234,67,53,.30)', color: 'rgba(234,67,53,.9)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: sending || !to.trim() || !body.trim() ? 0.5 : 1 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button onClick={onClose} style={{ padding: '8px 14px', borderRadius: 7, background: 'none', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.50)', fontSize: 11, cursor: 'pointer' }}>Discard</button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function InboxPanel() {
  const { inboxOpen, setInboxOpen, setContactsOpen } = useAppStore();

  const [gmailConnected, setGmailConnected] = useState(null);
  const [messages,  setMessages]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [selected,  setSelected]  = useState(null);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [view,      setView]      = useState('list'); // 'list' | 'compose' | 'sent'

  // Reply state
  const [replying,  setReplying]  = useState(false);
  const [replyBody, setReplyBody] = useState('');
  const [sending,   setSending]   = useState(false);
  const [sent,      setSent]      = useState(false);
  const replyRef = useRef(null);

  useEffect(() => {
    fetch('/api/integrations/gmail/status')
      .then(r => r.json())
      .then(d => setGmailConnected(d.connected))
      .catch(() => setGmailConnected(false));
  }, []);

  useEffect(() => {
    if (!inboxOpen || !gmailConnected) return;
    loadInbox();
  }, [inboxOpen, gmailConnected]);

  useEffect(() => {
    if (!inboxOpen) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        if (view === 'compose') { setView('list'); return; }
        setInboxOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inboxOpen, view, setInboxOpen]);

  useEffect(() => {
    if (replying) setTimeout(() => replyRef.current?.focus(), 60);
  }, [replying]);

  async function loadInbox() {
    setLoading(true);
    try {
      const r = await fetch('/api/integrations/gmail/messages');
      const d = await r.json();
      setMessages(d.messages ?? []);
    } catch {} finally { setLoading(false); }
  }

  async function selectMessage(msg) {
    setSelected(null);
    setReplying(false);
    setSent(false);
    setLoadingMsg(true);
    try {
      const r = await fetch(`/api/integrations/gmail/message?id=${msg.id}`);
      const d = await r.json();
      setSelected(d);
    } catch {} finally { setLoadingMsg(false); }
  }

  async function sendReply() {
    if (!replyBody.trim() || !selected) return;
    setSending(true);
    try {
      const r = await fetch('/api/integrations/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to:        senderEmail(selected.from),
          subject:   selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`,
          body:      replyBody,
          threadId:  selected.threadId,
          inReplyTo: selected.id,
        }),
      });
      const d = await r.json();
      if (d.ok) { setSent(true); setReplying(false); setReplyBody(''); }
      else alert(`Send failed: ${d.error}`);
    } catch (e) { alert(e.message); } finally { setSending(false); }
  }

  if (!inboxOpen) return null;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) setInboxOpen(false); }}
      style={{ position: 'fixed', inset: 0, zIndex: 65, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.60)', backdropFilter: 'blur(4px)' }}
    >
      <div style={{ width: 'min(900px, 96vw)', height: 'min(700px, 90vh)', borderRadius: 16, border: '1px solid rgba(255,255,255,.10)', ...GLASS, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: 7, background: 'rgba(234,67,53,.12)', border: '1px solid rgba(234,67,53,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="rgba(234,67,53,.8)" strokeWidth="1.8"/><polyline points="22,6 12,13 2,6" stroke="rgba(234,67,53,.8)" strokeWidth="1.8"/></svg>
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(255,255,255,.90)', letterSpacing: '-.02em' }}>Inbox</div>
            {gmailConnected && <div style={{ fontSize: 9, color: 'rgba(255,255,255,.52)' }}>{messages.length} messages</div>}
          </div>

          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
            {/* Compose */}
            <button onClick={() => setView(view === 'compose' ? 'list' : 'compose')}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: view === 'compose' ? 'rgba(234,67,53,.12)' : 'rgba(255,255,255,.04)', border: view === 'compose' ? '1px solid rgba(234,67,53,.30)' : '1px solid rgba(255,255,255,.08)', color: view === 'compose' ? 'rgba(234,67,53,.85)' : 'rgba(255,255,255,.55)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
              <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Compose
            </button>
            {/* Address book */}
            <button onClick={() => { setContactsOpen(true); }}
              title="Address Book"
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 7, background: 'rgba(0,207,234,.04)', border: '1px solid rgba(0,207,234,.14)', color: 'rgba(0,207,234,.65)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Contacts
            </button>
            {/* Refresh */}
            <button onClick={loadInbox} title="Refresh" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,.52)', display: 'flex' }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            </button>
            {/* Close */}
            <button onClick={() => setInboxOpen(false)} style={{ width: 26, height: 26, borderRadius: 6, border: '1px solid rgba(255,255,255,.08)', background: 'rgba(255,255,255,.04)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,.62)' }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        {gmailConnected === false ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.62)' }}>Gmail not connected</div>
            <button onClick={() => setInboxOpen(false)} style={{ fontSize: 11, color: CYAN, background: 'none', border: `1px solid rgba(0,207,234,.25)`, borderRadius: 7, padding: '6px 14px', cursor: 'pointer' }}>
              Go to Integrations to connect
            </button>
          </div>
        ) : view === 'compose' ? (
          <ComposeView
            onClose={() => setView('list')}
            onSent={() => { setView('sent'); setTimeout(() => setView('list'), 2000); }}
          />
        ) : view === 'sent' ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(134,239,172,.6)" strokeWidth="1.5"><polyline points="20 6 9 17 4 12"/></svg>
            <div style={{ fontSize: 13, color: 'rgba(134,239,172,.80)', fontWeight: 600 }}>Message sent</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

            {/* Message list */}
            <div style={{ width: 280, flexShrink: 0, borderRight: '1px solid rgba(255,255,255,.06)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {loading ? (
                <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(234,67,53,.5)', animation: 'agentPulse 1.2s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.52)' }}>Loading…</span>
                </div>
              ) : messages.map(msg => {
                const isActive = selected?.id === msg.id;
                return (
                  <button key={msg.id} onClick={() => selectMessage(msg)}
                    style={{ display: 'block', width: '100%', padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,.04)', background: isActive ? 'rgba(234,67,53,.07)' : 'transparent', border: 'none', borderLeft: isActive ? '2px solid rgba(234,67,53,.6)' : '2px solid transparent', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      {msg.unread && <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(234,67,53,.85)', flexShrink: 0 }} />}
                      <span style={{ fontSize: 11, fontWeight: msg.unread ? 600 : 400, color: msg.unread ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,.55)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {senderName(msg.from)}
                      </span>
                      <span style={{ fontSize: 9, color: 'rgba(255,255,255,.42)', flexShrink: 0 }}>{msg.time}</span>
                    </div>
                    <div style={{ fontSize: 10, color: isActive ? 'rgba(255,255,255,.65)' : 'rgba(255,255,255,.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: msg.unread ? 11 : 0 }}>
                      {msg.subject}
                    </div>
                    {msg.snippet && (
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,.42)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2, paddingLeft: msg.unread ? 11 : 0 }}>
                        {msg.snippet}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Email detail */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              {!selected && !loadingMsg ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 8 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="1.2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.62)' }}>Select a message to read</span>
                </div>
              ) : loadingMsg ? (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                  <div style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(234,67,53,.5)', animation: 'agentPulse 1.2s ease-in-out infinite' }} />
                  <span style={{ fontSize: 10, color: 'rgba(255,255,255,.52)' }}>Loading message…</span>
                </div>
              ) : (
                <>
                  <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', flexShrink: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,.88)', marginBottom: 8, lineHeight: 1.3 }}>{selected.subject}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'rgba(234,67,53,.15)', border: '1px solid rgba(234,67,53,.25)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: 'rgba(234,67,53,.8)', flexShrink: 0 }}>
                        {senderName(selected.from).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.70)' }}>{senderName(selected.from)}</div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,.52)' }}>{senderEmail(selected.from)}</div>
                      </div>
                      <div style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(255,255,255,.46)' }}>{relativeTime(selected.date)}</div>
                    </div>
                  </div>

                  <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                    {sent && (
                      <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 7, background: 'rgba(134,239,172,.08)', border: '1px solid rgba(134,239,172,.20)', fontSize: 11, color: 'rgba(134,239,172,.80)' }}>
                        Reply sent successfully.
                      </div>
                    )}
                    <pre style={{ fontSize: 11, color: 'rgba(255,255,255,.65)', lineHeight: 1.65, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', margin: 0 }}>
                      {selected.body || '(no content)'}
                    </pre>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '12px 16px', flexShrink: 0 }}>
                    {replying ? (
                      <div>
                        <div style={{ fontSize: 9, color: 'rgba(255,255,255,.52)', marginBottom: 6 }}>
                          Replying to {senderEmail(selected.from)}
                        </div>
                        <textarea ref={replyRef} value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Write your reply…" rows={4}
                          style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.80)', fontSize: 11, outline: 'none', resize: 'none', lineHeight: 1.5, fontFamily: 'inherit' }} />
                        <div style={{ display: 'flex', gap: 7, marginTop: 8 }}>
                          <button onClick={sendReply} disabled={sending || !replyBody.trim()}
                            style={{ padding: '7px 18px', borderRadius: 7, background: 'rgba(234,67,53,.12)', border: '1px solid rgba(234,67,53,.30)', color: 'rgba(234,67,53,.9)', fontSize: 11, fontWeight: 600, cursor: 'pointer', opacity: sending || !replyBody.trim() ? 0.5 : 1 }}>
                            {sending ? 'Sending…' : 'Send Reply'}
                          </button>
                          <button onClick={() => { setReplying(false); setReplyBody(''); }}
                            style={{ padding: '7px 12px', borderRadius: 7, background: 'none', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.52)', fontSize: 11, cursor: 'pointer' }}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 7 }}>
                        <button onClick={() => setReplying(true)}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, background: 'rgba(234,67,53,.08)', border: '1px solid rgba(234,67,53,.22)', color: 'rgba(234,67,53,.8)', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                          Reply
                        </button>
                        <button onClick={() => { setView('compose'); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', borderRadius: 7, background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.08)', color: 'rgba(255,255,255,.52)', fontSize: 11, cursor: 'pointer' }}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                          Forward / New
                        </button>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
