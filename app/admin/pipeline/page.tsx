'use client'

import { useEffect, useState } from 'react'
import { redirect } from 'next/navigation'

const FONT = "var(--font-inter),-apple-system,sans-serif"

type Message = { id: string; author_type: 'founder' | 'client'; body: string; created_at: string }
type BookingRecord = {
  id: string; date: string; time: string; session_type: string
  status: 'pending_confirmation' | 'confirmed' | 'reschedule_requested' | 'cancelled'
  confirmed_at: string | null
}
type PipelineRequest = {
  id: string; type: string; title: string; description: string | null
  status: string; priority: string; founder_note: string | null
  organisation_id: string; org_name: string | null; submitted_by_name: string | null
  created_at: string; updated_at: string
  messages?: Message[]
  booking?: BookingRecord | null
}

const STATUS_STYLE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:             { bg: 'var(--status-info-muted)',  color: 'var(--status-info)', border: 'var(--status-info-border)', label: 'New' },
  in_progress:     { bg: 'var(--status-warning-muted)',  color: 'var(--status-warning)', border: 'var(--status-warning-border)', label: 'In progress' },
  awaiting_client: { bg: 'var(--status-warning-muted)',  color: 'var(--status-warning)', border: 'var(--status-warning-border)', label: 'Awaiting client' },
  resolved:        { bg: 'var(--status-success-muted)',   color: 'var(--status-success)', border: 'var(--status-success-border)',  label: 'Resolved' },
}

const PRIORITY_STYLE: Record<string, { color: string }> = {
  low:    { color: 'var(--text-muted)' },
  medium: { color: 'var(--status-warning)' },
  high:   { color: 'var(--status-danger)' },
}

const TYPE_ICON: Record<string, string> = {
  request:  '✦',
  issue:    '⚠',
  feedback: '◈',
}

const BOOKING_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending_confirmation: { label: 'Awaiting client confirmation', color: 'var(--status-warning)', bg: 'var(--status-warning-muted)', border: 'var(--status-warning-border)' },
  confirmed:            { label: '✅ Confirmed',                  color: 'var(--status-success)', bg: 'var(--status-success-muted)',  border: 'var(--status-success-border)'  },
  reschedule_requested: { label: '🔁 Client requested new time', color: 'var(--status-danger)', bg: 'var(--status-danger-muted)',  border: 'var(--status-danger-border)'  },
  cancelled:            { label: 'Cancelled',                    color: 'var(--text-muted)', bg: 'var(--status-inactive-muted)',border: 'var(--border)' },
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function ago(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-sunken)', border: '1px solid var(--border)',
  borderRadius: 8, padding: '8px 11px', fontSize: 12, color: 'var(--text-primary)',
  fontFamily: FONT, boxSizing: 'border-box',
}

