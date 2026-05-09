'use client'

import { useEffect, useState } from 'react'

const FONT = "var(--font-inter), -apple-system, sans-serif"

type Message = { id: string; author_type: 'founder' | 'client'; body: string; created_at: string }
type BookingRecord = {
  id: string; date: string; time: string; session_type: string
  status: 'pending_confirmation' | 'confirmed' | 'reschedule_requested' | 'cancelled'
  confirmed_at: string | null
}
type PipelineRequest = {
  id: string; type: string; title: string; description: string | null
  status: string; priority: string; created_at: string
  booking?: BookingRecord | null
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

const BOOKING_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending_confirmation: { label: 'Awaiting confirmation', color: '#fb923c', bg: 'rgba(251,146,60,.10)', border: 'rgba(251,146,60,.30)' },
  confirmed:            { label: '✅ Confirmed',           color: '#4ade80', bg: 'rgba(34,197,94,.10)',  border: 'rgba(34,197,94,.30)'  },
  reschedule_requested: { label: '🔁 Awaiting new time',  color: '#fbbf24', bg: 'rgba(251,191,36,.10)', border: 'rgba(251,191,36,.28)' },
  cancelled:            { label: 'Cancelled',             color: '#71717a', bg: 'rgba(113,113,122,.10)',border: 'rgba(113,113,122,.25)' },
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
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8, padding: '8px 11px', fontSize: 12, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box', resize: 'none', lineHeight: 1.6,
}

