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
type SessionOption = {
  id: string; name: string; day_of_week: number; start_time: string
  duration_minutes: number; max_capacity: number; session_type: string
  resource_id: string | null; enrolled_count: number
}
type SessionInstanceOption = {
  id: string; session_id: string; date: string; start_time: string
  duration_minutes: number; max_capacity: number; status: string; enrolled_count: number
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

const BOOKING_STATUS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  pending_confirmation: { label: 'Awaiting client confirmation', color: '#fb923c', bg: 'rgba(251,146,60,.10)', border: 'rgba(251,146,60,.30)' },
  confirmed:            { label: '✅ Confirmed',                  color: '#4ade80', bg: 'rgba(34,197,94,.10)',  border: 'rgba(34,197,94,.30)'  },
  reschedule_requested: { label: '🔁 Client requested new time', color: '#f87171', bg: 'rgba(239,68,68,.10)',  border: 'rgba(239,68,68,.30)'  },
  cancelled:            { label: 'Cancelled',                    color: '#71717a', bg: 'rgba(113,113,122,.10)',border: 'rgba(113,113,122,.25)' },
}

const SESSION_TYPES = [
  'Private Lesson',
  'Group Lesson',
  'Hot Shots',
  'Cardio Tennis',
  'Match Play',
  'Squad Training',
  'Junior Development',
  'Other',
]

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']


function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
}

