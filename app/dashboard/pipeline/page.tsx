'use client'

import { useEffect, useState, useId } from 'react'
import { buttonProps } from '@/components/ui/app/Button'

const FONT = 'var(--bb-font-sans)'

type Message = { id: string; author_type: 'founder' | 'client'; body: string; created_at: string }
type PipelineRequest = {
  id: string; type: string; title: string; description: string | null
  status: string; priority: string; founder_note: string | null; created_at: string
}

const TYPE_OPTS = [
  { value: 'request',  label: 'Feature request', desc: "Something new you'd like added" },
  { value: 'issue',    label: 'Issue / bug',      desc: "Something that isn't working right" },
  { value: 'feedback', label: 'Feedback',         desc: 'General feedback or suggestion' },
]

const PRIORITY_OPTS = [
  { value: 'low',    label: 'Low',    color: 'var(--text-muted)' },
  { value: 'medium', label: 'Medium', color: 'var(--status-warning)' },
  { value: 'high',   label: 'High',   color: 'var(--status-danger)' },
]

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:             { bg: 'var(--bg-sunken)',  color: 'var(--text-secondary)', border: 'var(--border-strong)', label: 'New' },
  in_progress:     { bg: 'var(--status-info-muted)',  color: 'var(--status-info)', border: 'var(--status-info-border)', label: 'In progress' },
  awaiting_client: { bg: 'var(--status-warning-muted)',  color: 'var(--status-warning)', border: 'var(--status-warning-border)', label: 'Awaiting your reply' },
  resolved:        { bg: 'var(--status-success-muted)',   color: 'var(--status-success)', border: 'var(--status-success-border)',  label: 'Resolved' },
}

const PRIORITY_STYLE: Record<string, { color: string }> = {
  low:    { color: 'var(--text-muted)' },
  medium: { color: 'var(--status-warning)' },
  high:   { color: 'var(--status-danger)' },
}

function ago(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)', padding: '10px 13px', fontSize: 13, color: 'var(--text-primary)',
  fontFamily: FONT, boxSizing: 'border-box',
}