type RescheduleState = { show: boolean; msg: string; acting: boolean; err: string | null }

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
  // booking action state per request id
  const [bookingActing, setBookingActing]   = useState<Record<string, boolean>>({})
  const [bookingErr, setBookingErr]         = useState<Record<string, string | null>>({})
  const [reschedule, setReschedule]         = useState<Record<string, RescheduleState>>({})

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

  async function confirmBooking(req: PipelineRequest, bookingId: string) {
    if (bookingActing[req.id]) return
    setBookingActing(a => ({ ...a, [req.id]: true }))
    setBookingErr(e => ({ ...e, [req.id]: null }))
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    }).catch(() => null)
    setBookingActing(a => ({ ...a, [req.id]: false }))
    if (res?.ok) {
      const sysMsg: Message = {
        id: crypto.randomUUID(), author_type: 'client',
        body: `✅ Session confirmed for ${fmtDate(req.booking!.date)} at ${req.booking!.time}`,
        created_at: new Date().toISOString(),
      }
      setMessages(m => ({ ...m, [req.id]: [...(m[req.id] ?? []), sysMsg] }))
      setRequests(rs => rs.map(r => r.id === req.id
        ? { ...r, status: 'resolved', booking: { ...r.booking!, status: 'confirmed', confirmed_at: new Date().toISOString() } }
        : r
      ))
    } else {
      const d = res ? await res.json().catch(() => ({})) as { error?: string } : {}
      setBookingErr(e => ({ ...e, [req.id]: d.error ?? 'Failed to confirm booking' }))
    }
  }

  async function requestReschedule(req: PipelineRequest, bookingId: string) {
    const rs = reschedule[req.id]
    if (!rs || bookingActing[req.id]) return
    setBookingActing(a => ({ ...a, [req.id]: true }))
    setBookingErr(e => ({ ...e, [req.id]: null }))
    const res = await fetch(`/api/bookings/${bookingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reschedule', message: rs.msg }),
    }).catch(() => null)
    setBookingActing(a => ({ ...a, [req.id]: false }))
    if (res?.ok) {
      const msgBody = rs.msg.trim()
        ? `🔁 Client requested a different time\n\n"${rs.msg.trim()}"`
        : '🔁 Client requested a different time'
      const sysMsg: Message = {
        id: crypto.randomUUID(), author_type: 'client',
        body: msgBody, created_at: new Date().toISOString(),
      }
      setMessages(m => ({ ...m, [req.id]: [...(m[req.id] ?? []), sysMsg] }))
      setRequests(rs2 => rs2.map(r => r.id === req.id
        ? { ...r, status: 'in_progress', booking: { ...r.booking!, status: 'reschedule_requested' } }
        : r
      ))
      setReschedule(s => ({ ...s, [req.id]: { show: false, msg: '', acting: false, err: null } }))
    } else {
      const d = res ? await res.json().catch(() => ({})) as { error?: string } : {}
      setBookingErr(e => ({ ...e, [req.id]: d.error ?? 'Failed to request change' }))
    }
  }

  function openReschedule(reqId: string) {
    setReschedule(s => ({ ...s, [reqId]: { show: true, msg: '', acting: false, err: null } }))
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
            const booking = req.booking && req.booking.status !== 'cancelled' ? req.booking : null
            const rs = reschedule[req.id]
            const isActing = bookingActing[req.id]

            // Highlight card if booking is pending confirmation
            const hasPendingBooking = booking?.status === 'pending_confirmation'
            const cardBorderColor = hasPendingBooking
              ? 'rgba(99,102,241,.35)'
              : req.status === 'awaiting_client'
              ? 'rgba(251,146,60,.30)'
              : 'rgba(255,255,255,.07)'
            const cardBg = hasPendingBooking
              ? 'rgba(99,102,241,.04)'
              : req.status === 'awaiting_client'
              ? 'rgba(251,146,60,.04)'
              : 'rgba(255,255,255,.025)'

            return (
              <div key={req.id} style={{
                background: cardBg,
                border: `1px solid ${cardBorderColor}`,
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    {hasPendingBooking && (
                      <span style={{ fontSize: 10, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)', padding: '2px 8px', borderRadius: 20 }}>
                        Session proposed
                      </span>
                    )}
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

                    {/* Booking card */}
                    {booking && (
                      <div style={{
                        background: BOOKING_STATUS[booking.status]?.bg ?? 'rgba(255,255,255,.04)',
                        border: `1px solid ${BOOKING_STATUS[booking.status]?.border ?? 'rgba(255,255,255,.09)'}`,
                        borderRadius: 12, padding: '14px 16px', marginBottom: 20,
                      }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
                          <div>
                            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 4 }}>
                              Proposed Session
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.01em' }}>
                              {fmtDate(booking.date)}
                            </div>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,.50)', marginTop: 2 }}>
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

                        {/* Actions for pending_confirmation */}
                        {booking.status === 'pending_confirmation' && !rs?.show && (
                          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
                            <button
                              onClick={() => confirmBooking(req, booking.id)}
                              disabled={isActing}
                              style={{
                                fontSize: 12, fontWeight: 600, padding: '7px 18px', borderRadius: 8, cursor: 'pointer',
                                background: 'rgba(34,197,94,.15)', border: '1px solid rgba(34,197,94,.35)',
                                color: '#4ade80', fontFamily: FONT, opacity: isActing ? .5 : 1,
                              }}
                            >
                              {isActing ? 'Confirming…' : 'Confirm Session'}
                            </button>
                            <button
                              onClick={() => openReschedule(req.id)}
                              disabled={isActing}
                              style={{
                                fontSize: 12, fontWeight: 600, padding: '7px 18px', borderRadius: 8, cursor: 'pointer',
                                background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)',
                                color: 'rgba(255,255,255,.55)', fontFamily: FONT, opacity: isActing ? .5 : 1,
                              }}
                            >
                              Request Change
                            </button>
                          </div>
                        )}

                        {/* Reschedule input */}
                        {booking.status === 'pending_confirmation' && rs?.show && (
                          <div style={{ marginTop: 14 }}>
                            <textarea
                              value={rs.msg}
                              onChange={e => setReschedule(s => ({ ...s, [req.id]: { ...s[req.id], msg: e.target.value } }))}
                              placeholder="What time works for you? (optional)…"
                              rows={2}
                              style={{ ...inp, marginBottom: 8 }}
                            />
                            <div style={{ display: 'flex', gap: 8 }}>
                              <button
                                onClick={() => requestReschedule(req, booking.id)}
                                disabled={isActing}
                                style={{
                                  fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 8, cursor: 'pointer',
                                  background: 'rgba(251,191,36,.14)', border: '1px solid rgba(251,191,36,.35)',
                                  color: '#fbbf24', fontFamily: FONT, opacity: isActing ? .5 : 1,
                                }}
                              >
                                {isActing ? 'Sending…' : 'Confirm Request'}
                              </button>
                              <button
                                onClick={() => setReschedule(s => ({ ...s, [req.id]: { ...s[req.id], show: false } }))}
                                style={{
                                  fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 8, cursor: 'pointer',
                                  background: 'none', border: '1px solid rgba(255,255,255,.09)',
                                  color: 'rgba(255,255,255,.35)', fontFamily: FONT,
                                }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        {bookingErr[req.id] && (
                          <p style={{ margin: '8px 0 0', fontSize: 11, color: '#f87171' }}>{bookingErr[req.id]}</p>
                        )}
                      </div>
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
                        {req.status === 'awaiting_client' && !hasPendingBooking && (
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
                            border: req.status === 'awaiting_client' && !hasPendingBooking
                              ? '1px solid rgba(251,146,60,.45)'
                              : '1px solid rgba(255,255,255,.09)',
                            boxShadow: req.status === 'awaiting_client' && !hasPendingBooking
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
