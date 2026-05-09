'use client'

import { useEffect, useState } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'

type SessionSlot = {
  id: string
  session_id: string
  date: string
  start_time: string
  duration_minutes: number
  max_capacity: number
  status: string
  session_name: string
  session_type: string
  resource_id: string | null
  enrolled_count: number
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {
    weekday: 'long', day: 'numeric', month: 'long'
  })
}

function fmtShortDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short'
  })
}

function endTime(start: string, dur: number) {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + dur
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function spotsLeft(enrolled: number, max: number) {
  const left = max - enrolled
  if (left <= 0) return { text: 'Full', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' }
  if (left <= 2) return { text: `${left} spot${left === 1 ? '' : 's'} left`, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20' }
  return { text: `${left} spots`, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20' }
}

function isToday(d: string) {
  return d === new Date().toISOString().split('T')[0]
}

// Group sessions by date
function groupByDate(sessions: SessionSlot[]): Map<string, SessionSlot[]> {
  const map = new Map<string, SessionSlot[]>()
  for (const s of sessions) {
    const list = map.get(s.date) ?? []
    list.push(s)
    map.set(s.date, list)
  }
  return map
}

export default function BookPage() {
  const [slots, setSlots]         = useState<SessionSlot[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<SessionSlot | null>(null)

  const [name, setName]           = useState('')
  const [email, setEmail]         = useState('')
  const [phone, setPhone]         = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]           = useState<{ session_name: string; date: string; start_time: string } | null>(null)
  const [err, setErr]             = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tennis/sessions')
      .then(r => r.json())
      .then(d => { setSlots(d.sessions ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  async function book() {
    if (!selected || !name.trim() || !email.trim() || submitting) return
    setSubmitting(true); setErr(null)

    const res = await fetch('/api/tennis/book', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_instance_id: selected.id, name: name.trim(), email: email.trim(), phone: phone.trim() || undefined }),
    })
    const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; booking?: { session_name: string; date: string; start_time: string } }
    setSubmitting(false)

    if (data.success && data.booking) {
      setDone(data.booking)
      setSelected(null)
    } else {
      setErr(data.error ?? 'Something went wrong — please try again.')
    }
  }

  const grouped = groupByDate(slots.filter(s => s.enrolled_count < s.max_capacity || selected?.id === s.id))
  const hasSessions = slots.length > 0

  const inputClass = "w-full bg-white/4 border border-white/8 rounded-xl px-4 py-3 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:border-green-500/40 focus:bg-white/6 transition-all duration-200"
  const labelClass = "block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2"

  return (
    <>
      <Nav />
      <main className="min-h-screen bg-[#0a0a0a] pt-28 pb-24 px-6">
        <div className="max-w-3xl mx-auto">

          {/* Header */}
          <div className="mb-12">
            <p className="text-green-500 text-sm font-semibold uppercase tracking-widest mb-3">Coaching</p>
            <h1 className="text-4xl md:text-5xl font-bold text-white tracking-tight mb-4">Book a Session</h1>
            <p className="text-zinc-500 text-base max-w-lg">
              Pick a session below and secure your spot. Luke will have your name on the list.
            </p>
          </div>

          {/* Success state */}
          {done && (
            <div className="rounded-2xl border border-green-500/25 bg-green-500/8 p-8 text-center mb-12">
              <div className="text-4xl mb-4">🎾</div>
              <h2 className="text-xl font-bold text-white mb-2">You&apos;re booked in!</h2>
              <p className="text-zinc-400 text-sm mb-1">
                <span className="text-white font-semibold">{done.session_name}</span>
              </p>
              <p className="text-zinc-500 text-sm">
                {fmtDate(done.date)} at {done.start_time}
              </p>
              <p className="text-zinc-600 text-xs mt-4">Luke will be in touch to confirm — check your email.</p>
              <button
                onClick={() => { setDone(null); setName(''); setEmail(''); setPhone('') }}
                className="mt-6 text-sm text-green-400 hover:text-green-300 transition-colors underline underline-offset-4"
              >
                Book another session
              </button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="text-zinc-600 text-sm">Loading available sessions…</div>
          )}

          {/* No sessions */}
          {!loading && !hasSessions && !done && (
            <div className="rounded-2xl border border-white/6 bg-white/2 p-12 text-center">
              <p className="text-zinc-500 text-sm mb-4">No sessions scheduled yet.</p>
              <a href="#contact" className="text-green-400 hover:text-green-300 text-sm underline underline-offset-4 transition-colors">
                Contact Luke to arrange a time →
              </a>
            </div>
          )}

          {/* Session list */}
          {!loading && hasSessions && !done && (
            <div className="space-y-8">
              {Array.from(grouped.entries()).map(([date, daySessions]) => (
                <div key={date}>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-sm font-semibold text-zinc-300">{fmtShortDate(date)}</span>
                    {isToday(date) && (
                      <span className="text-xs font-bold uppercase tracking-wider text-green-400 bg-green-500/12 border border-green-500/25 rounded-full px-2.5 py-0.5">
                        Today
                      </span>
                    )}
                  </div>
                  <div className="space-y-3">
                    {daySessions.map(slot => {
                      const spots    = spotsLeft(slot.enrolled_count, slot.max_capacity)
                      const isSel    = selected?.id === slot.id
                      const isFull   = slot.enrolled_count >= slot.max_capacity

                      return (
                        <div key={slot.id}>
                          <button
                            onClick={() => !isFull && setSelected(isSel ? null : slot)}
                            disabled={isFull}
                            className={`w-full text-left rounded-2xl border p-5 transition-all duration-200 ${
                              isSel
                                ? 'border-green-500/40 bg-green-500/8'
                                : isFull
                                ? 'border-white/5 bg-white/2 opacity-50 cursor-not-allowed'
                                : 'border-white/8 bg-white/3 hover:border-white/15 hover:bg-white/5 cursor-pointer'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2.5 mb-1.5 flex-wrap">
                                  <span className="text-base font-bold text-white">{slot.session_name}</span>
                                  <span className="text-xs text-zinc-500 bg-white/5 border border-white/8 rounded-full px-2.5 py-0.5">
                                    {slot.session_type}
                                  </span>
                                </div>
                                <div className="text-sm text-zinc-400">
                                  {slot.start_time} – {endTime(slot.start_time, slot.duration_minutes)}
                                  {slot.resource_id && <span className="text-zinc-600"> · {slot.resource_id}</span>}
                                </div>
                              </div>
                              <div className="flex flex-col items-end gap-2 shrink-0">
                                <span className={`text-xs font-semibold rounded-full px-2.5 py-1 border ${spots.bg} ${spots.color}`}>
                                  {spots.text}
                                </span>
                                {isSel && (
                                  <span className="text-xs text-green-400 font-semibold">Selected ✓</span>
                                )}
                              </div>
                            </div>
                          </button>

                          {/* Inline booking form */}
                          {isSel && (
                            <div className="mt-2 rounded-2xl border border-green-500/20 bg-[#0d1209] p-6">
                              <p className="text-sm font-semibold text-zinc-300 mb-5">
                                Booking: <span className="text-white">{slot.session_name}</span> · {fmtDate(slot.date)} at {slot.start_time}
                              </p>

                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                                <div>
                                  <label className={labelClass}>Full Name *</label>
                                  <input
                                    className={inputClass}
                                    placeholder="Your name"
                                    value={name}
                                    onChange={e => setName(e.target.value)}
                                  />
                                </div>
                                <div>
                                  <label className={labelClass}>Email *</label>
                                  <input
                                    className={inputClass}
                                    type="email"
                                    placeholder="your@email.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className={labelClass}>Phone (optional)</label>
                                  <input
                                    className={inputClass}
                                    type="tel"
                                    placeholder="04xx xxx xxx"
                                    value={phone}
                                    onChange={e => setPhone(e.target.value)}
                                  />
                                </div>
                              </div>

                              {err && (
                                <p className="text-sm text-red-400 mb-4">{err}</p>
                              )}

                              <div className="flex gap-3">
                                <button
                                  onClick={() => { setSelected(null); setErr(null) }}
                                  className="flex-1 text-sm font-semibold py-3 rounded-xl border border-white/8 bg-white/3 text-zinc-400 hover:bg-white/6 transition-all duration-200"
                                >
                                  Cancel
                                </button>
                                <button
                                  onClick={book}
                                  disabled={!name.trim() || !email.trim() || submitting}
                                  className="flex-[2] text-sm font-bold py-3 rounded-xl bg-green-500 text-black hover:bg-green-400 active:scale-95 transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100"
                                >
                                  {submitting ? 'Booking…' : 'Confirm Booking'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              {/* All full fallback */}
              {slots.every(s => s.enrolled_count >= s.max_capacity) && (
                <div className="rounded-2xl border border-white/6 bg-white/2 p-8 text-center">
                  <p className="text-zinc-500 text-sm mb-2">All sessions are currently full.</p>
                  <a href="/tennis#contact" className="text-green-400 hover:text-green-300 text-sm underline underline-offset-4 transition-colors">
                    Contact Luke to join a waitlist →
                  </a>
                </div>
              )}
            </div>
          )}

          {/* Footer note */}
          {!loading && hasSessions && !done && (
            <p className="mt-12 text-zinc-600 text-xs text-center">
              Can&apos;t find a time that works?{' '}
              <a href="/tennis#contact" className="text-zinc-400 hover:text-white underline underline-offset-4 transition-colors">
                Contact Luke directly
              </a>
            </p>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