export default function PipelinePage() {
  const [requests, setRequests]   = useState<PipelineRequest[]>([])
  const [loading, setLoading]     = useState(true)
  const [openId, setOpenId]       = useState<string | null>(null)
  const [messages, setMessages]   = useState<Record<string, Message[]>>({})
  const [fetching, setFetching]   = useState<Record<string, boolean>>({})
  const [replies, setReplies]     = useState<Record<string, string>>({})
  const [sending, setSending]     = useState<Record<string, boolean>>({})
  const [sendErr, setSendErr]     = useState<Record<string, string | null>>({})

  const [showForm, setShowForm]       = useState(false)
  const [type, setType]               = useState('request')
  const [title, setTitle]             = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority]       = useState('medium')
  const [submitting, setSubmitting]   = useState(false)
  const [submitErr, setSubmitErr]     = useState('')
  const fid = useId()

  useEffect(() => {
    fetch('/api/pipeline').then(r => r.json())
      .then(d => { setRequests(d.requests ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function openThread(req: PipelineRequest) {
    const isOpen = openId === req.id
    setOpenId(isOpen ? null : req.id)
    if (!isOpen && messages[req.id] === undefined && !fetching[req.id]) {
      setFetching(f => ({ ...f, [req.id]: true }))
      const res = await fetch(`/api/pipeline/${req.id}/messages`).catch(() => null)
      setFetching(f => ({ ...f, [req.id]: false }))
      if (res?.ok) {
        const d = await res.json() as { messages: Message[] }
        setMessages(m => ({ ...m, [req.id]: d.messages ?? [] }))
      } else {
        setMessages(m => ({ ...m, [req.id]: [] }))
      }
    }
  }

  async function sendReply(req: PipelineRequest) {
    const body = (replies[req.id] ?? '').trim()
    if (!body || sending[req.id]) return
    setSending(s => ({ ...s, [req.id]: true }))
    setSendErr(e => ({ ...e, [req.id]: null }))
    const res = await fetch(`/api/pipeline/${req.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).catch(() => null)
    setSending(s => ({ ...s, [req.id]: false }))
    if (res?.ok) {
      const d = await res.json() as { message: Message }
      setMessages(m => ({ ...m, [req.id]: [...(m[req.id] ?? []), d.message] }))
      setReplies(r => ({ ...r, [req.id]: '' }))
      if (req.status === 'awaiting_client') {
        setRequests(rs => rs.map(r => r.id === req.id ? { ...r, status: 'in_progress' } : r))
      }
    } else {
      const d = res ? await res.json().catch(() => ({})) as { error?: string } : {}
      setSendErr(e => ({ ...e, [req.id]: d.error ?? 'Failed to send' }))
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSubmitting(true); setSubmitErr('')
    const res = await fetch('/api/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, description, priority }),
    })
    const data = await res.json()
    setSubmitting(false)
    if (!res.ok) { setSubmitErr(data.error ?? 'Failed to submit'); return }
    setRequests(prev => [data.request, ...prev])
    setMessages(m => ({ ...m, [data.request.id]: [] }))
    setTitle(''); setDescription(''); setType('request'); setPriority('medium')
    setShowForm(false)
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 16px 80px', fontFamily: FONT, color: 'var(--text-primary)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px', letterSpacing: '-.02em' }}>
            Requests &amp; Issues
          </h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>
            Send a request or flag an issue directly to your developer.
          </p>
        </div>
        <button
          type="button"
          aria-expanded={showForm}
          {...buttonProps(showForm ? 'secondary' : 'primary')}
          onClick={() => setShowForm(s => !s)}>
          {showForm ? 'Cancel' : '+ New request'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={submit} style={{
          background: 'var(--bg-surface)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', padding: 20, marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div>
            <span id={`${fid}-type`} style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Type</span>
            <div role="group" aria-labelledby={`${fid}-type`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {TYPE_OPTS.map(opt => (
                <button key={opt.value} type="button" aria-pressed={type === opt.value} onClick={() => setType(opt.value)}
                  style={{
                    flex: '1 1 150px', padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
                    background: type === opt.value ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-surface)',
                    border: `1px solid ${type === opt.value ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                    color: type === opt.value ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)',
                    fontSize: 12, fontWeight: 600, fontFamily: FONT, textAlign: 'left',
                  }}>
                  {opt.label}
                  <span style={{ display: 'block', fontSize: 10, color: 'var(--text-muted)', marginTop: 2, fontWeight: 400 }}>{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label htmlFor={`${fid}-title`} style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Title</label>
            <input id={`${fid}-title`} style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief summary…" required />
          </div>
          <div>
            <label htmlFor={`${fid}-details`} style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 6 }}>Details (optional)</label>
            <textarea id={`${fid}-details`} style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={4}
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual, or more context…" />
          </div>
          <div>
            <span id={`${fid}-priority`} style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Priority</span>
            <div role="group" aria-labelledby={`${fid}-priority`} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {PRIORITY_OPTS.map(opt => (
                <button key={opt.value} type="button" aria-pressed={priority === opt.value} onClick={() => setPriority(opt.value)}
                  style={{
                    padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: priority === opt.value ? `color-mix(in srgb, ${opt.color} 12%, transparent)` : 'var(--bg-surface)',
                    border: `1px solid ${priority === opt.value ? `color-mix(in srgb, ${opt.color} 45%, transparent)` : 'var(--border)'}`,
                    color: priority === opt.value ? opt.color : 'var(--text-secondary)',
                    fontFamily: FONT,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {submitErr && <p style={{ fontSize: 11, color: 'var(--status-danger)', margin: 0 }}>{submitErr}</p>}
          <button type="submit" {...buttonProps('primary')} disabled={submitting || !title.trim()}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{
          border: '1px dashed var(--border-strong)', borderRadius: 'var(--radius-lg)',
          padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13,
        }}>
          No requests yet. Hit <strong style={{ color: 'var(--text-secondary)' }}>+ New request</strong> to get started.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {requests.map(req => {
            const isOpen = openId === req.id
            const st = STATUS_STYLE[req.status] ?? STATUS_STYLE.new
            const pr = PRIORITY_STYLE[req.priority] ?? PRIORITY_STYLE.medium
            const msgs = messages[req.id]
            const isFetching = fetching[req.id]
            const isAwaiting = req.status === 'awaiting_client'

            return (
              <div key={req.id} style={{
                background: isAwaiting ? 'var(--status-warning-muted)' : 'var(--bg-surface)',
                border: isAwaiting ? '1px solid var(--status-warning-border)' : '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', overflow: 'hidden',
              }}>
                {/* Header row — click to expand */}
                <button
                  type="button"
                  aria-expanded={isOpen}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, width: '100%', padding: '14px 18px', cursor: 'pointer', background: 'transparent', border: 'none', color: 'inherit', font: 'inherit', textAlign: 'left' }}
                  onClick={() => openThread(req)}
                >
                  <span style={{ display: 'block', flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
                        {req.type}
                      </span>
                      <span style={{ fontSize: 9, color: pr.color, fontWeight: 600 }}>● {req.priority}</span>
                    </span>
                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: req.description ? 4 : 0, overflowWrap: 'anywhere' }}>
                      {req.title}
                    </span>
                    {req.description && (
                      <span style={{ display: 'block', fontSize: 12, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, overflowWrap: 'anywhere' }}>{req.description}</span>
                    )}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                    }}>
                      {st.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{ago(req.created_at)}</span>
                    <span aria-hidden="true" style={{ fontSize: 10, color: 'var(--text-muted)' }}>{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>

                {/* Expanded thread */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid var(--border-light)', padding: '16px 18px' }}>

                    {/* Awaiting reply banner */}
                    {isAwaiting && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)',
                        borderRadius: 8, padding: '8px 12px', marginBottom: 14,
                      }}>
                        <span aria-hidden="true" style={{ fontSize: 14 }}>💬</span>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--status-warning)' }}>
                          Your developer is waiting for your response
                        </p>
                      </div>
                    )}

                    {/* Message thread */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                      {isFetching ? (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>Loading messages…</p>
                      ) : !msgs || msgs.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: 0 }}>No messages yet.</p>
                      ) : msgs.map(m => (
                        <div key={m.id} style={{
                          display: 'flex', flexDirection: 'column',
                          alignItems: m.author_type === 'founder' ? 'flex-end' : 'flex-start',
                        }}>
                          <div style={{
                            maxWidth: '80%', padding: '10px 14px', borderRadius: 'var(--radius-lg)', overflowWrap: 'anywhere',
                            background: m.author_type === 'founder' ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
                            border: `1px solid ${m.author_type === 'founder' ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                          }}>
                            <p style={{ margin: 0, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                            <p style={{ margin: '6px 0 0', fontSize: 10, color: 'var(--text-muted)' }}>
                              {m.author_type === 'client' ? 'You' : 'Developer'} · {ago(m.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Reply box */}
                    {req.status !== 'resolved' && (
                      <div>
                        <textarea
                          value={replies[req.id] ?? ''}
                          onChange={e => setReplies(r => ({ ...r, [req.id]: e.target.value }))}
                          placeholder="Reply…" rows={2}
                          aria-label="Reply"
                          style={{
                            ...inp, resize: 'none', lineHeight: 1.6,
                            border: isAwaiting ? '1px solid var(--status-warning)' : '1px solid var(--border-strong)',
                          }}
                        />
                        {sendErr[req.id] && (
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--status-danger)' }}>{sendErr[req.id]}</p>
                        )}
                        <button
                          type="button"
                          {...buttonProps('primary', 'sm')}
                          onClick={() => sendReply(req)}
                          disabled={!(replies[req.id] ?? '').trim() || sending[req.id]}
                          style={{ marginTop: 8 }}
                        >
                          {sending[req.id] ? 'Sending…' : 'Send'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
