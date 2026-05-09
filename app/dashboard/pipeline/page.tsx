'use client'

import { useEffect, useState } from 'react'

const FONT = "var(--font-inter),-apple-system,sans-serif"

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
  { value: 'low',    label: 'Low',    color: '#71717a' },
  { value: 'medium', label: 'Medium', color: '#fbbf24' },
  { value: 'high',   label: 'High',   color: '#f87171' },
]

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:             { bg: 'rgba(99,102,241,.10)',  color: '#a5b4fc', border: 'rgba(99,102,241,.25)', label: 'New' },
  in_progress:     { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.25)', label: 'In progress' },
  awaiting_client: { bg: 'rgba(251,146,60,.10)',  color: '#fb923c', border: 'rgba(251,146,60,.25)', label: 'Awaiting your reply' },
  resolved:        { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.25)',  label: 'Resolved' },
}

const PRIORITY_STYLE: Record<string, { color: string }> = {
  low:    { color: '#71717a' },
  medium: { color: '#fbbf24' },
  high:   { color: '#f87171' },
}

function ago(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 9, padding: '10px 13px', fontSize: 13, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
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
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '36px 24px 80px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: '0 0 4px', letterSpacing: '-.02em' }}>
            Requests &amp; Issues
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', margin: 0 }}>
            Send a request or flag an issue directly to your developer.
          </p>
        </div>
        <button
          onClick={() => setShowForm(s => !s)}
          style={{
            fontSize: 13, fontWeight: 600, padding: '8px 16px', borderRadius: 9, cursor: 'pointer',
            background: showForm ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.18)',
            border: `1px solid ${showForm ? 'rgba(255,255,255,.10)' : 'rgba(99,102,241,.35)'}`,
            color: showForm ? 'rgba(255,255,255,.45)' : '#a5b4fc', fontFamily: FONT,
          }}>
          {showForm ? 'Cancel' : '+ New request'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <form onSubmit={submit} style={{
          background: 'rgba(255,255,255,.03)', border: '1px solid rgba(99,102,241,.22)',
          borderRadius: 14, padding: 20, marginBottom: 20,
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 8 }}>Type</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {TYPE_OPTS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setType(opt.value)}
                  style={{
                    flex: 1, padding: '9px 10px', borderRadius: 9, cursor: 'pointer',
                    background: type === opt.value ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.03)',
                    border: `1px solid ${type === opt.value ? 'rgba(99,102,241,.40)' : 'rgba(255,255,255,.08)'}`,
                    color: type === opt.value ? '#a5b4fc' : 'rgba(255,255,255,.40)',
                    fontSize: 12, fontWeight: 600, fontFamily: FONT, textAlign: 'left',
                  }}>
                  {opt.label}
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,.25)', marginTop: 2, fontWeight: 400 }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 6 }}>Title</div>
            <input style={inp} value={title} onChange={e => setTitle(e.target.value)} placeholder="Brief summary…" required />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 6 }}>Details (optional)</div>
            <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={4}
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder="Steps to reproduce, expected vs actual, or more context…" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 8 }}>Priority</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {PRIORITY_OPTS.map(opt => (
                <button key={opt.value} type="button" onClick={() => setPriority(opt.value)}
                  style={{
                    padding: '6px 16px', borderRadius: 20, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                    background: priority === opt.value ? `${opt.color}20` : 'rgba(255,255,255,.03)',
                    border: `1px solid ${priority === opt.value ? `${opt.color}60` : 'rgba(255,255,255,.08)'}`,
                    color: priority === opt.value ? opt.color : 'rgba(255,255,255,.35)',
                    fontFamily: FONT,
                  }}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          {submitErr && <p style={{ fontSize: 11, color: '#f87171', margin: 0 }}>{submitErr}</p>}
          <button type="submit" disabled={submitting || !title.trim()}
            style={{
              padding: '10px 0', borderRadius: 9, fontSize: 13, fontWeight: 700, cursor: 'pointer',
              background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)',
              color: '#a5b4fc', fontFamily: FONT,
              opacity: submitting || !title.trim() ? .5 : 1,
            }}>
            {submitting ? 'Submitting…' : 'Submit request'}
          </button>
        </form>
      )}

      {/* List */}
      {loading ? (
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading…</div>
      ) : requests.length === 0 ? (
        <div style={{
          border: '1px dashed rgba(255,255,255,.08)', borderRadius: 14,
          padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13,
        }}>
          No requests yet. Hit <strong style={{ color: 'rgba(255,255,255,.40)' }}>+ New request</strong> to get started.
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
                background: isAwaiting ? 'rgba(251,146,60,.04)' : 'rgba(255,255,255,.025)',
                border: isAwaiting ? '1px solid rgba(251,146,60,.28)' : '1px solid rgba(255,255,255,.07)',
                borderRadius: 12, overflow: 'hidden',
              }}>
                {/* Header row — click to expand */}
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '14px 18px', cursor: 'pointer' }}
                  onClick={() => openThread(req)}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)' }}>
                        {req.type}
                      </span>
                      <span style={{ fontSize: 9, color: pr.color, fontWeight: 600 }}>● {req.priority}</span>
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#F5F7FA', marginBottom: req.description ? 4 : 0 }}>
                      {req.title}
                    </div>
                    {req.description && (
                      <p style={{ fontSize: 12, color: 'rgba(255,255,255,.38)', margin: 0, lineHeight: 1.6 }}>{req.description}</p>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                    }}>
                      {st.label}
                    </span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.22)' }}>{ago(req.created_at)}</span>
                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,.18)' }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {/* Expanded thread */}
                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '16px 18px' }}>

                    {/* Awaiting reply banner */}
                    {isAwaiting && (
                      <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'rgba(251,146,60,.08)', border: '1px solid rgba(251,146,60,.25)',
                        borderRadius: 8, padding: '8px 12px', marginBottom: 14,
                      }}>
                        <span style={{ fontSize: 14 }}>💬</span>
                        <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#fb923c' }}>
                          Your developer is waiting for your response
                        </p>
                      </div>
                    )}

                    {/* Message thread */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
                      {isFetching ? (
                        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.22)', margin: 0 }}>Loading messages…</p>
                      ) : !msgs || msgs.length === 0 ? (
                        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.22)', margin: 0 }}>No messages yet.</p>
                      ) : msgs.map(m => (
                        <div key={m.id} style={{
                          display: 'flex', flexDirection: 'column',
                          alignItems: m.author_type === 'founder' ? 'flex-end' : 'flex-start',
                        }}>
                          <div style={{
                            maxWidth: '80%', padding: '10px 14px', borderRadius: 10,
                            background: m.author_type === 'founder' ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.06)',
                            border: `1px solid ${m.author_type === 'founder' ? 'rgba(99,102,241,.30)' : 'rgba(255,255,255,.08)'}`,
                          }}>
                            <p style={{ margin: 0, fontSize: 13, color: '#e4e4e7', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                            <p style={{ margin: '6px 0 0', fontSize: 10, color: 'rgba(255,255,255,.25)' }}>
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
                          style={{
                            ...inp, resize: 'none', lineHeight: 1.6,
                            border: isAwaiting ? '1px solid rgba(251,146,60,.45)' : '1px solid rgba(255,255,255,.09)',
                            boxShadow: isAwaiting ? '0 0 0 2px rgba(251,146,60,.10)' : 'none',
                          }}
                        />
                        {sendErr[req.id] && (
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>{sendErr[req.id]}</p>
                        )}
                        <button
                          onClick={() => sendReply(req)}
                          disabled={!(replies[req.id] ?? '').trim() || sending[req.id]}
                          style={{
                            marginTop: 8, fontSize: 12, fontWeight: 600, padding: '6px 18px',
                            borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
                            background: isAwaiting ? 'rgba(251,146,60,.18)' : 'rgba(99,102,241,.18)',
                            border: `1px solid ${isAwaiting ? 'rgba(251,146,60,.35)' : 'rgba(99,102,241,.35)'}`,
                            color: isAwaiting ? '#fb923c' : '#a5b4fc',
                            opacity: !(replies[req.id] ?? '').trim() || sending[req.id] ? .45 : 1,
                          }}
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
