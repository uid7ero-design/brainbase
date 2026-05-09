'use client'

import { useEffect, useState, useCallback } from 'react'

const FONT = "var(--font-inter),-apple-system,sans-serif"
const API  = '/api/dashboard/sessions'

type Session = {
  id: string; name: string; day_of_week: number; start_time: string
  duration_minutes: number; max_capacity: number; session_type: string
  resource_id: string | null; recurring: boolean; created_at: string
  enrolled_count: number
}

type SessionInstance = {
  id: string; session_id: string; date: string; start_time: string
  duration_minutes: number; max_capacity: number; status: string
  created_at: string; enrolled_count: number
}

type WeekInstance = SessionInstance & { session_name: string; session_type: string; resource_id: string | null }

type InstanceBooking = {
  id: string; client_name: string; client_email: string | null
  paid: boolean; attendance_status: string | null; status: string
  pipeline_id: string | null; created_at: string
}

type InstanceDetail = { instance: SessionInstance; bookings: InstanceBooking[] }

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

const inp: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.10)',
  borderRadius: 8, padding: '8px 11px', fontSize: 13, color: '#F5F7FA',
  outline: 'none', fontFamily: FONT, boxSizing: 'border-box',
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

function fmtDate(d: string | Date) {
  const s = d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
  return new Date(s + 'T00:00:00').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function isToday(d: string) {
  return d === new Date().toISOString().split('T')[0]
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }: { onClose: () => void; onCreate: (s: Session) => void }) {
  const [form, setForm] = useState({
    name: '', day_of_week: 1, start_time: '10:00',
    duration_minutes: 60, max_capacity: 8, session_type: '', resource_id: '', recurring: true,
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
            <div><label style={lbl}>Type</label><input style={inp} value={form.session_type} onChange={e => set('session_type', e.target.value)} placeholder="Group class, Private lesson…" /></div>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div><label style={lbl}>Start Time</label><input style={{ ...inp, colorScheme: 'dark' }} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></div>
              <div><label style={lbl}>Duration (min)</label><input style={inp} type="number" min={15} max={480} value={form.duration_minutes} onChange={e => set('duration_minutes', parseInt(e.target.value) || 60)} /></div>
              <div><label style={lbl}>Max Capacity</label><input style={inp} type="number" min={1} max={100} value={form.max_capacity} onChange={e => set('max_capacity', parseInt(e.target.value) || 8)} /></div>
            </div>
            <div><label style={lbl}>Court / Resource (optional)</label><input style={inp} value={form.resource_id} onChange={e => set('resource_id', e.target.value)} placeholder="Court 1, Court 2…" /></div>
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
            <div><label style={lbl}>Type</label><input style={inp} value={form.session_type} onChange={e => set('session_type', e.target.value)} /></div>
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
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <div><label style={lbl}>Start Time</label><input style={{ ...inp, colorScheme: 'dark' }} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></div>
              <div><label style={lbl}>Duration (min)</label><input style={inp} type="number" min={15} max={480} value={form.duration_minutes} onChange={e => set('duration_minutes', parseInt(e.target.value) || 60)} /></div>
              <div><label style={lbl}>Max Capacity</label><input style={inp} type="number" min={1} max={100} value={form.max_capacity} onChange={e => set('max_capacity', parseInt(e.target.value) || 8)} /></div>
            </div>
            <div><label style={lbl}>Court / Resource (optional)</label><input style={inp} value={form.resource_id} onChange={e => set('resource_id', e.target.value)} placeholder="Court 1, Court 2…" /></div>
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

function SessionCard({ session, selected, onClick }: { session: Session; selected: boolean; onClick: () => void }) {
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
      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.35)', marginBottom: 8 }}>
        {session.start_time}–{end}
        {session.resource_id && <span style={{ marginLeft: 5, color: 'rgba(255,255,255,.22)' }}>· {session.resource_id}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 800, color: capClr }}>{session.enrolled_count}/{session.max_capacity}</span>
        {full && <span style={{ fontSize: 10, fontWeight: 700, color: '#f87171', background: 'rgba(239,68,68,.12)', border: '1px solid rgba(239,68,68,.28)', borderRadius: 20, padding: '1px 7px' }}>Full</span>}
      </div>
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
        <div style={{ minWidth: 72, fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.40)' }}>{fmtDate(inst.date)}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#F5F7FA', marginBottom: 1 }}>{inst.session_name}</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)' }}>{inst.start_time}–{end}{inst.resource_id && ` · ${inst.resource_id}`} · {inst.session_type}</div>
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
  return (
    <div style={{ marginTop: 24, background: 'rgba(255,255,255,.025)', border: '1px solid rgba(255,255,255,.08)', borderRadius: 14, overflow: 'hidden' }}>
      <div style={{ padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#F5F7FA' }}>{session.name}</div>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,.35)', marginTop: 2 }}>
            {DAY_FULL[session.day_of_week]} · {session.start_time}–{end} · {session.session_type}
            {session.resource_id && ` · ${session.resource_id}`}
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
          <button onClick={onDelete} style={{
            fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer',
            background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.22)',
            color: '#f87171', fontFamily: FONT,
          }}>Delete</button>
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
                  {fmtDate(inst.date)}
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

function InstanceRoster({ detail, onBookingUpdate, onEnroll }: {
  detail: InstanceDetail
  onBookingUpdate: (id: string, patch: Partial<InstanceBooking>) => void
  onEnroll: (booking: InstanceBooking) => void
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

  const capClr = capacityColor(bookings.length, instance.max_capacity)

  return (
    <div style={{ marginTop: 12, background: 'rgba(255,255,255,.02)', border: '1px solid rgba(255,255,255,.07)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid rgba(255,255,255,.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA' }}>{fmtDate(instance.date)} · {instance.start_time}–{end}</div>
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
              {['Client', 'Email', 'Payment', 'Attendance'].map(h => (
                <th key={h} style={{ padding: '10px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: i < bookings.length - 1 ? '1px solid rgba(255,255,255,.04)' : 'none' }}>
                <td style={{ padding: '12px 20px', fontSize: 13, fontWeight: 600, color: '#F5F7FA' }}>{b.client_name}</td>
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

  useEffect(() => {
    fetch(API).then(r => r.json()).then(d => { setSessions(d.sessions ?? []); setLoading(false) }).catch(() => setLoading(false))
    fetch(`${API}/instances`).then(r => r.json()).then(d => { setWeekInstances(d.instances ?? []); setWeekLoading(false) }).catch(() => setWeekLoading(false))
  }, [])

  const loadInstances = useCallback(async (sessionId: string) => {
    setInstancesLoading(true); setSelectedInstanceId(null); setInstanceDetail(null)
    const res = await fetch(`${API}/${sessionId}`).catch(() => null)
    setInstancesLoading(false)
    if (res?.ok) { const d = await res.json() as { instances: SessionInstance[] }; setInstances(d.instances ?? []) }
  }, [])

  async function selectSession(id: string) {
    if (selectedSessionId === id) { setSelectedSessionId(null); setInstances([]); setSelectedInstanceId(null); setInstanceDetail(null); return }
    setSelectedSessionId(id); await loadInstances(id)
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

  function handleCreate(s: Session) {
    setSessions(prev => [...prev, s].sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    setTimeout(() => { fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null) }, 1500)
  }

  function handleSave(updated: Session) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s).sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this session and all its scheduled dates? This cannot be undone.')) return
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      setSelectedSessionId(null); setInstances([]); setSelectedInstanceId(null); setInstanceDetail(null)
      fetch(`${API}/instances`).then(r => r.json()).then(d => setWeekInstances(d.instances ?? [])).catch(() => null)
    }
  }

  const selectedSession = sessions.find(s => s.id === selectedSessionId) ?? null

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px', fontFamily: FONT }}>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
      {editingSession && <EditModal session={editingSession} onClose={() => setEditingSession(null)} onSave={handleSave} />}

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', margin: 0, letterSpacing: '-.02em' }}>Sessions</h1>
          <p style={{ fontSize: 12, color: 'rgba(255,255,255,.28)', margin: '4px 0 0' }}>
            {sessions.length} session{sessions.length !== 1 ? 's' : ''} · click to see upcoming dates and rosters
          </p>
        </div>
        <button onClick={() => setShowCreate(true)} style={{
          fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 20, cursor: 'pointer',
          background: 'rgba(99,102,241,.20)', border: '1px solid rgba(99,102,241,.40)',
          color: '#a5b4fc', fontFamily: FONT, flexShrink: 0,
        }}>+ New Session</button>
      </div>

      {!weekLoading && <WeekView instances={weekInstances} onSelectInstance={selectInstance} />}

      <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,.30)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 10 }}>Weekly Schedule</div>

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
                    : daySessions.map(s => <SessionCard key={s.id} session={s} selected={selectedSessionId === s.id} onClick={() => selectSession(s.id)} />)
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
        <InstancesPanel
          session={selectedSession} instances={instances}
          selectedInstanceId={selectedInstanceId} instancesLoading={instancesLoading}
          onSelectInstance={id => loadRoster(selectedSessionId, id)}
          onGenerate={generateInstances} generating={generating}
          onEdit={() => setEditingSession(selectedSession)}
          onDelete={() => handleDelete(selectedSession.id)}
        />
      )}

      {selectedInstanceId && (
        rosterLoading
          ? <div style={{ marginTop: 16, color: 'rgba(255,255,255,.25)', fontSize: 13 }}>Loading roster…</div>
          : instanceDetail ? <InstanceRoster detail={instanceDetail} onBookingUpdate={handleBookingUpdate} onEnroll={b => setInstanceDetail(d => d ? { ...d, bookings: [...d.bookings, b] } : d)} /> : null
      )}
    </div>
  )
}
