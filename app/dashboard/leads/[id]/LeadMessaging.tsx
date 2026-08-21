'use client';

import { useState, useEffect } from 'react';

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
    <div className="rounded-2xl border border-white/8 bg-white/2 p-5 mb-6 space-y-4">
      <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Email this lead</p>

      <div className="grid grid-cols-[60px_1fr] gap-2 items-center text-sm">
        <span className="text-xs text-zinc-500">To</span>
        <span className="text-zinc-300">{leadEmail}</span>
      </div>

      <input
        value={subject}
        onChange={e => setSubject(e.target.value)}
        placeholder="Subject"
        maxLength={200}
        className="w-full bg-white/4 border border-white/8 rounded-xl px-4 py-2.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
      />
      <textarea
        value={messageBody}
        onChange={e => setMessageBody(e.target.value)}
        placeholder="Write your message..."
        rows={5}
        maxLength={5000}
        className="w-full bg-white/4 border border-white/8 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-white/20 resize-vertical"
      />

      {error && (
        <p className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
      )}
      {warning && (
        <p className="text-xs text-yellow-400 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">{warning}</p>
      )}

      <div className="flex justify-end">
        <button
          onClick={send}
          disabled={sending || !subject.trim() || !messageBody.trim()}
          className="text-sm font-semibold px-5 py-2 rounded-full bg-green-500 text-black hover:bg-green-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? 'Sending…' : 'Send Email'}
        </button>
      </div>

      <div className="pt-2 border-t border-white/5">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1 mt-3">
          Message History
        </p>
        <p className="text-xs text-zinc-600 mb-3">
          Outbound only — replies from the lead land directly in Luke&apos;s inbox and are not captured here.
        </p>

        {loading ? (
          <p className="text-sm text-zinc-600">Loading…</p>
        ) : messages.length === 0 ? (
          <p className="text-sm text-zinc-600">No messages sent yet.</p>
        ) : (
          <div className="space-y-3">
            {messages.map(m => (
              <div key={m.id} className="rounded-xl border border-white/6 bg-white/2 px-4 py-3">
                <div className="flex items-center justify-between gap-2 mb-1.5 flex-wrap">
                  <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20 capitalize">
                    {m.direction}
                  </span>
                  <span className="text-xs text-zinc-600">
                    {fmt(m.created_at)}{m.sender_name ? ` · ${m.sender_name}` : ''}
                  </span>
                </div>
                <p className="text-sm font-semibold text-zinc-200 mb-1">{m.subject}</p>
                <p className="text-sm text-zinc-400 whitespace-pre-wrap leading-relaxed">{m.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
