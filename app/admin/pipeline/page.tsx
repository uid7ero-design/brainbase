'use client'

import { useEffect, useState } from 'react'
import { redirect } from 'next/navigation'

const FONT = "var(--font-inter),-apple-system,sans-serif"

type Message = { id: string; author_type: 'founder' | 'client'; body: string; created_at: string }
type PipelineRequest = {
  id: string; type: string; title: string; description: string | null
  status: string; priority: string; founder_note: string | null
  org_name: string | null; submitted_by_name: string | null; created_at: string; updated_at: string
  messages?: Message[]
}

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:             { bg: 'rgba(99,102,241,.12)',  color: '#a5b4fc', border: 'rgba(99,102,241,.28)', label: 'New' },
  in_progress:     { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.25)', label: 'In progress' },
  awaiting_client: { bg: 'rgba(251,146,60,.10)',  color: '#fb923c', border: 'rgba(251,146,60,.25)', label: 'Awaiting client' },
  resolved:        { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.25)',  label: 'Resolved' },
}

const PRIORITY_STYLE: Record<string, { color: string }> = {
  low:    { color: '#71717a' },
  medium: { color: '#fbbf24' },
  high:   { color: '#f87171' },
}

const TYPE_ICON: Record<string, string> = {
  request:  '✦',
  issue:    '⚠',
  feedback: '◈',
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
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
}

