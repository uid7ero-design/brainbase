'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { parseLocalDate, formatDateAU } from '@/lib/date'

const FONT = "var(--font-inter),-apple-system,sans-serif"
const API  = '/api/dashboard/sessions'

type Session = {
  id: string; name: string; day_of_week: number; start_time: string
  duration_minutes: number; max_capacity: number; session_type: string
  resource_id: string | null; recurring: boolean; created_at: string
  enrolled_count: number; price_per_session: number
}

type SessionInstance = {
  id: string; session_id: string; date: string; start_time: string
  duration_minutes: number; max_capacity: number; status: string
  created_at: string; enrolled_count: number; revenue: number; utilisation: number
}

type WeekInstance = SessionInstance & { session_name: string; session_type: string; resource_id: string | null }

type InstanceBooking = {
  id: string; client_name: string; client_email: string | null
  paid: boolean; attendance_status: string | null; status: string
  pipeline_id: string | null; is_recurring: boolean; created_at: string
}

type InstanceDetail = { instance: SessionInstance; bookings: InstanceBooking[] }
type ContactBrief  = { id: string; name: string; session_id: string | null }

const LOCATIONS = ['Mt Compass Tennis Club', 'Morphett Vale Tennis Club']

const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABEL  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_FULL   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const ATTENDANCE_CYCLE: Record<string, string> = {
  null: 'attending', attending: 'absent', absent: 'null',
}
const ATTENDANCE_STYLE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  attending: { label: '✓ Here',   color: '#4ade80', bg: 'rgba(34,197,94,.12)',  border: 'rgba(34,197,94,.30)'  },
  absent:    { label: '✗ Absent', color: '#f87171', bg: 'rgba(239,68,68,.12)',  border: 'rgba(239,68,68,.30)'  },
}

const SESSION_LABELS: Record<string, string> = {
  // Private Coaching
  PRIVATE_30:        'Private Coaching (30 min)',
  PRIVATE_60:        'Private Coaching (60 min)',
  SEMI_PRIVATE:      'Semi-Private Coaching',
  // Hot Shots (Juniors)
  GROUP_TERM_JUNIOR: 'Hot Shots Tennis',
  MATCHPLAY:         'Hot Shots Matchplay',
  // Adult Coaching
  GROUP_TERM_ADULT:  'Adult Beginner Group',
  // Fitness
  CARDIO_SESSION:    'Cardio Tennis',
  CARDIO_TERM:       'Cardio Tennis (Term)',
  // Other
  CLINIC:            'Clinic',
  ASSESSMENT:        'Assessment',
  // Legacy fallbacks
  PRIVATE:           'Private Coaching',
  GROUP:             'Group Session',
  GROUP_CASUAL:      'Group Session',
  ACADEMY:           'Academy Program',
}

