'use client';

import { useState, useEffect } from 'react';
import { Badge, Field, FormActions, FormError, Panel, buttonProps, fieldControlClassName } from '@/components/ui/app';
import styles from '../Leads.module.css';

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

export default function LeadMessaging({ leadId, leadName, leadEmail }: {
  leadId: string;
  leadName: string;
  leadEmail: string;
}) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [subject, setSubject] = useState('LD Tennis — your enquiry');
  const [messageBody, setMessageBody] = useState(`Hi ${leadName},\n\n`);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/leads/${leadId}/messages`)
      .then(r => r.json())
      .then((d: { messages?: Message[] }) => { if (!cancelled) setMessages(d.messages ?? []); })
      .catch(() => null)
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  async function send() {
    if (sending || !subject.trim() || !messageBody.trim()) return;
    setSending(true);
    setError(null);
    setWarning(null);

    try {
      const res = await fetch(`/api/leads/${leadId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), body: messageBody.trim() }),
      });
      const data = await res.json().catch(() => ({})) as {
        error?: string; warning?: string; message?: Message | null;
      };

      if (!res.ok) {
        setError(data.error ?? `Server error (${res.status})`);
      } else if (data.warning) {
        setWarning(data.warning);
        setSubject('LD Tennis — your enquiry');
        setMessageBody(`Hi ${leadName},\n\n`);
      } else if (data.message) {
        setMessages(prev => [...prev, data.message as Message]);
        setSubject('LD Tennis — your enquiry');
        setMessageBody(`Hi ${leadName},\n\n`);
      }
    } catch {
      setError('Network error — check your connection');
    }
    setSending(false);
  }

  return (
    <Panel title="Email this lead">
      <div className={styles.editorStack}>
        <div className={styles.toRow}>
          <span className={styles.toLabel}>To</span>
          <span className={styles.toValue}>{leadEmail}</span>
        </div>

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
              value={messageBody}
              onChange={e => setMessageBody(e.target.value)}
              placeholder="Write your message..."
              rows={5}
              maxLength={5000}
              className={fieldControlClassName}
            />
          )}
        </Field>

        {error && <FormError>{error}</FormError>}
        {warning && (
          <p className={styles.notice} role="status">{warning}</p>
        )}

        <FormActions>
          <button
            type="button"
            onClick={send}
            disabled={sending || !subject.trim() || !messageBody.trim()}
            {...buttonProps('primary')}
          >
            {sending ? 'Sending…' : 'Send Email'}
          </button>
        </FormActions>

        <div className={styles.history}>
          <h3 className={styles.sectionLabel}>
            Message History
          </h3>
          <p className={styles.hint}>
            Outbound only — replies from the lead land directly in Luke&apos;s inbox and are not captured here.
          </p>

          {loading ? (
            <p className={styles.muted} role="status">Loading…</p>
          ) : messages.length === 0 ? (
            <p className={styles.muted}>No messages sent yet.</p>
          ) : (
            <ul className={styles.messages}>
              {messages.map(m => (
                <li key={m.id} className={styles.messageCard}>
                  <div className={styles.messageMeta}>
                    <Badge state="info" dot={false} className={styles.statusBadge}>
                      {m.direction}
                    </Badge>
                    <span>
                      {fmt(m.created_at)}{m.sender_name ? ` · ${m.sender_name}` : ''}
                    </span>
                  </div>
                  <p className={styles.messageSubject}>{m.subject}</p>
                  <p className={styles.messageBody}>{m.body}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}