function RequestCard({ req, onUpdate }: { req: PipelineRequest; onUpdate: (updated: Partial<PipelineRequest>) => void }) {
  const [expanded, setExpanded]   = useState(false)
  const [saving, setSaving]       = useState(false)
  const [msgs, setMsgs]           = useState<Message[]>(req.messages ?? [])
  const [reply, setReply]         = useState('')
  const [sendErr, setSendErr]     = useState<string | null>(null)
  const [sending, setSending]     = useState(false)
  async function update(patch: { status?: string; priority?: string }) {
    setSaving(true)
    const res = await fetch(`/api/admin/pipeline/${req.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    })
    setSaving(false)
    if (res.ok) {
      const data = await res.json()
      onUpdate(data.request)
    }
  }

  async function sendMessage() {
    if (!reply.trim() || sending) return
    setSending(true); setSendErr(null)
    const res = await fetch(`/api/admin/pipeline/${req.id}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: reply }),
    })
    setSending(false)
    if (res.ok) {
      const d = await res.json() as { message: Message }
      setMsgs(m => [...m, d.message])
      setReply('')
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setSendErr(d.error ?? 'Failed to send')
    }
  }

  const st = STATUS_STYLE[req.status] ?? STATUS_STYLE.new
  const pr = PRIORITY_STYLE[req.priority] ?? PRIORITY_STYLE.medium

  return (
    <div style={{
      background: 'rgba(255,255,255,.025)',
      border: `1px solid ${req.status === 'new' ? 'rgba(99,102,241,.20)' : 'rgba(255,255,255,.07)'}`,
      borderRadius: 14, overflow: 'hidden',
    }}>
      {/* Summary row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
        onClick={() => setExpanded(e => !e)}>
        <span style={{ fontSize: 16, color: 'rgba(255,255,255,.35)', flexShrink: 0 }}>
          {TYPE_ICON[req.type] ?? '✦'}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {req.title}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2 }}>
            {req.org_name ?? 'Unknown org'}{req.submitted_by_name ? ` · ${req.submitted_by_name}` : ''} · {ago(req.created_at)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: pr.color }}>● {req.priority}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
            background: st.bg, color: st.color, border: `1px solid ${st.border}`,
          }}>{st.label}</span>
          <span style={{ fontSize: 11, color: 'rgba(255,255,255,.20)' }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div style={{
          borderTop: '1px solid rgba(255,255,255,.06)',
          padding: '16px 18px',
          display: 'flex', flexDirection: 'column', gap: 14,
        }}>
          {req.description && (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.50)', margin: 0, lineHeight: 1.65 }}>
              {req.description}
            </p>
          )}

          {/* Status buttons */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 8 }}>Status</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(STATUS_STYLE).map(([key, sty]) => (
                <button key={key} onClick={() => update({ status: key })} disabled={saving || req.status === key}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: req.status === key ? 'default' : 'pointer',
                    background: req.status === key ? sty.bg : 'rgba(255,255,255,.04)',
                    border: `1px solid ${req.status === key ? sty.border : 'rgba(255,255,255,.09)'}`,
                    color: req.status === key ? sty.color : 'rgba(255,255,255,.35)',
                    fontFamily: FONT, opacity: saving ? .6 : 1,
                  }}>
                  {sty.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority buttons */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 8 }}>Priority</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {Object.entries(PRIORITY_STYLE).map(([key, sty]) => (
                <button key={key} onClick={() => update({ priority: key })} disabled={saving || req.priority === key}
                  style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: req.priority === key ? 'default' : 'pointer',
                    background: req.priority === key ? `${sty.color}20` : 'rgba(255,255,255,.04)',
                    border: `1px solid ${req.priority === key ? `${sty.color}55` : 'rgba(255,255,255,.09)'}`,
                    color: req.priority === key ? sty.color : 'rgba(255,255,255,.35)',
                    fontFamily: FONT, opacity: saving ? .6 : 1,
                  }}>
                  {key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Message thread */}
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 10 }}>
              Thread ({msgs.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
              {msgs.length === 0 ? (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,.22)', margin: 0 }}>No messages yet.</p>
              ) : msgs.map(m => (
                <div key={m.id} style={{
                  display: 'flex', flexDirection: 'column',
                  alignItems: m.author_type === 'founder' ? 'flex-end' : 'flex-start',
                }}>
                  <div style={{
                    maxWidth: '85%', padding: '9px 13px', borderRadius: 10,
                    background: m.author_type === 'founder' ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.06)',
                    border: `1px solid ${m.author_type === 'founder' ? 'rgba(99,102,241,.30)' : 'rgba(255,255,255,.08)'}`,
                  }}>
                    <p style={{ margin: 0, fontSize: 12, color: '#e4e4e7', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                    <p style={{ margin: '5px 0 0', fontSize: 10, color: 'rgba(255,255,255,.25)' }}>
                      {m.author_type === 'founder' ? 'You' : (req.org_name ?? 'Client')} · {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2}
              value={reply} onChange={e => setReply(e.target.value)}
              placeholder="Reply to client…" />
            {sendErr && <p style={{ margin: '4px 0 0', fontSize: 11, color: '#f87171' }}>{sendErr}</p>}
            <button onClick={sendMessage} disabled={!reply.trim() || sending}
              style={{
                marginTop: 8, fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
                background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)',
                color: '#a5b4fc', fontFamily: FONT,
                opacity: !reply.trim() || sending ? .45 : 1,
              }}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function AdminPipelinePage() {
  const [requests, setRequests] = useState<PipelineRequest[]>([])
  const [loading, setLoading]   = useState(true)
  const [filter, setFilter]     = useState<'all' | 'new' | 'awaiting_client' | 'in_progress' | 'resolved'>('all')

  useEffect(() => {
    fetch('/api/admin/pipeline')
      .then(r => { if (r.status === 403) { redirect('/dashboard'); } return r.json() })
      .then(d => { setRequests(d.requests ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  function handleUpdate(id: string, patch: Partial<PipelineRequest>) {
    setRequests(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r))
  }

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter)
  const newCount = requests.filter(r => r.status === 'new').length
  const awaitingCount = requests.filter(r => r.status === 'awaiting_client').length

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '36px 24px 80px', fontFamily: FONT }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>
            Client Pipeline
          </h1>
          {newCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'rgba(239,68,68,.15)', color: '#f87171', border: '1px solid rgba(239,68,68,.30)',
            }}>
              {newCount} new
            </span>
          )}
          {awaitingCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'rgba(251,146,60,.12)', color: '#fb923c', border: '1px solid rgba(251,146,60,.30)',
            }}>
              {awaitingCount} awaiting client
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', margin: 0 }}>
          Requests and issues submitted by your clients.
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {(['all', 'new', 'awaiting_client', 'in_progress', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
              background: filter === f ? 'rgba(99,102,241,.20)' : 'transparent',
              border: 'none', color: filter === f ? '#a5b4fc' : 'rgba(255,255,255,.35)',
              fontFamily: FONT,
            }}>
            {f === 'all' ? 'All' : STATUS_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ border: '1px dashed rgba(255,255,255,.08)', borderRadius: 14, padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13 }}>
          {filter === 'all' ? 'No requests yet.' : `No ${filter.replace('_', ' ')} requests.`}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(r => (
            <RequestCard key={r.id} req={r} onUpdate={patch => handleUpdate(r.id, patch)} />
          ))}
        </div>
      )}
    </div>
  )
}
