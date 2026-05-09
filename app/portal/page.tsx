'use client'

import { useEffect, useState } from 'react'

const FONT = "var(--font-inter), -apple-system, sans-serif"

type Message = { id: string; author_type: 'founder' | 'client'; body: string; created_at: string }
type PipelineRequest = {
  id: string; type: string; title: string; description: string | null
  status: string; priority: string; created_at: string
}

const TYPE_OPTIONS = [
  { value: 'request',  label: 'Feature request', icon: '✦' },
  { value: 'issue',    label: 'Bug / issue',      icon: '⚠' },
  { value: 'feedback', label: 'Feedback',          icon: '◈' },
]

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:             { bg: 'rgba(99,102,241,.12)',  color: '#a5b4fc', border: 'rgba(99,102,241,.28)', label: 'New' },
  in_progress:     { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.25)', label: 'In progress' },
  awaiting_client: { bg: 'rgba(251,146,60,.10)',  color: '#fb923c', border: 'rgba(251,146,60,.25)', label: 'Awaiting your reply' },
  resolved:        { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.25)',  label: 'Resolved' },
}

function ago(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8, padding: '8px 11px', fontSize: 12, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box', resize: 'none', lineHeight: 1.6,
}

export default function PortalPage() {
  const [requests, setRequests]   = useState<PipelineRequest[]>([])
  const [loading, setLoading]     = useState(true)
  const [openId, setOpenId]       = useState<string | null>(null)
  const [messages, setMessages]   = useState<Record<string, Message[]>>({})
  const [fetching, setFetching]   = useState<Record<string, boolean>>({})
  const [replies, setReplies]     = useState<Record<string, string>>({})
  const [sending, setSending]     = useState<Record<string, boolean>>({})
  const [sendErr, setSendErr]     = useState<Record<string, string | null>>({})
  const [showForm, setShowForm]   = useState(false)
  const [type, setType]           = useState('request')
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')
  const [submitting, setSub]      = useState(false)
  const [submitError, setSubErr]  = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/portal/pipeline')
      .then(r => r.json())
      .then(d => { setRequests(d.requests ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function open(req: PipelineRequest) {
    const isOpen = openId === req.id
    setOpenId(isOpen ? null : req.id)
    if (!isOpen && messages[req.id] === undefined && !fetching[req.id]) {
      setFetching(f => ({ ...f, [req.id]: true }))
      const res = await fetch(`/api/portal/pipeline/${req.id}/messages`).catch(() => null)
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
    const res = await fetch(`/api/portal/pipeline/${req.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body }),
    }).catch(() => null)
    setSending(s => ({ ...s, [req.id]: false }))
    if (res?.ok) {
      const d = await res.json() as { message: Message }
      setMessages(m => ({ ...m, [req.id]: [...(m[req.id] ?? []), d.message] }))
      setReplies(r => ({ ...r, [req.id]: '' }))
    } else {
      const d = res ? await res.json().catch(() => ({})) as { error?: string } : {}
      setSendErr(e => ({ ...e, [req.id]: d.error ?? 'Failed to send' }))
    }
  }

  async function submit() {
    if (!title.trim() || submitting) return
    setSub(true); setSubErr(null)
    const res = await fetch('/api/portal/pipeline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, title, description }),
    })
    setSub(false)
    if (res.ok) {
      const d = await res.json() as { request: PipelineRequest }
      setRequests(r => [d.request, ...r])
      setMessages(m => ({ ...m, [d.request.id]: [] }))
      setTitle(''); setDesc(''); setShowForm(false)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setSubErr(d.error ?? 'Submission failed')
    }
  }

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: '36px 24px 80px', fontFamily: FONT }}>
      {/* Header */}
      <div style={{ marginBottom: 28, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>
            Support & Requests
          </h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', margin: '4px 0 0' }}>
            Submit requests, report issues, or leave feedback. We'll respond here.
          </p>
        </div>
        <button
          onClick={() => setShowForm(f => !f)}
          style={{
            fontSize: 12, fontWeight: 600, padding: '8px 18px', borderRadius: 20, cursor: 'pointer',
            background: showForm ? 'rgba(255,255,255,.06)' : 'rgba(99,102,241,.20)',
            border: `1px solid ${showForm ? 'rgba(255,255,255,.12)' : 'rgba(99,102,241,.40)'}`,
            color: showForm ? 'rgba(255,255,255,.5)' : '#a5b4fc', fontFamily: FONT, flexShrink: 0,
          }}
        >
          {showForm ? 'Cancel' : '+ New request'}
        </button>
      </div>

      {/* Submit form */}
      {showForm && (
        <div style={{
          background: 'rgba(99,102,241,.06)', border: '1px solid rgba(99,102,241,.20)',
          borderRadius: 14, padding: '20px 20px 16px', marginBottom: 20,
        }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
            {TYPE_OPTIONS.map(t => (
              <button key={t.value} onClick={() => setType(t.value)}
                style={{
                  fontSize: 11, fontWeight: 600, padding: '5px 13px', borderRadius: 20, cursor: 'pointer',
                  background: type === t.value ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
                  border: `1px solid ${type === t.value ? 'rgba(99,102,241,.45)' : 'rgba(255,255,255,.09)'}`,
                  color: type === t.value ? '#a5b4fc' : 'rgba(255,255,255,.35)', fontFamily: FONT,
                }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Short title *"
            style={{ ...inp, resize: undefined, marginBottom: 8, lineHeight: undefined }}
          />
          <textarea
            value={description} onChange={e => setDesc(e.target.value)}
            placeholder="More detail (optional)…" rows={3}
            style={{ ...inp, marginBottom: 10 }}
          />
          {submitError && <p style={{ margin: '0 0 8px', fontSize: 12, color: '#f87171' }}>{submitError}</p>}
          <button
            onClick={submit}
            disabled={!title.trim() || submitting}
            style={{
              fontSize: 12, fontWeight: 600, padding: '7px 20px', borderRadius: 8, cursor: 'pointer',
              background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)',
              color: '#a5b4fc', fontFamily: FONT, opacity: !title.trim() || submitting ? .45 : 1,
            }}
          >
            {submitting ? 'Submitting…' : 'Submit'}
          </button>
        </div>
      )}

      {/* Request list */}
      {loading ? (
        <p style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading…</p>
      ) : requests.length === 0 ? (
        <div style={{
          border: '1px dashed rgba(255,255,255,.08)', borderRadius: 14,
          padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13,
        }}>
          No requests yet. Submit your first one above.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {requests.map(req => {
            const isOpen = openId === req.id
            const st = STATUS_STYLE[req.status] ?? STATUS_STYLE.new
            const msgs = messages[req.id]
            const isFetching = fetching[req.id]

            return (
              <div key={req.id} style={{
                background: req.status === 'awaiting_client' ? 'rgba(251,146,60,.04)' : 'rgba(255,255,255,.025)',
                border: req.status === 'awaiting_client' ? '1px solid rgba(251,146,60,.30)' : '1px solid rgba(255,255,255,.07)',
                borderRadius: 14, overflow: 'hidden',
              }}>
                {/* Header row */}
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
                  onClick={() => open(req)}
                >
                  <span style={{ fontSize: 15, color: 'rgba(255,255,255,.3)', flexShrink: 0 }}>
                    {TYPE_OPTIONS.find(t => t.value === req.type)?.icon ?? '✦'}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {req.title}
                    </div>
                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>
                      {ago(req.created_at)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
                      background: st.bg, color: st.color, border: `1px solid ${st.border}`,
                    }}>{st.label}</span>
                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,.20)' }}>{isOpen ? '▲' : '▼'}</span>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ borderTop: '1px solid rgba(255,255,255,.06)', padding: '16px 18px' }}>
                    {req.description && (
                      <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(255,255,255,.45)', lineHeight: 1.65 }}>
                        {req.description}
                      </p>
                    )}

                    {/* Thread */}
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
                              {m.author_type === 'client' ? 'You' : 'Support'} · {ago(m.created_at)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Reply box — only if not resolved */}
                    {req.status !== 'resolved' && (
                      <div>
                        {req.status === 'awaiting_client' && (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            background: 'rgba(251,146,60,.08)', border: '1px solid rgba(251,146,60,.25)',
                            borderRadius: 8, padding: '8px 12px', marginBottom: 10,
                          }}>
                            <span style={{ fontSize: 13 }}>💬</span>
                            <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#fb923c' }}>
                              Your coach is waiting for your response
                            </p>
                          </div>
                        )}
                        <textarea
                          value={replies[req.id] ?? ''}
                          onChange={e => setReplies(r => ({ ...r, [req.id]: e.target.value }))}
                          placeholder="Add a message…" rows={2}
                          style={{
                            ...inp,
                            border: req.status === 'awaiting_client'
                              ? '1px solid rgba(251,146,60,.45)'
                              : '1px solid rgba(255,255,255,.09)',
                            boxShadow: req.status === 'awaiting_client'
                              ? '0 0 0 2px rgba(251,146,60,.10)'
                              : 'none',
                          }}
                        />
                        {sendErr[req.id] && (
                          <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>{sendErr[req.id]}</p>
                        )}
                        <button
                          onClick={() => sendReply(req)}
                          disabled={!(replies[req.id] ?? '').trim() || sending[req.id]}
                          style={{
                            marginTop: 8, fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8,
                            cursor: 'pointer', fontFamily: FONT,
                            background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)',
                            color: '#a5b4fc',
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
