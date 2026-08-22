'use client';

import { useState, useEffect } from 'react';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

type Message = {
  id: string;
  direction: string;
  subject: string;
  body: string;
  from_address: string;
  to_address: string;
  resend_message_id: string | null;
  created_by: string | null;
  created_at: string;
  sender_name: string | null;
};

function fmt(ts: string): string {
  return new Date(ts).toLocaleString('en-AU', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function LeadMessages({ leadId, leadEmail }: {
  leadId: string;
  leadEmail: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading]   = useState(true);
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [warning, setWarning]   = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/web-services/leads/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages?: Message[] }) => { if (!cancelled) setMessages(d.messages ?? []); })
      .catch(() => null)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  async function send() {
    if (sending || !subject.trim() || !body.trim()) return;
    setSending(true);
    setError(null);
    setWarning(null);

    try {
      const res = await fetch(`/api/web-services/leads/${leadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: body.trim() }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string; warning?: string; message?: Message | null;
      };

      if (!res.ok) {
        setError(data.error ?? `Server error (${res.status})`);
        return;
      }

      // Email always genuinely sent past this point — never retry
      // automatically on a warning; only tell the admin what happened.
      if (data.warning) {
        setWarning(data.warning);
      } else if (data.message) {
        setMessages(prev => [...prev, data.message as Message]);
      }
      setSubject('');
      setBody('');
    } catch {
      setError('Network error — check your connection');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 8 }}>
        Email this Lead
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '52px 1fr', gap: 8, alignItems: 'center', fontSize: 13, marginBottom: 10 }}>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>To</span>
        <span style={{ color: 'rgba(226,232,240,.75)' }}>{leadEmail}</span>
      </div>

      <input
        value={subject}
        onChange={e => setSubject(e.target.value)}
        placeholder="Subject"
        maxLength={200}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 8, fontSize: 13, marginBottom: 8,
          background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
          color: '#F5F7FA', fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
        }}
      />
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Write your message…"
        rows={4}
        maxLength={5000}
        style={{
          width: '100%', padding: '10px 12px', borderRadius: 8, fontSize: 13, resize: 'vertical',
          background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
          color: '#F5F7FA', fontFamily: FONT, outline: 'none', boxSizing: 'border-box',
          lineHeight: 1.55, marginBottom: 8,
        }}
      />

      {error && (
        <div style={{
          padding: '8px 12px', borderRadius: 7, marginBottom: 8, fontSize: 12,
          background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
          color: 'rgba(252,165,165,.90)',
        }}>
          {error}
        </div>
      )}
      {warning && (
        <div style={{
          padding: '8px 12px', borderRadius: 7, marginBottom: 8, fontSize: 12,
          background: 'rgba(245,158,11,.08)', border: '1px solid rgba(245,158,11,.25)',
          color: 'rgba(253,224,171,.90)',
        }}>
          {warning}
        </div>
      )}

      <button
        disabled={sending || !subject.trim() || !body.trim()}
        onClick={send}
        style={{
          padding: '7px 16px', borderRadius: 7, fontSize: 12, fontWeight: 600,
          background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)',
          color: '#A78BFA', cursor: sending ? 'not-allowed' : 'pointer', fontFamily: FONT,
          opacity: sending || !subject.trim() || !body.trim() ? 0.5 : 1,
        }}
      >
        {sending ? 'Sending…' : 'Send Email'}
      </button>

      <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid rgba(255,255,255,.06)' }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.07em', color: 'rgba(255,255,255,.38)', textTransform: 'uppercase', marginBottom: 4 }}>
          Message History
        </div>
        <p style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', margin: '0 0 10px' }}>
          Outbound only — replies from this lead are not captured in BrainBase yet.
        </p>

        {loading ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.30)' }}>Loading…</p>
        ) : messages.length === 0 ? (
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.30)' }}>No messages sent yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {messages.map(m => (
              <div key={m.id} style={{
                padding: '10px 12px', borderRadius: 8,
                background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
                    background: 'rgba(59,130,246,.12)', color: '#60A5FA', border: '1px solid rgba(59,130,246,.25)',
                    textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>
                    {m.direction}
                  </span>
                  <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)' }}>
                    {fmt(m.created_at)}{m.sender_name ? ` · ${m.sender_name}` : ''}
                  </span>
                </div>
                <p style={{ fontSize: 13, fontWeight: 600, color: '#F0F2F5', margin: '0 0 4px' }}>{m.subject}</p>
                <p style={{ fontSize: 13, color: 'rgba(226,232,240,.60)', whiteSpace: 'pre-wrap', lineHeight: 1.55, margin: 0 }}>{m.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