function ago(ts: string) {
  const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${d}d ago`
}

// ─── Add to Session Modal ─────────────────────────────────────────────────────

function AddToSessionModal({ req, onClose, onAdded }: {
  req: PipelineRequest
  onClose: () => void
  onAdded: (msg: Message) => void
}) {
  const [sessions, setSessions]             = useState<SessionOption[]>([])
  const [loading, setLoading]               = useState(true)
  const [selected, setSelected]             = useState<SessionOption | null>(null)
  const [instances, setInstances]           = useState<SessionInstanceOption[]>([])
  const [instancesLoading, setInstancesLoading] = useState(false)
  const [selectedInstance, setSelectedInstance] = useState<SessionInstanceOption | null>(null)
  const [submitting, setSubmitting]         = useState(false)
  const [err, setErr]                       = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sessions')
      .then(r => r.json())
      .then(d => { setSessions(d.sessions ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function selectSession(s: SessionOption) {
    if (selected?.id === s.id) return
    setSelected(s); setSelectedInstance(null); setInstances([])
    setInstancesLoading(true)
    const res = await fetch(`/api/sessions/${s.id}`).catch(() => null)
    setInstancesLoading(false)
    if (res?.ok) {
      const d = await res.json() as { instances: SessionInstanceOption[] }
      const today = new Date().toISOString().split('T')[0]
      const upcoming = (d.instances ?? []).filter(i => i.date >= today && i.status === 'scheduled')
      setInstances(upcoming)
      // Auto-select the first non-full instance
      const first = upcoming.find(i => i.enrolled_count < i.max_capacity)
      if (first) setSelectedInstance(first)
    }
  }

  async function submit() {
    if (!selected || !selectedInstance || submitting) return
    setSubmitting(true); setErr(null)
    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organisation_id:      req.organisation_id,
        pipeline_id:          req.id,
        session_instance_id:  selectedInstance.id,
        client_name:          req.submitted_by_name ?? req.org_name ?? 'Client',
      }),
    })
    setSubmitting(false)
    if (res.ok) {
      const dateObj   = new Date(selectedInstance.date + 'T00:00:00')
      const dateLabel = dateObj.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })
      onAdded({
        id:          crypto.randomUUID(),
        author_type: 'founder',
        body:        `✅ Added to ${selected.name} — ${dateLabel} at ${selectedInstance.start_time}`,
        created_at:  new Date().toISOString(),
      })
      onClose()
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setErr(d.error ?? 'Failed to add to session')
    }
  }

  function fmtInstanceDate(d: string) {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
  }

  const today = new Date().toISOString().split('T')[0]

  return (
    <>
      <style>{`@keyframes as-fade{from{opacity:0}to{opacity:1}}@keyframes as-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'as-fade .15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div style={{ background: '#141417', border: '1px solid rgba(255,255,255,.10)', borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 460, fontFamily: FONT, animation: 'as-in .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em' }}>Add to Session</div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2 }}>{req.org_name ?? 'Unknown org'}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {/* Step 1: Pick session template */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 8 }}>
            Session
          </div>
          {loading ? (
            <p style={{ fontSize: 13, color: 'rgba(255,255,255,.28)', textAlign: 'center', padding: '12px 0' }}>Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <div style={{ fontSize: 13, color: 'rgba(255,255,255,.28)', textAlign: 'center', padding: '16px 0' }}>
              No sessions found. <a href="/admin/sessions" style={{ color: '#a5b4fc', textDecoration: 'none' }}>Create one →</a>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 16, maxHeight: 200, overflowY: 'auto' }}>
              {sessions.map(s => {
                const isSelected = selected?.id === s.id
                return (
                  <div key={s.id} onClick={() => selectSession(s)}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '9px 13px', borderRadius: 10, cursor: 'pointer',
                      background: isSelected ? 'rgba(99,102,241,.14)' : 'rgba(255,255,255,.04)',
                      border: `1px solid ${isSelected ? 'rgba(99,102,241,.35)' : 'rgba(255,255,255,.08)'}`,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA' }}>{s.name}</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.38)', marginTop: 1 }}>
                        {DAY_FULL[s.day_of_week]} · {s.start_time}
                        {s.resource_id && ` · ${s.resource_id}`}
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.35)', flexShrink: 0 }}>
                      {s.session_type}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Step 2: Pick specific date (instance) */}
          {selected && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 8 }}>
                Date
              </div>
              {instancesLoading ? (
                <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', padding: '10px 0', marginBottom: 12 }}>Loading dates…</p>
              ) : instances.length === 0 ? (
                <div style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', padding: '10px 0', marginBottom: 12 }}>
                  No upcoming dates. <a href="/admin/sessions" style={{ color: '#a5b4fc', textDecoration: 'none' }}>Generate instances →</a>
                </div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 16 }}>
                  {instances.map(inst => {
                    const full = inst.enrolled_count >= inst.max_capacity
                    const isSel = selectedInstance?.id === inst.id
                    const capClr = full ? '#f87171' : inst.enrolled_count >= inst.max_capacity * 0.75 ? '#fbbf24' : '#4ade80'
                    const isToday_ = inst.date === today
                    return (
                      <button key={inst.id} onClick={() => !full && setSelectedInstance(inst)} disabled={full}
                        style={{
                          fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: full ? 'not-allowed' : 'pointer',
                          background: isSel ? 'rgba(99,102,241,.20)' : 'rgba(255,255,255,.04)',
                          border: `1px solid ${isSel ? 'rgba(99,102,241,.45)' : 'rgba(255,255,255,.09)'}`,
                          color: isSel ? '#a5b4fc' : full ? 'rgba(255,255,255,.30)' : '#F5F7FA',
                          opacity: full ? .5 : 1, fontFamily: FONT,
                          display: 'flex', alignItems: 'center', gap: 6,
                        }}
                      >
                        {fmtInstanceDate(inst.date)}
                        {isToday_ && <span style={{ fontSize: 9, fontWeight: 800, color: '#a5b4fc' }}>TODAY</span>}
                        <span style={{ fontSize: 10, fontWeight: 700, color: capClr }}>{inst.enrolled_count}/{inst.max_capacity}</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {err && <p style={{ margin: '0 0 10px', fontSize: 11, color: '#f87171' }}>{err}</p>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.40)', fontFamily: FONT }}>
              Cancel
            </button>
            <button onClick={submit} disabled={!selected || !selectedInstance || submitting}
              style={{ flex: 2, fontSize: 12, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: !selected || !selectedInstance || submitting ? .45 : 1 }}>
              {submitting ? 'Adding…' : 'Add to Session'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)',
  borderRadius: 8, padding: '8px 11px', fontSize: 12, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
}

function BookingModal({
  req,
  onClose,
  onBooked,
}: {
  req: PipelineRequest
  onClose: () => void
  onBooked: (systemMsg: Message, booking: BookingRecord) => void
}) {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate]               = useState(today)
  const [time, setTime]               = useState('10:00')
  const [sessionType, setSessionType] = useState(SESSION_TYPES[0])
  const [clientName, setClientName]   = useState(req.submitted_by_name ?? req.org_name ?? '')
  const [clientEmail, setClientEmail] = useState('')
  const [submitting, setSubmitting]   = useState(false)
  const [err, setErr]                 = useState<string | null>(null)

  async function submit() {
    if (!date || !time || !sessionType || !clientName || submitting) return
    setSubmitting(true); setErr(null)

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organisation_id: req.organisation_id,
        pipeline_id:     req.id,
        client_name:     clientName,
        client_email:    clientEmail || undefined,
        date,
        time,
        session_type:    sessionType,
      }),
    })

    setSubmitting(false)

    if (res.ok) {
      const data = await res.json() as { booking: BookingRecord }
      const label = `${fmtDate(date)} at ${time}`
      onBooked(
        {
          id:          crypto.randomUUID(),
          author_type: 'founder',
          body:        `🎾 Session proposed for ${label} — ${sessionType}. Please confirm or request a change.`,
          created_at:  new Date().toISOString(),
        },
        data.booking,
      )
      onClose()
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setErr(d.error ?? 'Failed to create booking')
    }
  }

  return (
    <>
      <style>{`@keyframes bm-fade{from{opacity:0}to{opacity:1}}@keyframes bm-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'bm-fade .15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}
      >
        <div style={{ background: '#141417', border: '1px solid rgba(255,255,255,.10)', borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 420, fontFamily: FONT, animation: 'bm-in .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em' }}>
                {req.booking?.status === 'reschedule_requested' ? 'Propose New Time' : 'Book Session'}
              </div>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 2 }}>{req.org_name ?? 'Unknown org'}</div>
            </div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>✕</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 6 }}>Client Name</label>
              <input style={inp} value={clientName} onChange={e => setClientName(e.target.value)} placeholder="Client name" />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 6 }}>Client Email</label>
              <input style={inp} type="email" value={clientEmail} onChange={e => setClientEmail(e.target.value)} placeholder="Optional" />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 6 }}>Date</label>
                <input style={{ ...inp, colorScheme: 'dark' }} type="date" value={date} min={today} onChange={e => setDate(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 6 }}>Time</label>
                <input style={{ ...inp, colorScheme: 'dark' }} type="time" value={time} onChange={e => setTime(e.target.value)} />
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.30)', marginBottom: 6 }}>Session Type</label>
              <select
                style={{ ...inp, appearance: 'none', cursor: 'pointer' }}
                value={sessionType}
                onChange={e => setSessionType(e.target.value)}
              >
                {SESSION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>

          {err && <p style={{ margin: '12px 0 0', fontSize: 11, color: '#f87171' }}>{err}</p>}

          <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.45)', fontFamily: FONT }}>
              Cancel
            </button>
            <button
              onClick={submit}
              disabled={!date || !time || !clientName || submitting}
              style={{ flex: 2, fontSize: 12, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: (!date || !time || !clientName || submitting) ? .45 : 1 }}
            >
              {submitting ? 'Proposing…' : 'Propose Session'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

function RequestCard({ req, onUpdate }: { req: PipelineRequest; onUpdate: (updated: Partial<PipelineRequest>) => void }) {
  const [expanded, setExpanded]       = useState(false)
  const [saving, setSaving]           = useState(false)
  const [msgs, setMsgs]               = useState<Message[]>(req.messages ?? [])
  const [reply, setReply]             = useState('')
  const [sendErr, setSendErr]         = useState<string | null>(null)
  const [sending, setSending]         = useState(false)
  const [showBooking, setShowBooking]       = useState(false)
  const [showAddSession, setShowAddSession] = useState(false)

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
      {showBooking && (
        <BookingModal
          req={req}
          onClose={() => setShowBooking(false)}
          onBooked={(systemMsg, newBooking) => {
            setMsgs(m => [...m, systemMsg])
            onUpdate({ status: 'awaiting_client', booking: newBooking })
          }}
        />
      )}

      {showAddSession && (
        <AddToSessionModal
          req={req}
          onClose={() => setShowAddSession(false)}
          onAdded={systemMsg => {
            setMsgs(m => [...m, systemMsg])
            onUpdate({ status: 'resolved' })
          }}
        />
      )}

      <div style={{
        background: needsReschedule ? 'rgba(239,68,68,.03)' : 'rgba(255,255,255,.025)',
        border: `1px solid ${needsReschedule ? 'rgba(239,68,68,.25)' : req.status === 'new' ? 'rgba(99,102,241,.20)' : 'rgba(255,255,255,.07)'}`,
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
            {needsReschedule && (
              <span style={{ fontSize: 9, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.30)', padding: '2px 8px', borderRadius: 20 }}>
                🔁 Reschedule
              </span>
            )}
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
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
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

            {/* Booking block */}
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.25)', marginBottom: 8 }}>Session</div>

              {booking ? (
                <div style={{
                  background: BOOKING_STATUS[booking.status]?.bg ?? 'rgba(255,255,255,.04)',
                  border: `1px solid ${BOOKING_STATUS[booking.status]?.border ?? 'rgba(255,255,255,.09)'}`,
                  borderRadius: 10, padding: '12px 14px',
                }}>
                  {/* Reschedule alert */}
                  {needsReschedule && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      background: 'rgba(239,68,68,.10)', border: '1px solid rgba(239,68,68,.25)',
                      borderRadius: 8, padding: '8px 10px', marginBottom: 12,
                    }}>
                      <span style={{ fontSize: 14 }}>🔁</span>
                      <p style={{ margin: 0, fontSize: 12, fontWeight: 600, color: '#f87171' }}>
                        Client requested a new time
                      </p>
                    </div>
                  )}

                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA' }}>{fmtDate(booking.date)}</div>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,.45)', marginTop: 2 }}>
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

                  {needsReschedule && (
                    <button
                      onClick={() => setShowBooking(true)}
                      style={{
                        marginTop: 12, fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                        background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.35)',
                        color: '#a5b4fc', fontFamily: FONT,
                      }}
                    >
                      📅 Propose New Time
                    </button>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => setShowBooking(true)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)',
                      color: '#a5b4fc', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>📅</span> Book Session
                  </button>
                  <button
                    onClick={() => setShowAddSession(true)}
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '7px 16px', borderRadius: 8, cursor: 'pointer',
                      background: 'rgba(34,197,94,.10)', border: '1px solid rgba(34,197,94,.28)',
                      color: '#4ade80', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: 5,
                    }}
                  >
                    <span style={{ fontSize: 13 }}>🎾</span> Add to Session
                  </button>
                </div>
              )}
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
          {rescheduleCount > 0 && (
            <span style={{
              fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 20,
              background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.30)',
            }}>
              🔁 {rescheduleCount} reschedule{rescheduleCount > 1 ? 's' : ''} requested
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
