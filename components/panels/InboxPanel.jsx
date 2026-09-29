'use client';
import { useState, useEffect, useId, useRef } from 'react';
import { useAppStore } from '../../lib/state/useAppStore';
import { buttonProps } from '../ui/app/Button';
import { useOverlayFocus } from './useOverlayFocus';
import overlay from './PanelOverlay.module.css';
import styles from './InboxPanel.module.css';

// Visual (remaining visual islands pass): the glass modal, white-alpha
// neutrals, Gmail-red chrome and the old violet "CYAN" accent are replaced
// by app tokens (PanelOverlay.module.css + this module) so the overlay reads
// in light and dark. Dialog semantics, labelled fields, named icon controls,
// aria-current on the open message and focus containment/return were added;
// Escape keeps its existing staged handler. Every fetch URL, method, payload
// and state transition is unchanged.

const CONTACTS_KEY = 'brainbase:contacts';
const SECONDARY_SM = buttonProps('secondary', 'sm');
const COMPOSE_TOGGLE = { ...SECONDARY_SM, className: `${SECONDARY_SM.className} ${styles.toggle}` };

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
    <div className={styles.toField}>
      <input
        value={value}
        onChange={e => handleInput(e.target.value)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onFocus={() => { if (suggestions.length) setOpen(true); }}
        placeholder="To: name or email…"
        aria-label="To"
        className={overlay.input}
      />
      {open && (
        <div className={styles.suggestions}>
          {suggestions.map((s, i) => (
            <button type="button" key={i} onMouseDown={() => pick(s)} className={styles.suggestion}>
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
    <div className={styles.compose}>
      <div className={styles.composeHeader}>
        <h3 className={styles.composeTitle}>New Message</h3>
      </div>

      <div className={styles.composeBody}>
        <ToField value={to} onChange={setTo} />
        <input
          value={subject}
          onChange={e => setSubject(e.target.value)}
          placeholder="Subject"
          aria-label="Subject"
          className={overlay.input}
        />
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          placeholder="Write your message…"
          aria-label="Message"
          className={`${overlay.textarea} ${styles.composeText}`}
        />
        {error && <div className={overlay.notice} data-state="danger" role="alert">{error}</div>}
      </div>

      <div className={overlay.footer}>
        <button type="button" onClick={send} disabled={sending || !to.trim() || !body.trim()} {...buttonProps('primary', 'sm')}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button type="button" onClick={onClose} {...buttonProps('secondary', 'sm')}>Discard</button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export function InboxPanel() {
  const { inboxOpen, setInboxOpen, setContactsOpen } = useAppStore();
  const titleId = useId();
  const panelRef = useRef(null);

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

  useOverlayFocus(inboxOpen, panelRef);

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
      className={overlay.root}
      style={{ zIndex: 65 }}
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
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
          </div>
          <div>
            <h2 id={titleId} className={overlay.title}>Inbox</h2>
            {gmailConnected && <p className={overlay.subtitle}>{messages.length} messages</p>}
          </div>

          <div className={overlay.headerActions}>
            {/* Compose */}
            <button type="button" onClick={() => setView(view === 'compose' ? 'list' : 'compose')}
              aria-pressed={view === 'compose'}
              {...COMPOSE_TOGGLE}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Compose
            </button>
            {/* Address book */}
            <button type="button" onClick={() => { setContactsOpen(true); }}
              title="Address Book"
              {...buttonProps('secondary', 'sm')}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
              Contacts
            </button>
            {/* Refresh */}
            <button type="button" onClick={loadInbox} title="Refresh" aria-label="Refresh" className={overlay.iconButton}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            </button>
            {/* Close */}
            <button type="button" onClick={() => setInboxOpen(false)} aria-label="Close inbox" className={overlay.iconButton}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>

        {/* Body */}
        {gmailConnected === false ? (
          <div className={overlay.empty} data-dialog-body="">
            <p className={styles.notConnected}>Gmail not connected</p>
            <button type="button" onClick={() => setInboxOpen(false)} {...buttonProps('secondary', 'sm')}>
              Go to Integrations to connect
            </button>
          </div>
        ) : view === 'compose' ? (
          <ComposeView
            onClose={() => setView('list')}
            onSent={() => { setView('sent'); setTimeout(() => setView('list'), 2000); }}
          />
        ) : view === 'sent' ? (
          <div className={styles.sent} role="status">
            <svg className={styles.sentIcon} width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>
            <div>Message sent</div>
          </div>
        ) : (
          <div className={overlay.split}>

            {/* Message list */}
            <div className={overlay.listPane} data-width="280" data-dialog-body="">
              {loading ? (
                <div className={`${overlay.loading} ${styles.listLoading}`} role="status">
                  <span className={overlay.pulseDot} aria-hidden="true" />
                  <span>Loading…</span>
                </div>
              ) : messages.map(msg => {
                const isActive = selected?.id === msg.id;
                return (
                  <button type="button" key={msg.id} onClick={() => selectMessage(msg)}
                    aria-current={isActive ? 'true' : undefined}
                    className={overlay.listRow}
                  >
                    <div className={styles.rowTop}>
                      {msg.unread && <span className={styles.unreadDot} aria-hidden="true" />}
                      <span className={`${styles.sender} ${overlay.truncate}`} data-unread={msg.unread ? 'true' : 'false'}>
                        {msg.unread && <span className="sr-only">Unread: </span>}
                        {senderName(msg.from)}
                      </span>
                      <span className={styles.rowTime}>{msg.time}</span>
                    </div>
                    <div className={`${styles.rowSubject} ${overlay.truncate} ${msg.unread ? styles.indent : ''}`}>
                      {msg.subject}
                    </div>
                    {msg.snippet && (
                      <div className={`${styles.rowSnippet} ${overlay.truncate} ${msg.unread ? styles.indent : ''}`}>
                        {msg.snippet}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Email detail */}
            <div className={overlay.detailPane}>
              {!selected && !loadingMsg ? (
                <div className={overlay.empty}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" aria-hidden="true"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                  <span>Select a message to read</span>
                </div>
              ) : loadingMsg ? (
                <div className={overlay.empty} role="status">
                  <span className={overlay.loading}>
                    <span className={overlay.pulseDot} aria-hidden="true" />
                    <span>Loading message…</span>
                  </span>
                </div>
              ) : (
                <>
                  <div className={styles.detailHeader}>
                    <h3 className={styles.detailSubject}>{selected.subject}</h3>
                    <div className={styles.senderRow}>
                      <div className={styles.avatar} aria-hidden="true">
                        {senderName(selected.from).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className={styles.senderName}>{senderName(selected.from)}</div>
                        <div className={styles.senderEmail}>{senderEmail(selected.from)}</div>
                      </div>
                      <div className={styles.date}>{relativeTime(selected.date)}</div>
                    </div>
                  </div>

                  <div className={styles.detailBody}>
                    {sent && (
                      <div className={`${overlay.notice} ${styles.sentNotice}`} data-state="success" role="status">
                        Reply sent successfully.
                      </div>
                    )}
                    <pre className={styles.messageText}>
                      {selected.body || '(no content)'}
                    </pre>
                  </div>

                  <div className={overlay.footer}>
                    {replying ? (
                      <div className={styles.reply}>
                        <div className={styles.replyTo}>
                          Replying to {senderEmail(selected.from)}
                        </div>
                        <textarea ref={replyRef} value={replyBody} onChange={e => setReplyBody(e.target.value)} placeholder="Write your reply…" rows={4}
                          aria-label="Reply"
                          className={overlay.textarea} />
                        <div className={styles.replyActions}>
                          <button type="button" onClick={sendReply} disabled={sending || !replyBody.trim()} {...buttonProps('primary', 'sm')}>
                            {sending ? 'Sending…' : 'Send Reply'}
                          </button>
                          <button type="button" onClick={() => { setReplying(false); setReplyBody(''); }} {...buttonProps('secondary', 'sm')}>
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className={styles.actions}>
                        <button type="button" onClick={() => setReplying(true)} {...buttonProps('primary', 'sm')}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
                          Reply
                        </button>
                        <button type="button" onClick={() => { setView('compose'); }} {...buttonProps('secondary', 'sm')}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
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