function RequestCard({ req, onUpdate }: { req: PipelineRequest; onUpdate: (updated: Partial<PipelineRequest>) => void }) {
  const [expanded, setExpanded]       = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msgs, setMsgs]               = useState<Message[]>(req.messages ?? [])
  const [reply, setReply]             = useState('')
  const [sendErr, setSendErr]         = useState<string | null>(null)
  const [sending, setSending]         = useState(false)

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
  const booking = req.booking && req.booking.status !== 'cancelled' ? req.booking : null
  const needsReschedule = booking?.status === 'reschedule_requested'

  return (
    <>
      <div style={{
        background: needsReschedule ? 'var(--status-danger-muted)' : 'var(--bg-surface)',
        border: `1px solid ${needsReschedule ? 'var(--status-danger-border)' : req.status === 'new' ? 'var(--status-info-border)' : 'var(--border)'}`,
        borderRadius: 14, overflow: 'hidden',
      }}>
        {/* Summary row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', cursor: 'pointer' }}
          role="button" tabIndex={0} aria-expanded={expanded}
          onClick={() => setExpanded(e => !e)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(v => !v); } }}>
          <span style={{ fontSize: 16, color: 'var(--text-muted)', flexShrink: 0 }}>
            {TYPE_ICON[req.type] ?? '✦'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {req.title}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {req.org_name ?? 'Unknown org'}{req.submitted_by_name ? ` · ${req.submitted_by_name}` : ''} · {ago(req.created_at)}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            {needsReschedule && (
              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--status-danger)', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', padding: '2px 8px', borderRadius: 20 }}>
                🔁 Reschedule
              </span>
            )}
            <span style={{ fontSize: 9, fontWeight: 700, color: pr.color }}>● {req.priority}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: '2px 9px', borderRadius: 20,
              background: st.bg, color: st.color, border: `1px solid ${st.border}`,
            }}>{st.label}</span>
            <span style={{ fontSize: 11, color: 'var(--text-subtle)' }}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>

        {expanded && (
          <div style={{
            borderTop: '1px solid var(--border)',
            padding: '16px 18px',
            display: 'flex', flexDirection: 'column', gap: 14,
          }}>
            {req.description && (
              <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.65 }}>
                {req.description}
              </p>
            )}

            {/* Status buttons */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 8 }}>Status</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(STATUS_STYLE).map(([key, sty]) => (
                  <button key={key} onClick={() => update({ status: key })} disabled={saving || req.status === key}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: req.status === key ? 'default' : 'pointer',
                      background: req.status === key ? sty.bg : 'var(--bg-sunken)',
                      border: `1px solid ${req.status === key ? sty.border : 'var(--border)'}`,
                      color: req.status === key ? sty.color : 'var(--text-muted)',
                      fontFamily: FONT, opacity: saving ? .6 : 1,
                    }}>
                    {sty.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Priority buttons */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 8 }}>Priority</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {Object.entries(PRIORITY_STYLE).map(([key, sty]) => (
                  <button key={key} onClick={() => update({ priority: key })} disabled={saving || req.priority === key}
                    style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: req.priority === key ? 'default' : 'pointer',
                      background: req.priority === key ? `${sty.color}20` : 'var(--bg-sunken)',
                      border: `1px solid ${req.priority === key ? `${sty.color}55` : 'var(--border)'}`,
                      color: req.priority === key ? sty.color : 'var(--text-muted)',
                      fontFamily: FONT, opacity: saving ? .6 : 1,
                    }}>
                    {key.charAt(0).toUpperCase() + key.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            {/* Booking block — read-only status display. Session creation/proposal
                from this console is out of scope for this release (Path B1);
                see Phase_0_5_Path_B1_Production_Release_Plan.md. */}
            {booking && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 8 }}>Session</div>
                <div style={{
                  background: BOOKING_STATUS[booking.status]?.bg ?? 'var(--bg-sunken)',
                  border: `1px solid ${BOOKING_STATUS[booking.status]?.border ?? 'var(--border)'}`,
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  {/* Reschedule alert */}
                  {needsReschedule && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)',
                      borderRadius: 8, padding: '8px 10px', marginBottom: 12,
                    }}>
                      <span style={{ fontSize: 14 }}>🔁</span>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: 'var(--status-danger)' }}>
                        Client requested a new time
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{fmtDate(booking.date)}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                        {booking.time} · {booking.session_type}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, flexShrink: 0,
                      background: BOOKING_STATUS[booking.status]?.bg,
                      color: BOOKING_STATUS[booking.status]?.color,
                      border: `1px solid ${BOOKING_STATUS[booking.status]?.border}`,
                    }}>
                      {BOOKING_STATUS[booking.status]?.label ?? booking.status}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Message thread */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-subtle)', marginBottom: 10 }}>
                Thread ({msgs.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                {msgs.length === 0 ? (
                  <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>No messages yet.</p>
                ) : msgs.map(m => (
                  <div key={m.id} style={{
                    display: 'flex', flexDirection: 'column',
                    alignItems: m.author_type === 'founder' ? 'flex-end' : 'flex-start',
                  }}>
                    <div style={{
                      maxWidth: '85%', padding: '9px 13px', borderRadius: 10,
                      background: m.author_type === 'founder' ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
                      border: `1px solid ${m.author_type === 'founder' ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                    }}>
                      <p style={{ margin: 0, fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{m.body}</p>
                      <p style={{ margin: '5px 0 0', fontSize: 10, color: 'var(--text-subtle)' }}>
                        {m.author_type === 'founder' ? 'You' : (req.org_name ?? 'Client')} · {new Date(m.created_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
              <textarea style={{ ...inp, resize: 'vertical', lineHeight: 1.6 }} rows={2}
                value={reply} onChange={e => setReply(e.target.value)}
                placeholder="Reply to client…" />
              {sendErr && <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--status-danger)' }}>{sendErr}</p>}
              <button onClick={sendMessage} disabled={!reply.trim() || sending}
                style={{
                  marginTop: 8, fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
                  background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)',
                  color: 'var(--brand-brainbase-accent)', fontFamily: FONT,
                  opacity: !reply.trim() || sending ? .45 : 1,
                }}>
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
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
  const rescheduleCount = requests.filter(r => r.booking?.status === 'reschedule_requested').length

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '36px 24px 80px', fontFamily: FONT }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-.02em' }}>
            Client Pipeline
          </h1>
          {newCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'var(--status-danger-muted)', color: 'var(--status-danger)', border: '1px solid var(--status-danger-border)',
            }}>
              {newCount} new
            </span>
          )}
          {awaitingCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'var(--status-warning-muted)', color: 'var(--status-warning)', border: '1px solid var(--status-warning-border)',
            }}>
              {awaitingCount} awaiting client
            </span>
          )}
          {rescheduleCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'var(--status-danger-muted)', color: 'var(--status-danger)', border: '1px solid var(--status-danger-border)',
            }}>
              🔁 {rescheduleCount} reschedule{rescheduleCount > 1 ? 's' : ''} requested
            </span>
          )}
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-subtle)', margin: 0 }}>
          Requests and issues submitted by your clients.
        </p>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
        {(['all', 'new', 'awaiting_client', 'in_progress', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{
              fontSize: 11, fontWeight: 600, padding: '5px 14px', borderRadius: 7, cursor: 'pointer',
              background: filter === f ? 'var(--brand-brainbase-accent-muted)' : 'transparent',
              border: 'none', color: filter === f ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)',
              fontFamily: FONT,
            }}>
            {f === 'all' ? 'All' : STATUS_STYLE[f]?.label ?? f}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-subtle)', fontSize: 13 }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ border: '1px dashed var(--border)', borderRadius: 14, padding: '48px 24px', textAlign: 'center', color: 'var(--text-subtle)', fontSize: 13 }}>
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