const SESSION_COLOURS: Record<string, { text: string; bg: string; border: string }> = {
  PRIVATE_30:        { text: '#c084fc', bg: 'rgba(168,85,247,.14)',   border: 'rgba(168,85,247,.35)'   },
  PRIVATE_60:        { text: '#a855f7', bg: 'rgba(168,85,247,.20)',   border: 'rgba(168,85,247,.42)'   },
  SEMI_PRIVATE:      { text: '#818cf8', bg: 'rgba(79,70,229,.15)',    border: 'rgba(79,70,229,.38)'    },
  GROUP_TERM_JUNIOR: { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  MATCHPLAY:         { text: '#34d399', bg: 'rgba(16,185,129,.12)',   border: 'rgba(16,185,129,.30)'   },
  GROUP_TERM_ADULT:  { text: '#60a5fa', bg: 'rgba(37,99,235,.13)',    border: 'rgba(37,99,235,.32)'    },
  CARDIO_SESSION:    { text: '#fb923c', bg: 'rgba(249,115,22,.13)',   border: 'rgba(249,115,22,.32)'   },
  CARDIO_TERM:       { text: '#f97316', bg: 'rgba(234,88,12,.14)',    border: 'rgba(234,88,12,.34)'    },
  CLINIC:            { text: '#7dd3fc', bg: 'rgba(14,165,233,.12)',   border: 'rgba(14,165,233,.30)'   },
  ASSESSMENT:        { text: '#94a3b8', bg: 'rgba(100,116,139,.13)',  border: 'rgba(100,116,139,.30)'  },
  // Legacy fallbacks
  PRIVATE:           { text: '#c084fc', bg: 'rgba(168,85,247,.14)',   border: 'rgba(168,85,247,.35)'   },
  GROUP:             { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  GROUP_CASUAL:      { text: '#4ade80', bg: 'rgba(22,163,74,.13)',    border: 'rgba(22,163,74,.32)'    },
  ACADEMY:           { text: '#fb923c', bg: 'rgba(249,115,22,.13)',   border: 'rgba(249,115,22,.32)'   },
}

const SESSION_PRICES: Record<string, number> = {
  PRIVATE_60:        70,
  PRIVATE_30:        35,
  SEMI_PRIVATE:      50,
  GROUP_TERM_JUNIOR: 20,
  MATCHPLAY:         20,
  GROUP_TERM_ADULT:  20,
  CARDIO_SESSION:    15,
  CARDIO_TERM:       15,
  CLINIC:            25,
  ASSESSMENT:         0,
  PRIVATE:           55,
  GROUP:             20,
  GROUP_CASUAL:      20,
  ACADEMY:           25,
}

function sessionLabel(type: string) {
  return SESSION_LABELS[type] ?? type ?? 'Session'
}

function sessionChip(type: string): React.CSSProperties {
  const c = SESSION_COLOURS[type]
  if (!c) return { color: 'rgba(255,255,255,.35)', background: 'rgba(255,255,255,.06)', border: '1px solid rgba(255,255,255,.12)', fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', display: 'inline-block' }
  return { color: c.text, background: c.bg, border: `1px solid ${c.border}`, fontSize: 10, fontWeight: 700, borderRadius: 20, padding: '2px 8px', display: 'inline-block' }
}

function sessionPrice(type: string) { return SESSION_PRICES[type] ?? 0 }
function sessionRevenue(pricePerSession: number, type: string, count: number) {
  return pricePerSession > 0 ? pricePerSession * count : sessionPrice(type) * count
}
function fmtMoney(n: number) { return n === 0 ? '—' : `$${n.toLocaleString()}` }

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
  borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
}

// ─── Custom Select ────────────────────────────────────────────────────────────

type SelectOption = { value: string; label: string }
type SelectGroup  = { label: string; options: SelectOption[] }

const SESSION_TYPE_GROUPS: SelectGroup[] = [
  { label: '🎾 Private Coaching', options: [
    { value: 'PRIVATE_30',   label: 'Private Coaching (30 min)' },
    { value: 'PRIVATE_60',   label: 'Private Coaching (60 min)' },
    { value: 'SEMI_PRIVATE', label: 'Semi-Private Coaching' },
  ]},
  { label: '🟢 Hot Shots (Juniors)', options: [
    { value: 'GROUP_TERM_JUNIOR', label: 'Hot Shots Tennis' },
    { value: 'MATCHPLAY',         label: 'Hot Shots Matchplay' },
  ]},
  { label: '🔵 Adult Coaching', options: [
    { value: 'GROUP_TERM_ADULT', label: 'Adult Beginner Group' },
  ]},
  { label: '🔥 Fitness', options: [
    { value: 'CARDIO_SESSION', label: 'Cardio Tennis (Session)' },
    { value: 'CARDIO_TERM',    label: 'Cardio Tennis (Term)' },
  ]},
  { label: '🧪 Other', options: [
    { value: 'CLINIC',      label: 'Clinic' },
    { value: 'ASSESSMENT',  label: 'Assessment' },
  ]},
]

const LOCATION_OPTIONS: SelectOption[] = LOCATIONS.map(l => ({ value: l, label: l }))

function CustomSelect({ value, onChange, placeholder, options, groups }: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  options?: SelectOption[]
  groups?: SelectGroup[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function outside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open])

  let displayLabel = placeholder ?? 'Select…'
  if (value) {
    if (options) {
      displayLabel = options.find(o => o.value === value)?.label ?? value
    } else if (groups) {
      for (const g of groups) {
        const found = g.options.find(o => o.value === value)
        if (found) { displayLabel = found.label; break }
      }
    }
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => setOpen(v => !v)}
        style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}
      >
        <span style={{ color: value ? '#F5F7FA' : 'rgba(255,255,255,.30)' }}>{displayLabel}</span>
        <span style={{ color: 'rgba(255,255,255,.28)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          zIndex: 9999, background: '#16181d', border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 10, overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
        }}>
          {placeholder && (
            <div
              onMouseDown={() => { onChange(''); setOpen(false) }}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontFamily: FONT, color: 'rgba(255,255,255,.30)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.05)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{placeholder}</div>
          )}
          {options?.map(o => (
            <div key={o.value}
              onMouseDown={() => { onChange(o.value); setOpen(false) }}
              style={{ padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                color: value === o.value ? '#a5b4fc' : '#F5F7FA',
                background: value === o.value ? 'rgba(99,102,241,.18)' : 'transparent' }}
              onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}
              onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = 'transparent' }}
            >{o.label}</div>
          ))}
          {groups?.map(g => (
            <div key={g.label}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', fontFamily: FONT }}>{g.label}</div>
              {g.options.map(o => (
                <div key={o.value}
                  onMouseDown={() => { onChange(o.value); setOpen(false) }}
                  style={{ padding: '9px 14px 9px 20px', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                    color: value === o.value ? '#a5b4fc' : '#F5F7FA',
                    background: value === o.value ? 'rgba(99,102,241,.18)' : 'transparent' }}
                  onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = 'rgba(255,255,255,.06)' }}
                  onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = 'transparent' }}
                >{o.label}</div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function endTime(start: string, dur: number) {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + dur
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function capacityColor(enrolled: number, max: number) {
  if (enrolled >= max)        return '#f87171'
  if (enrolled >= max * 0.75) return '#fbbf24'
  return '#4ade80'
}

const CLIENT_TZ = 'Australia/Sydney'

function todayStr(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLIENT_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`
}

function normalizeDate(d: string | Date): string {
  if (typeof d !== 'string') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  return d.slice(0, 10)
}

function isToday(d: string | Date): boolean {
  return normalizeDate(d) === todayStr()
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (s: Session) => void }) {
  const [form, setForm] = useState({
    name: '', day_of_week: 1, start_time: '10:00',
    duration_minutes: 60, max_capacity: 8, session_type: '', resource_id: '', recurring: true,
    price_per_session: 0,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const set = (k: string, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.name.trim() || !form.session_type.trim() || saving) return
    setSaving(true); setErr(null)
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, resource_id: form.resource_id.trim() || undefined }),
    })
    setSaving(false)
    if (res.ok) { const d = await res.json() as { session: Session }; onCreate(d.session); onClose() }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed') }
  }

  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'rgba(255,255,255,.35)', marginBottom: 5,
  }

  return (
    <>
      <style>{`@keyframes cm-fade{from{opacity:0}to{opacity:1}}@keyframes cm-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.70)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cm-fade .15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: '#111215', border: '1px solid rgba(255,255,255,.10)', borderRadius: 16, padding: '26px 28px', width: '100%', maxWidth: 460, fontFamily: FONT, animation: 'cm-in .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F5F7FA' }}>New Session</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div><label style={lbl}>Session Name</label><input style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Hot Shots Red Ball" /></div>
            <div>
              <label style={lbl}>Type</label>
              <CustomSelect value={form.session_type} onChange={v => set('session_type', v)} placeholder="Select session type" groups={SESSION_TYPE_GROUPS} />
            </div>
            <div>
              <label style={lbl}>Day</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DAYS_ORDER.map(d => (
                  <button key={d} onClick={() => set('day_of_week', d)} style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                    background: form.day_of_week === d ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${form.day_of_week === d ? 'rgba(99,102,241,.45)' : 'rgba(255,255,255,.10)'}`,
                    color: form.day_of_week === d ? '#a5b4fc' : 'rgba(255,255,255,.40)', fontFamily: FONT,
                  }}>{DAY_LABEL[d]}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div><label style={lbl}>Start Time</label><input style={{ ...inp, colorScheme: 'dark' }} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></div>
              <div><label style={lbl}>Duration (min)</label><input style={inp} type="number" min={15} max={480} value={form.duration_minutes} onChange={e => set('duration_minutes', parseInt(e.target.value) || 60)} /></div>
              <div><label style={lbl}>Max Capacity</label><input style={inp} type="number" min={1} max={100} value={form.max_capacity} onChange={e => set('max_capacity', parseInt(e.target.value) || 8)} /></div>
              <div><label style={lbl}>Price ($)</label><input style={inp} type="number" min={0} step={0.5} value={form.price_per_session} onChange={e => set('price_per_session', parseFloat(e.target.value) || 0)} /></div>
            </div>
            <div>
              <label style={lbl}>Location</label>
              <CustomSelect value={form.resource_id} onChange={v => set('resource_id', v)} placeholder="— Select location —" options={LOCATION_OPTIONS} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.recurring} onChange={e => set('recurring', e.target.checked)} style={{ width: 16, height: 16, accentColor: '#6366f1' }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>Recurring weekly</span>
            </label>
          </div>
          {err && <p style={{ margin: '12px 0 0', fontSize: 12, color: '#f87171' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.40)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submit} disabled={!form.name.trim() || !form.session_type.trim() || saving}
              style={{ flex: 2, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: !form.name.trim() || !form.session_type.trim() || saving ? .45 : 1 }}>
              {saving ? 'Creating…' : 'Create Session'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ session, onClose, onSave }: { session: Session; onClose: () => void; onSave: (s: Session) => void }) {
  const [form, setForm] = useState({
    name: session.name, day_of_week: session.day_of_week, start_time: session.start_time,
    duration_minutes: session.duration_minutes, max_capacity: session.max_capacity,
    session_type: session.session_type, resource_id: session.resource_id ?? '', recurring: session.recurring,
    price_per_session: session.price_per_session ?? 0,
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)

  const set = (k: string, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.name.trim() || !form.session_type.trim() || saving) return
    setSaving(true); setErr(null)
    const res = await fetch(`${API}/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, resource_id: form.resource_id.trim() || null }),
    })
    setSaving(false)
    if (res.ok) { const d = await res.json() as { session: Session }; onSave({ ...d.session, enrolled_count: session.enrolled_count }); onClose() }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed') }
  }

  const lbl: React.CSSProperties = {
    display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'rgba(255,255,255,.35)', marginBottom: 5,
  }

  return (
    <>
      <style>{`@keyframes cm-fade{from{opacity:0}to{opacity:1}}@keyframes cm-in{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:scale(1)}}`}</style>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.70)', backdropFilter: 'blur(4px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', animation: 'cm-fade .15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: '#111215', border: '1px solid rgba(255,255,255,.10)', borderRadius: 16, padding: '26px 28px', width: '100%', maxWidth: 460, fontFamily: FONT, animation: 'cm-in .18s ease' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#F5F7FA' }}>Edit Session</div>
            <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,.35)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div><label style={lbl}>Session Name</label><input style={inp} value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div>
              <label style={lbl}>Type</label>
              <CustomSelect value={form.session_type} onChange={v => set('session_type', v)} placeholder="Select session type" groups={SESSION_TYPE_GROUPS} />
            </div>
            <div>
              <label style={lbl}>Day</label>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {DAYS_ORDER.map(d => (
                  <button key={d} onClick={() => set('day_of_week', d)} style={{
                    fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
                    background: form.day_of_week === d ? 'rgba(99,102,241,.25)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${form.day_of_week === d ? 'rgba(99,102,241,.45)' : 'rgba(255,255,255,.10)'}`,
                    color: form.day_of_week === d ? '#a5b4fc' : 'rgba(255,255,255,.40)', fontFamily: FONT,
                  }}>{DAY_LABEL[d]}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
              <div><label style={lbl}>Start Time</label><input style={{ ...inp, colorScheme: 'dark' }} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></div>
              <div><label style={lbl}>Duration (min)</label><input style={inp} type="number" min={15} max={480} value={form.duration_minutes} onChange={e => set('duration_minutes', parseInt(e.target.value) || 60)} /></div>
              <div><label style={lbl}>Max Capacity</label><input style={inp} type="number" min={1} max={100} value={form.max_capacity} onChange={e => set('max_capacity', parseInt(e.target.value) || 8)} /></div>
              <div><label style={lbl}>Price ($)</label><input style={inp} type="number" min={0} step={0.5} value={form.price_per_session} onChange={e => set('price_per_session', parseFloat(e.target.value) || 0)} /></div>
            </div>
            <div>
              <label style={lbl}>Location</label>
              <CustomSelect value={form.resource_id} onChange={v => set('resource_id', v)} placeholder="— Select location —" options={LOCATION_OPTIONS} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.recurring} onChange={e => set('recurring', e.target.checked)} style={{ width: 16, height: 16, accentColor: '#6366f1' }} />
              <span style={{ fontSize: 13, color: 'rgba(255,255,255,.55)' }}>Recurring weekly</span>
            </label>
          </div>
          {err && <p style={{ margin: '12px 0 0', fontSize: 12, color: '#f87171' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.40)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submit} disabled={!form.name.trim() || !form.session_type.trim() || saving}
              style={{ flex: 2, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: !form.name.trim() || !form.session_type.trim() || saving ? .45 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Session Card ─────────────────────────────────────────────────────────────

function SessionCard({ session, selected, onClick, sessionContacts }: {
  session: Session; selected: boolean; onClick: () => void; sessionContacts: ContactBrief[]
}) {
  const full   = session.enrolled_count >= session.max_capacity
  const capClr = capacityColor(session.enrolled_count, session.max_capacity)
  const end    = endTime(session.start_time, session.duration_minutes)
  return (
    <div onClick={onClick} style={{
      background: selected ? 'rgba(99,102,241,.14)' : 'rgba(255,255,255,.04)',
      border: `1px solid ${selected ? 'rgba(99,102,241,.35)' : full ? 'rgba(239,68,68,.25)' : 'rgba(255,255,255,.09)'}`,
      borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#F5F7FA', marginBottom: 2 }}>{session.name}</div>
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 6 }}>
        {session.start_time}–{end}
      </div>
      {session.session_type && <div style={{ marginBottom: 6 }}><span style={sessionChip(session.session_type)}>{sessionLabel(session.session_type)}</span></div>}
      {session.resource_id && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', marginBottom: 6 }}>📍 {session.resource_id}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: sessionContacts.length > 0 ? 7 : 0 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: capClr }}>{session.enrolled_count}/{session.max_capacity}</span>
        {full && <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.28)', borderRadius: 20, padding: '1px 7px' }}>Full</span>}
      </div>
      {sessionContacts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, borderTop: '1px solid rgba(255,255,255,.06)', paddingTop: 6 }}>
          {sessionContacts.map(c => (
            <div key={c.id} style={{ fontSize: 10, color: 'rgba(255,255,255,.55)', background: 'rgba(255,255,255,.05)', borderRadius: 4, padding: '2px 6px' }}>
              {c.name}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Week View ────────────────────────────────────────────────────────────────

function WeekView({ instances, onSelectInstance }: {
  instances: WeekInstance[]
  onSelectInstance: (sessionId: string, instanceId: string) => void
}) {
  if (instances.length === 0) return (
    <div style={{ marginBottom: 28, padding: '18px 20px', background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 12, fontSize: 13, color: 'rgba(255,255,255,.22)' }}>
      No sessions in the next 2 weeks. Create a session below to get started.
    </div>
  )

  const today   = instances.filter(i => isToday(i.date))
  const upcoming = instances.filter(i => !isToday(i.date))

  function Row({ inst }: { inst: WeekInstance }) {
    const end    = endTime(inst.start_time, inst.duration_minutes)
    const capClr = capacityColor(inst.enrolled_count, inst.max_capacity)
    const full   = inst.enrolled_count >= inst.max_capacity
    const pct    = Math.min(1, inst.enrolled_count / inst.max_capacity)
    return (
      <div onClick={() => onSelectInstance(inst.session_id, inst.id)}
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', borderRadius: 10, cursor: 'pointer', background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.07)' }}
        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,.06)')}
        onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255,255,255,.03)')}
      >
        <div style={{ minWidth: 72, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.40)' }}>{formatDateAU(inst.date)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', marginBottom: 1 }}>{inst.session_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
              {inst.start_time}–{end}{inst.resource_id && ` · ${inst.resource_id}`}
              {inst.session_type && <span style={sessionChip(inst.session_type)}>{sessionLabel(inst.session_type)}</span>}
            </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, minWidth: 80 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: capClr }}>{inst.enrolled_count}/{inst.max_capacity}</span>
          <div style={{ width: 60, height: 4, background: 'rgba(255,255,255,.08)', borderRadius: 4, overflow: 'hidden' }}>
            <div style={{ width: `${pct * 100}%`, height: '100%', background: capClr, borderRadius: 4 }} />
          </div>
        </div>
        {full && <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.28)', borderRadius: 20, padding: '2px 8px' }}>Full</span>}
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 32 }}>
      {today.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Today</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{today.map(i => <Row key={i.id} inst={i} />)}</div>
        </div>
      )}
      {upcoming.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 8 }}>Upcoming (2 weeks)</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>{upcoming.map(i => <Row key={i.id} inst={i} />)}</div>
        </div>
      )}
    </div>
  )
}

