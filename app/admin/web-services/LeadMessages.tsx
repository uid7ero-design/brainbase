'use client';

import { useState, useEffect, useId } from 'react';
import { Badge, Field, fieldControlClassName, buttonProps } from '@/components/ui/app';
import styles from './LeadMessages.module.css';

// Visual-convergence (remaining visual islands pass): the lead email
// composer and outbound history use the shared field / button / badge
// primitives and theme tokens. Fetching, sending and the warning / error
// handling below are unchanged.

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
  const headingId = useId();

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
    <section className={styles.root} aria-labelledby={headingId}>
      <h3 id={headingId} className={styles.heading}>
        Email this Lead
      </h3>

      <div className={styles.to}>
        <span className={styles.toLabel}>To</span>
        <span className={styles.toValue}>{leadEmail}</span>
      </div>

      <div className={styles.form}>
        <Field label="Subject">
          {control => (
            <input
              {...control}
              value={subject}
              onChange={e => setSubject(e.target.value)}
              placeholder="Subject"
              maxLength={200}
              className={fieldControlClassName}
            />
          )}
        </Field>
        <Field label="Message">
          {control => (
            <textarea
              {...control}
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write your message…"
              rows={4}
              maxLength={5000}
              className={fieldControlClassName}
            />
          )}
        </Field>

        {error && (
          <p className={styles.notice} data-tone="danger" role="alert">
            {error}
          </p>
        )}
        {warning && (
          <p className={styles.notice} data-tone="warning" role="status">
            {warning}
          </p>
        )}

        <div>
          <button
            type="button"
            disabled={sending || !subject.trim() || !body.trim()}
            onClick={send}
            {...buttonProps('primary', 'sm')}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </div>
      </div>

      <div className={styles.history}>
        <h3 className={styles.heading}>
          Message History
        </h3>
        <p className={styles.historyNote}>
          Outbound only — replies from this lead are not captured in BrainBase yet.
        </p>

        {loading ? (
          <p className={styles.state} role="status">Loading…</p>
        ) : messages.length === 0 ? (
          <p className={styles.state}>No messages sent yet.</p>
        ) : (
          <ul className={styles.list}>
            {messages.map(m => (
              <li key={m.id} className={styles.message}>
                <div className={styles.messageHead}>
                  <Badge state="info" dot={false} className={styles.direction}>
                    {m.direction}
                  </Badge>
                  <span className={styles.timestamp}>
                    {fmt(m.created_at)}{m.sender_name ? ` · ${m.sender_name}` : ''}
                  </span>
                </div>
                <p className={styles.subject}>{m.subject}</p>
                <p className={styles.body}>{m.body}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
