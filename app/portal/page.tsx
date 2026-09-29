'use client'

import { useEffect, useState } from 'react'
import {
  Badge, Button, PageHeader, StateMessage, fieldControlClassName, type SemanticState,
} from '@/components/ui/app'
import styles from './Portal.module.css'

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

// Request / booking status → display label + shared semantic state. The
// labels are unchanged; the state only drives token colour + dot shape.
const STATUS_STYLE: Record<string, { state: SemanticState; label: string }> = {
  new:             { state: 'info',    label: 'New' },
  in_progress:     { state: 'warning', label: 'In progress' },
  awaiting_client: { state: 'warning', label: 'Awaiting your reply' },
  resolved:        { state: 'success', label: 'Resolved' },
}

const BOOKING_STATUS: Record<string, { label: string; state: SemanticState }> = {
  pending_confirmation: { label: 'Awaiting confirmation', state: 'warning'  },
  confirmed:            { label: '✅ Confirmed',           state: 'success'  },
  reschedule_requested: { label: '🔁 Awaiting new time',  state: 'warning'  },
  cancelled:            { label: 'Cancelled',             state: 'inactive' },
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
    <div className={styles.page}>
      {/* Header */}
      <PageHeader
        title="Support & Requests"
        description="Submit requests, report issues, or leave feedback. We'll respond here."
        actions={
          <Button
            variant={showForm ? 'secondary' : 'primary'}
            aria-expanded={showForm}
            aria-controls={showForm ? 'portal-new-request' : undefined}
            onClick={() => setShowForm(f => !f)}
          >
            {showForm ? 'Cancel' : '+ New request'}
          </Button>
        }
      />

      {/* Submit form */}
      {showForm && (
        <section id="portal-new-request" className={styles.form} aria-label="New request">
          <div className={styles.typeGroup} role="group" aria-label="Request type">
            {TYPE_OPTIONS.map(t => (
              <button key={t.value} type="button" onClick={() => setType(t.value)}
                className={styles.typeButton}
                aria-pressed={type === t.value}
              >
                <span aria-hidden="true">{t.icon}</span> {t.label}
              </button>
            ))}
          </div>
          <input
            value={title} onChange={e => setTitle(e.target.value)}
            placeholder="Short title *"
            aria-label="Short title"
            aria-required="true"
            className={fieldControlClassName}
          />
          <textarea
            value={description} onChange={e => setDesc(e.target.value)}
            placeholder="More detail (optional)…" rows={3}
            aria-label="More detail (optional)"
            className={`${fieldControlClassName} ${styles.textarea}`}
          />
          {submitError && <p className={styles.error} role="alert">{submitError}</p>}
          <div className={styles.formActions}>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!title.trim() || submitting}
            >
              {submitting ? 'Submitting…' : 'Submit'}
            </Button>
          </div>
        </section>
      )}

      {/* Request list */}
      {loading ? (
        <StateMessage kind="loading" title="Loading…" />
      ) : requests.length === 0 ? (
        <StateMessage kind="empty" size="page" title="No requests yet. Submit your first one above." />
      ) : (
        <ul className={styles.list} aria-label="Your requests">
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
            const attention = hasPendingBooking
              ? 'booking'
              : req.status === 'awaiting_client'
              ? 'awaiting'
              : undefined
            const awaitingReply = req.status === 'awaiting_client' && !hasPendingBooking
            const bodyId = `portal-request-${req.id}`

            return (
              <li key={req.id} className={styles.card} data-attention={attention}>
                {/* Header row */}
                <button
                  type="button"
                  className={styles.cardToggle}
                  aria-expanded={isOpen}
                  aria-controls={isOpen ? bodyId : undefined}
                  onClick={() => open(req)}
                >
                  <span className={styles.typeIcon} aria-hidden="true">
                    {TYPE_OPTIONS.find(t => t.value === req.type)?.icon ?? '✦'}
                  </span>
                  <span className={styles.cardText}>
                    <span className={styles.cardTitle}>
                      {req.title}
                    </span>
                    <span className={styles.cardAge}>
                      {ago(req.created_at)}
                    </span>
                  </span>
                  <span className={styles.cardBadges}>
                    {hasPendingBooking && (
                      <Badge state="info">
                        Session proposed
                      </Badge>
                    )}
                    <Badge state={st.state}>{st.label}</Badge>
                    <span className={styles.chevron} aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
                  </span>
                </button>

                {isOpen && (
                  <div id={bodyId} className={styles.cardBody}>
                    {req.description && (
                      <p className={styles.description}>
                        {req.description}
                      </p>
                    )}

                    {/* Booking card */}
                    {booking && (
                      <div className={styles.booking} data-status={booking.status}>
                        <div className={styles.bookingHead}>
                          <div>
                            <p className={styles.bookingEyebrow}>
                              Proposed Session
                            </p>
                            <p className={styles.bookingDate}>
                              {fmtDate(booking.date)}
                            </p>
                            <p className={styles.bookingTime}>
                              {booking.time} · {booking.session_type}
                            </p>
                          </div>
                          <Badge state={BOOKING_STATUS[booking.status]?.state ?? 'inactive'}>
                            {BOOKING_STATUS[booking.status]?.label ?? booking.status}
                          </Badge>
                        </div>

                        {/* Actions for pending_confirmation */}
                        {booking.status === 'pending_confirmation' && !rs?.show && (
                          <div className={styles.bookingActions}>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={() => confirmBooking(req, booking.id)}
                              disabled={isActing}
                            >
                              {isActing ? 'Confirming…' : 'Confirm Session'}
                            </Button>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => openReschedule(req.id)}
                              disabled={isActing}
                            >
                              Request Change
                            </Button>
                          </div>
                        )}

                        {/* Reschedule input */}
                        {booking.status === 'pending_confirmation' && rs?.show && (
                          <div className={styles.reschedule}>
                            <textarea
                              value={rs.msg}
                              onChange={e => setReschedule(s => ({ ...s, [req.id]: { ...s[req.id], msg: e.target.value } }))}
                              placeholder="What time works for you? (optional)…"
                              aria-label="What time works for you? (optional)"
                              rows={2}
                              className={`${fieldControlClassName} ${styles.textarea}`}
                            />
                            <div className={styles.bookingActions}>
                              <Button
                                variant="primary"
                                size="sm"
                                onClick={() => requestReschedule(req, booking.id)}
                                disabled={isActing}
                              >
                                {isActing ? 'Sending…' : 'Confirm Request'}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setReschedule(s => ({ ...s, [req.id]: { ...s[req.id], show: false } }))}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        )}

                        {bookingErr[req.id] && (
                          <p className={styles.sendError} role="alert">{bookingErr[req.id]}</p>
                        )}
                      </div>
                    )}

                    {/* Thread */}
                    {isFetching ? (
                      <p className={styles.threadNote} role="status">Loading messages…</p>
                    ) : !msgs || msgs.length === 0 ? (
                      <p className={styles.threadNote}>No messages yet.</p>
                    ) : (
                      <ul className={styles.thread} aria-label="Messages">
                        {msgs.map(m => (
                          <li key={m.id} className={styles.message} data-author={m.author_type}>
                            <div className={styles.bubble}>
                              <p className={styles.bubbleBody}>{m.body}</p>
                              <p className={styles.bubbleMeta}>
                                {m.author_type === 'client' ? 'You' : 'Support'} · {ago(m.created_at)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}

                    {/* Reply box — only if not resolved */}
                    {req.status !== 'resolved' && (
                      <div>
                        {awaitingReply && (
                          <div className={styles.awaiting}>
                            <span aria-hidden="true">💬</span>
                            <p className={styles.awaitingText}>
                              Your coach is waiting for your response
                            </p>
                          </div>
                        )}
                        <textarea
                          value={replies[req.id] ?? ''}
                          onChange={e => setReplies(r => ({ ...r, [req.id]: e.target.value }))}
                          placeholder="Add a message…" rows={2}
                          aria-label="Add a message"
                          className={`${fieldControlClassName} ${styles.textarea} ${styles.reply}`}
                          data-attention={awaitingReply ? 'true' : undefined}
                        />
                        {sendErr[req.id] && (
                          <p className={styles.sendError} role="alert">{sendErr[req.id]}</p>
                        )}
                        <div className={styles.sendRow}>
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => sendReply(req)}
                            disabled={!(replies[req.id] ?? '').trim() || sending[req.id]}
                          >
                            {sending[req.id] ? 'Sending…' : 'Send'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