// ─── Instances Panel ──────────────────────────────────────────────────────────

function InstancesPanel({ session, instances, selectedInstanceId, instancesLoading, onSelectInstance, onGenerate, generating, onEdit, onDelete }: {
  session: Session; instances: SessionInstance[]; selectedInstanceId: string | null
  instancesLoading: boolean; onSelectInstance: (id: string) => void
  onGenerate: () => void; generating: boolean
  onEdit: () => void; onDelete: () => void
}) {
  const end = endTime(session.start_time, session.duration_minutes)
  const [confirmDel, setConfirmDel] = useState(false)
  return (
    <div style={{ marginTop: 24, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA' }}>{session.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {DAY_FULL[session.day_of_week]} · {session.start_time}–{end}
            {session.resource_id && ` · ${session.resource_id}`}
            {session.session_type && <span style={sessionChip(session.session_type)}>{sessionLabel(session.session_type)}</span>}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
          <button onClick={onGenerate} disabled={generating} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20, cursor: generating ? 'not-allowed' : 'pointer',
            background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)',
            color: '#a5b4fc', fontFamily: FONT, opacity: generating ? .5 : 1,
          }}>{generating ? 'Generating…' : '↻ Generate 6 weeks'}</button>
          <button onClick={onEdit} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
            background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)',
            color: 'rgba(255,255,255,.50)', fontFamily: FONT,
          }}>Edit</button>
          {confirmDel ? (
            <>
              <button onClick={onDelete} style={{
                fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20, cursor: 'pointer',
                background: 'rgba(239,68,68,.22)', border: '1px solid rgba(239,68,68,.50)',
                color: '#f87171', fontFamily: FONT,
              }}>Confirm delete</button>
              <button onClick={() => setConfirmDel(false)} style={{
                fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 20, cursor: 'pointer',
                background: 'none', border: '1px solid rgba(255,255,255,.12)',
                color: 'rgba(255,255,255,.35)', fontFamily: FONT,
              }}>Cancel</button>
            </>
          ) : (
            <button onClick={() => setConfirmDel(true)} style={{
              fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
              background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
              color: '#f87171', fontFamily: FONT,
            }}>Delete</button>
          )}
        </div>
      </div>
      {instancesLoading ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading dates…</div>
      ) : instances.length === 0 ? (
        <div style={{ padding: '32px 20px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
          No dates yet. <button onClick={onGenerate} style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0 }}>Generate →</button>
        </div>
      ) : (
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {instances.map(inst => {
            const capClr = capacityColor(inst.enrolled_count, inst.max_capacity)
            const full   = inst.enrolled_count >= inst.max_capacity
            const pct    = Math.min(1, inst.enrolled_count / inst.max_capacity)
            const today_ = isToday(inst.date)
            const sel    = selectedInstanceId === inst.id
            return (
              <div key={inst.id} onClick={() => onSelectInstance(inst.id)} style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                background: sel ? 'rgba(99,102,241,.12)' : today_ ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${sel ? 'rgba(99,102,241,.35)' : today_ ? 'rgba(255,255,255,.14)' : 'rgba(255,255,255,.07)'}`,
              }}>
                <div style={{ minWidth: 90, fontSize: 12, fontWeight: today_ ? 700 : 500, color: today_ ? '#F5F7FA' : 'rgba(255,255,255,.45)' }}>
                  {formatDateAU(inst.date)}
                  {today_ && <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.35)', borderRadius: 20, padding: '1px 6px' }}>Today</span>}
                </div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ width: 80, height: 5, background: 'rgba(255,255,255,.08)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${pct * 100}%`, height: '100%', background: capClr, borderRadius: 4 }} />
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: capClr }}>{inst.enrolled_count}/{inst.max_capacity}</span>
                  {full && <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.28)', borderRadius: 20, padding: '1px 7px' }}>Full</span>}
                </div>
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,.25)' }}>View roster →</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Instance Roster ──────────────────────────────────────────────────────────

type Contact = { id: string; name: string; email: string | null; phone: string | null }

function InstanceRoster({ detail, onBookingUpdate, onEnroll, onRemove, onRemoveFuture }: {
  detail: InstanceDetail
  onBookingUpdate: (id: string, patch: Partial<InstanceBooking>) => void
  onEnroll: (booking: InstanceBooking) => void
  onRemove: (bookingId: string) => void
  onRemoveFuture: (bookingId: string) => void
}) {
  const { instance, bookings } = detail
  if (!instance) return null
  const end  = endTime(instance.start_time, instance.duration_minutes)
  const paid = bookings.filter(b => b.paid).length
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollForm, setEnrollForm] = useState({ name: '', email: '' })
  const [enrolling, setEnrolling]   = useState(false)
  const [enrollErr, setEnrollErr]   = useState<string | null>(null)
  const [contacts, setContacts]     = useState<Contact[]>([])
  const [nameQuery, setNameQuery]   = useState('')
  const [showDrop, setShowDrop]     = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)

  useEffect(() => {
    if (!showEnroll) return
    fetch('/api/contacts').then(r => r.json()).then(d => setContacts(d.contacts ?? [])).catch(() => null)
  }, [showEnroll])

  const filtered = nameQuery.trim().length > 0
    ? contacts.filter(c => c.name.toLowerCase().includes(nameQuery.toLowerCase()) || (c.email ?? '').toLowerCase().includes(nameQuery.toLowerCase())).slice(0, 8)
    : []

  function selectContact(c: Contact) {
    setEnrollForm({ name: c.name, email: c.email ?? '' })
    setNameQuery(c.name)
    setShowDrop(false)
  }

  async function submitEnroll() {
    if (!enrollForm.name.trim() || enrolling) return
    setEnrolling(true); setEnrollErr(null)
    const res = await fetch(`${API}/${instance.session_id}/instances/${instance.id}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_name: enrollForm.name, client_email: enrollForm.email || undefined }),
    })
    setEnrolling(false)
    if (res.ok) {
      const d = await res.json() as { booking: InstanceBooking }
      onEnroll(d.booking)
      setEnrollForm({ name: '', email: '' }); setNameQuery(''); setShowEnroll(false)
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setEnrollErr(d.error ?? 'Failed to enroll')
    }
  }

  async function togglePaid(b: InstanceBooking) {
    const res = await fetch(`/api/bookings/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paid: !b.paid }) })
    if (res.ok) onBookingUpdate(b.id, { paid: !b.paid })
  }

  async function cycleAttendance(b: InstanceBooking) {
    const next = ATTENDANCE_CYCLE[b.attendance_status ?? 'null']
    const val  = next === 'null' ? null : next
    const res  = await fetch(`/api/bookings/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ attendance_status: val }) })
    if (res.ok) onBookingUpdate(b.id, { attendance_status: val })
  }

  async function removeBooking(b: InstanceBooking) {
    const res = await fetch(`/api/dashboard/enrolments/${b.id}`, { method: 'DELETE' })
    if (res.ok) onRemove(b.id)
  }

  async function removeFuture(b: InstanceBooking) {
    const res = await fetch('/api/dashboard/enrolments/remove-future', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: b.client_name,
        client_email: b.client_email,
        session_id: instance.session_id,
        from_date: instance.date,
      }),
    })
    if (res.ok) onRemoveFuture(b.id)
  }

  async function toggleRecurring(b: InstanceBooking) {
    const next = !b.is_recurring
    const res  = await fetch(`/api/dashboard/enrolments/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_recurring: next }) })
    if (res.ok) onBookingUpdate(b.id, { is_recurring: next })
  }

  const capClr = capacityColor(bookings.length, instance.max_capacity)

  return (
    <div style={{ marginTop: 12, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA' }}>{formatDateAU(instance.date)} · {instance.start_time}–{end}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: capClr }}>{bookings.length}/{instance.max_capacity} enrolled</span>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,.40)' }}>{paid}/{bookings.length} paid</span>
          <button onClick={() => { setShowEnroll(v => !v); setEnrollErr(null) }} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
            background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.38)',
            color: '#a5b4fc', fontFamily: FONT,
          }}>+ Enroll</button>
        </div>
      </div>

      {showEnroll && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Search Contact *</div>
            <input
              style={inp}
              placeholder="Type a name to search…"
              value={nameQuery}
              autoComplete="off"
              onChange={e => { setNameQuery(e.target.value); setEnrollForm(f => ({ ...f, name: e.target.value })); setShowDrop(true) }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
            />
            {showDrop && filtered.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: '#16181d', border: '1px solid rgba(255,255,255,.12)', borderRadius: 8, marginTop: 2, overflow: 'hidden' }}>
                {filtered.map(c => (
                  <div key={c.id} onMouseDown={() => selectContact(c)} style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: '#F5F7FA', display: 'flex', flexDirection: 'column', gap: 2 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(99,102,241,.15)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    {c.email && <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>{c.email}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Email (optional)</div>
            <input style={inp} placeholder="client@email.com" type="email" value={enrollForm.email} onChange={e => setEnrollForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setShowEnroll(false); setEnrollErr(null); setNameQuery('') }} style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.35)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submitEnroll} disabled={!enrollForm.name.trim() || enrolling} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: 'rgba(99,102,241,.22)', border: '1px solid rgba(99,102,241,.40)', color: '#a5b4fc', fontFamily: FONT, opacity: !enrollForm.name.trim() || enrolling ? .45 : 1 }}>{enrolling ? 'Enrolling…' : 'Confirm'}</button>
          </div>
          {enrollErr && <div style={{ width: '100%', fontSize: 12, color: '#f87171' }}>{enrollErr}</div>}
        </div>
      )}

      {bookings.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13 }}>No clients booked yet. Use + Enroll to add one.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,.05)' }}>
              {['Client', 'Email', 'Payment', 'Attendance', 'Recurring', ''].map(h => (
                <th key={h} style={{ padding: '10px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: i < bookings.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', display: 'flex', alignItems: 'center', gap: 7 }}>
                    {b.client_name}
                    {b.is_recurring && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: '#818cf8', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.28)', borderRadius: 20, padding: '1px 6px' }}>Recurring</span>
                    )}
                  </div>
                  {b.is_recurring && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>Applies to future sessions</div>
                  )}
                </td>
                <td style={{ padding: '12px 20px', fontSize: 12, color: 'rgba(255,255,255,.40)' }}>{b.client_email ?? '—'}</td>
                <td style={{ padding: '12px 20px' }}>
                  <button onClick={() => togglePaid(b)} style={{
                    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                    background: b.paid ? 'rgba(34,197,94,.12)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${b.paid ? 'rgba(34,197,94,.35)' : 'rgba(255,255,255,.12)'}`,
                    color: b.paid ? '#4ade80' : 'rgba(255,255,255,.35)',
                  }}>{b.paid ? '✓ Paid' : 'Unpaid'}</button>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  {b.attendance_status ? (
                    <button onClick={() => cycleAttendance(b)} style={{
                      fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                      background: ATTENDANCE_STYLE[b.attendance_status].bg,
                      border: `1px solid ${ATTENDANCE_STYLE[b.attendance_status].border}`,
                      color: ATTENDANCE_STYLE[b.attendance_status].color,
                    }}>{ATTENDANCE_STYLE[b.attendance_status].label}</button>
                  ) : (
                    <button onClick={() => cycleAttendance(b)} style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                      background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'rgba(255,255,255,.28)',
                    }}>Mark</button>
                  )}
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <button onClick={() => toggleRecurring(b)} style={{
                    fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                    background: b.is_recurring ? 'rgba(99,102,241,.18)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${b.is_recurring ? 'rgba(99,102,241,.40)' : 'rgba(255,255,255,.09)'}`,
                    color: b.is_recurring ? '#a5b4fc' : 'rgba(255,255,255,.28)',
                  }}>{b.is_recurring ? '↻ Weekly' : 'Once'}</button>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  {removingId === b.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { removeBooking(b); setRemovingId(null) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'rgba(239,68,68,.14)', border: '1px solid rgba(239,68,68,.35)', color: '#f87171' }}
                      >This session</button>
                      <button
                        onClick={() => { removeFuture(b); setRemovingId(null) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.22)', color: '#fca5a5' }}
                      >All future</button>
                      <button
                        onClick={() => setRemovingId(null)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'none', border: '1px solid rgba(255,255,255,.10)', color: 'rgba(255,255,255,.30)' }}
                      >✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setRemovingId(b.id)} style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                      background: 'rgba(239,68,68,.07)', border: '1px solid rgba(239,68,68,.20)', color: '#f87171',
                    }}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SessionsPage() {
  const [sessions, setSessions]                     = useState<Session[]>([])
  const [loading, setLoading]                       = useState(true)
  const [contacts, setContacts]                     = useState<ContactBrief[]>([])
  const [showCreate, setShowCreate]                 = useState(false)
  const [editingSession, setEditingSession]         = useState<Session | null>(null)
  const [selectedSessionId, setSelectedSessionId]   = useState<string | null>(null)
  const [instances, setInstances]                   = useState<SessionInstance[]>([])
  const [instancesLoading, setInstancesLoading]     = useState(false)
  const [generating, setGenerating]                 = useState(false)
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null)
  const [instanceDetail, setInstanceDetail]         = useState<InstanceDetail | null>(null)
  const [rosterLoading, setRosterLoading]           = useState(false)
  const [weekInstances, setWeekInstances]           = useState<WeekInstance[]>([])
  const [weekLoading, setWeekLoading]               = useState(true)
  const [confirmDel, setConfirmDel]                 = useState(false)
  const [deleteErr, setDeleteErr]                   = useState<string | null>(null)

  useEffect(() => {
    const today = todayStr()

    Promise.all([
      fetch(API).then(r => r.json()),
      fetch(`${API}/instances`).then(r => r.json()),
    ]).then(([sessData, instData]) => {
      const loadedSessions: Session[] = sessData.sessions ?? []
      const loadedInstances: WeekInstance[] = instData.instances ?? []
      setSessions(loadedSessions)
      setWeekInstances(loadedInstances)
      setLoading(false)
      setWeekLoading(false)

      // Detect sessions whose future instances are on the wrong weekday and fix them all
      const sessionDayMap = new Map(loadedSessions.map(s => [s.id, s.day_of_week]))
      const badIds = new Set<string>()
      for (const inst of loadedInstances) {
        const dateStr = normalizeDate(inst.date as string | Date)
        if (dateStr < today) continue
        const expected = sessionDayMap.get(inst.session_id)
        if (expected == null) continue
        if (parseLocalDate(dateStr).getDay() !== expected) badIds.add(inst.session_id)
      }
      if (badIds.size > 0) {
        Promise.all([...badIds].map(id =>
          fetch(`${API}/${id}/generate-instances`, { method: 'POST' }).catch(() => null)
        )).then(() =>
          fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
        ).catch(() => null)
      }
    }).catch(() => { setLoading(false); setWeekLoading(false) })

    fetch('/api/contacts').then(r => r.json()).then(d => setContacts(d.contacts ?? [])).catch(() => null)
  }, [])

  const loadInstances = useCallback(async (sessionId: string) => {
    setInstancesLoading(true); setSelectedInstanceId(null); setInstanceDetail(null)
    const res = await fetch(`${API}/${sessionId}`).catch(() => null)
    setInstancesLoading(false)
    if (!res?.ok) return
    const d = await res.json() as { session: { day_of_week: number } | null; instances: SessionInstance[] }
    const loaded = d.instances ?? []
    setInstances(loaded)

    // Auto-fix: if future instances are on the wrong weekday, silently regenerate
    if (d.session) {
      const today = todayStr()
      const future = loaded.filter(i => normalizeDate(i.date as string | Date) >= today)
      const mismatch = future.some(i => parseLocalDate(normalizeDate(i.date as string | Date)).getDay() !== d.session!.day_of_week)
      if (mismatch) {
        fetch(`${API}/${sessionId}/generate-instances`, { method: 'POST' })
          .then(r => r.ok ? r.json() : null)
          .then(rd => {
            if (rd?.instances) setInstances(rd.instances)
            fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
          })
          .catch(() => null)
      }
    }
  }, [])

  async function selectSession(id: string) {
    if (selectedSessionId === id) { setSelectedSessionId(null); setInstances([]); setSelectedInstanceId(null); setInstanceDetail(null); setConfirmDel(false); setDeleteErr(null); return }
    setSelectedSessionId(id); setConfirmDel(false); setDeleteErr(null); await loadInstances(id)
  }

  async function selectInstance(sessionId: string, instanceId: string) {
    if (sessionId !== selectedSessionId) { setSelectedSessionId(sessionId); await loadInstances(sessionId) }
    loadRoster(sessionId, instanceId)
  }

  function loadRoster(sessionId: string, instanceId: string) {
    setSelectedInstanceId(instanceId); setRosterLoading(true); setInstanceDetail(null)
    fetch(`${API}/${sessionId}/instances/${instanceId}`)
      .then(r => r.json())
      .then(d => { setInstanceDetail(d as InstanceDetail); setRosterLoading(false) })
      .catch(() => setRosterLoading(false))
  }

  async function generateInstances() {
    if (!selectedSessionId || generating) return
    setGenerating(true)
    const res = await fetch(`${API}/${selectedSessionId}/generate-instances`, { method: 'POST' })
    setGenerating(false)
    if (res.ok) {
      const d = await res.json() as { instances: SessionInstance[] }
      setInstances(d.instances ?? [])
      fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
    }
  }

  function handleBookingUpdate(bookingId: string, patch: Partial<InstanceBooking>) {
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.map(b => b.id === bookingId ? { ...b, ...patch } : b) } : d)
  }

  function handleRemove(bookingId: string) {
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.filter(b => b.id !== bookingId) } : d)
    setSessions(prev => prev.map(s => s.id === selectedSessionId ? { ...s, enrolled_count: Math.max(0, s.enrolled_count - 1) } : s))
    setInstances(prev => prev.map(i => i.id === selectedInstanceId ? { ...i, enrolled_count: Math.max(0, i.enrolled_count - 1) } : i))
  }

  function handleRemoveFuture(bookingId: string) {
    // Clear recurring flag on the current booking — it stays, just won't propagate
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.map(b => b.id === bookingId ? { ...b, is_recurring: false } : b) } : d)
    // Refresh week view and instance list so future enrolled counts update
    fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
    if (selectedSessionId) loadInstances(selectedSessionId)
  }

  function handleCreate(s: Session) {
    setSessions(prev => [...prev, s].sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    setTimeout(() => { fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null) }, 1500)
  }

  function handleSave(updated: Session) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s).sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
  }

  async function handleDelete(id: string) {
    setDeleteErr(null)
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      setSelectedSessionId(null); setInstances([]); setSelectedInstanceId(null); setInstanceDetail(null)
      setConfirmDel(false)
      fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
    } else {
      const errData = await res.json().catch(() => ({})) as { error?: string }
      setDeleteErr(errData.error ?? 'Failed to delete session')
      setConfirmDel(false)
    }
  }

  const selectedSession        = sessions.find(s => s.id === selectedSessionId) ?? null
  const weeklyRevenue          = sessions.reduce((sum, s) => sum + sessionRevenue(s.price_per_session ?? 0, s.session_type, s.enrolled_count), 0)
  const selRevenue             = selectedSession ? sessionRevenue(selectedSession.price_per_session ?? 0, selectedSession.session_type, selectedSession.enrolled_count) : 0
  const selCapClr              = selectedSession ? capacityColor(selectedSession.enrolled_count, selectedSession.max_capacity) : '#4ade80'
  const selUtilisation         = selectedSession && selectedSession.max_capacity > 0 ? Math.round(selectedSession.enrolled_count / selectedSession.max_capacity * 100) : 0
  const instancesTotalRevenue  = instances.reduce((sum, i) => sum + (i.revenue ?? 0), 0)
  const paidCount              = instanceDetail ? instanceDetail.bookings.filter(b => b.paid).length : null

  const lbl10: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', marginBottom: 4,
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px', fontFamily: FONT }}>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {editingSession && <EditModal session={editingSession} onClose={() => setEditingSession(null)} onSave={handleSave} />}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>Sessions</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', margin: '4px 0 0' }}>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''} · click a card to view details
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 20, cursor: 'pointer',
          background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.40)',
          color: '#a5b4fc', fontFamily: FONT, flexShrink: 0,
        }}>+ New Session</button>
      </div>

      {/* ── Weekly revenue bar ───────────────────────────────────────────── */}
      {!loading && weeklyRevenue > 0 && (
        <div style={{
          marginBottom: 20, padding: '12px 18px', borderRadius: 10,
          background: 'rgba(99,102,241,.07)', border: '1px solid rgba(99,102,241,.16)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(167,139,250,.55)' }}>
            Weekly Revenue
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em' }}>
            {fmtMoney(weeklyRevenue)}
          </div>
        </div>
      )}

      {/* ── Weekly schedule grid ─────────────────────────────────────────── */}
      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 14 }}>Weekly Schedule</div>

      {loading ? (
        <div style={{ color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
          {DAYS_ORDER.map(day => {
            const daySessions = sessions.filter(s => s.day_of_week === day)
            return (
              <div key={day}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', textAlign: 'center', marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,.06)' }}>
                  {DAY_LABEL[day]}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {daySessions.length === 0
                    ? <div style={{ height: 52, border: '1px dashed rgba(255,255,255,.06)', borderRadius: 10 }} />
                    : daySessions.map(s => <SessionCard key={s.id} session={s} selected={selectedSessionId === s.id} onClick={() => selectSession(s.id)} sessionContacts={contacts.filter(c => c.session_id === s.id)} />)
                  }
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && sessions.length === 0 && (
        <div style={{ marginTop: 20, border: '1px dashed rgba(255,255,255,.08)', borderRadius: 14, padding: '48px 24px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13 }}>
          No sessions yet.{' '}
          <button onClick={() => setShowCreate(true)} style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0 }}>
            Create your first session →
          </button>
        </div>
      )}

      {selectedSessionId && selectedSession && (
        <div style={{ marginTop: 32, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 16, overflow: 'hidden' }}>

          {/* Session header + actions */}
          <div style={{ padding: '16px 22px', borderBottom: '1px solid rgba(255,255,255,.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#F5F7FA', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {selectedSession.name}
                {selectedSession.session_type && <span style={sessionChip(selectedSession.session_type)}>{sessionLabel(selectedSession.session_type)}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {DAY_FULL[selectedSession.day_of_week]} · {selectedSession.start_time}–{endTime(selectedSession.start_time, selectedSession.duration_minutes)}
                {selectedSession.resource_id && <><span>·</span><span>📍 {selectedSession.resource_id}</span></>}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={generateInstances} disabled={generating} style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20, cursor: generating ? 'not-allowed' : 'pointer', background: 'rgba(99,102,241,.15)', border: '1px solid rgba(99,102,241,.35)', color: '#a5b4fc', fontFamily: FONT, opacity: generating ? .5 : 1 }}>{generating ? 'Generating…' : '↻ Generate 6 weeks'}</button>
              <button onClick={() => setEditingSession(selectedSession)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.50)', fontFamily: FONT }}>Edit</button>
              {confirmDel ? (
                <>
                  <button onClick={() => handleDelete(selectedSession.id)} style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', background: 'rgba(239,68,68,.22)', border: '1px solid rgba(239,68,68,.50)', color: '#f87171', fontFamily: FONT }}>Confirm delete</button>
                  <button onClick={() => setConfirmDel(false)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 20, cursor: 'pointer', background: 'none', border: '1px solid rgba(255,255,255,.12)', color: 'rgba(255,255,255,.35)', fontFamily: FONT }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDel(true)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)', color: '#f87171', fontFamily: FONT }}>Delete</button>
              )}
            </div>
          </div>
          {deleteErr && <div style={{ padding: '8px 22px', fontSize: 12, color: '#f87171', background: 'rgba(239,68,68,.07)', borderBottom: '1px solid rgba(239,68,68,.15)' }}>{deleteErr}</div>}

          {/* Stats: players · fill rate · revenue · instances total · paid */}
          <div style={{ padding: '14px 22px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={lbl10}>Players</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: selCapClr, letterSpacing: '-.02em' }}>
                {selectedSession.enrolled_count}
                <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.28)' }}>/{selectedSession.max_capacity}</span>
              </div>
            </div>
            <div>
              <div style={lbl10}>Fill Rate</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: selCapClr, letterSpacing: '-.02em' }}>{selUtilisation}%</div>
            </div>
            {selRevenue > 0 && (
              <div>
                <div style={lbl10}>Per Session</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em' }}>{fmtMoney(selRevenue)}</div>
              </div>
            )}
            {instancesTotalRevenue > 0 && (
              <div>
                <div style={lbl10}>6-Week Revenue</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', letterSpacing: '-.02em' }}>{fmtMoney(instancesTotalRevenue)}</div>
              </div>
            )}
            {paidCount !== null && instanceDetail && (
              <div>
                <div style={lbl10}>Paid (this date)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', letterSpacing: '-.02em' }}>
                  {paidCount}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'rgba(255,255,255,.28)' }}>/{instanceDetail.bookings.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* Upcoming date chips */}
          {instancesLoading ? (
            <div style={{ padding: '24px 22px', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading dates…</div>
          ) : instances.length === 0 ? (
            <div style={{ padding: '28px 22px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>
              No dates yet.{' '}
              <button onClick={generateInstances} style={{ background: 'none', border: 'none', color: '#a5b4fc', cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0 }}>Generate →</button>
            </div>
          ) : (
            <div style={{ padding: '12px 22px', borderBottom: '1px solid rgba(255,255,255,.06)' }}>
              <div style={lbl10}>Upcoming Dates</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {instances.map(inst => {
                  const sel    = selectedInstanceId === inst.id
                  const today_ = isToday(inst.date)
                  const capC   = capacityColor(inst.enrolled_count, inst.max_capacity)
                  return (
                    <button key={inst.id} onClick={() => loadRoster(selectedSessionId, inst.id)}
                      style={{
                        padding: '6px 13px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: sel ? 'rgba(99,102,241,.22)' : today_ ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.04)',
                        border: `1px solid ${sel ? 'rgba(99,102,241,.48)' : today_ ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,.09)'}`,
                        color: sel ? '#a5b4fc' : today_ ? '#F5F7FA' : 'rgba(255,255,255,.55)',
                      }}>
                      <span style={{ fontSize: 12, fontWeight: today_ ? 700 : 500 }}>{formatDateAU(inst.date)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sel ? '#a5b4fc' : capC }}>{inst.enrolled_count}/{inst.max_capacity}</span>
                      {inst.revenue > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: '#4ade80' }}>${inst.revenue}</span>}
                      {today_ && <span style={{ fontSize: 9, fontWeight: 700, color: '#a5b4fc', background: 'rgba(99,102,241,.18)', border: '1px solid rgba(99,102,241,.32)', borderRadius: 20, padding: '1px 5px' }}>Today</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Roster — stacked below dates */}
          {!selectedInstanceId && !instancesLoading && instances.length > 0 ? (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 13 }}>
              ↑ Select a date above to view the roster
            </div>
          ) : rosterLoading ? (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading roster…</div>
          ) : instanceDetail ? (
            <InstanceRoster
              detail={instanceDetail}
              onBookingUpdate={handleBookingUpdate}
              onRemove={handleRemove}
              onRemoveFuture={handleRemoveFuture}
              onEnroll={b => {
                setInstanceDetail(d => d ? { ...d, bookings: [...d.bookings, b] } : d)
                setSessions(prev => prev.map(s => s.id === selectedSessionId ? { ...s, enrolled_count: s.enrolled_count + 1 } : s))
                setInstances(prev => prev.map(i => i.id === selectedInstanceId ? { ...i, enrolled_count: i.enrolled_count + 1 } : i))
              }}
            />
          ) : null}

        </div>
      )}
    </div>
  )
}
