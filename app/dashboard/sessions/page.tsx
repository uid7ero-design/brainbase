'use client'

import { useEffect, useState, useCallback, useRef, useId } from 'react'
import {
  parseLocalDate, formatDateAU, addDays, addWeeks, addMonths, toDateStr, isSameDay,
  getWeekRange, getMonthGridRange, formatWeekHeading, formatMonthHeading, eachDayInRange, type DateRange,
} from '@/lib/date'
import {
  sessionLabel, sessionColourDot, optionalLabel,
  SESSION_TYPE_COLOUR_KEYS, SESSION_TYPE_COLOUR_PALETTE, SESSION_TYPE_COLOUR_NAMES, type SessionTypeRow,
} from '@/lib/sessionDisplay'

const FONT = 'var(--bb-font-sans)'
const API  = '/api/dashboard/sessions'

type EndMode = 'ongoing' | 'after_weeks' | 'on_date'

type Session = {
  id: string; name: string; day_of_week: number; start_time: string
  duration_minutes: number; max_capacity: number; session_type: string
  resource_id: string | null; recurring: boolean; created_at: string
  enrolled_count: number; price_per_session: number
  start_date: string | null; end_mode: EndMode; end_after_weeks: number | null; end_date: string | null
  // NULL = inherit the session type's colour. See resolveSessionColourKey /
  // sessionColourDot in lib/sessionDisplay.ts for the one shared resolver
  // every render site must use — never re-derive this precedence locally.
  session_colour_key: string | null
  // NULL = active. Non-null = archived (retired — see
  // app/api/dashboard/sessions/[id]/{archive,restore}/route.ts). Historical
  // instances/bookings remain fully intact and readable regardless.
  archived_at: string | null
}

type ReconcileSummary = { generated: number; reactivated: number; cancelledInstances: number; conflicts: { instanceId: string; date: string }[] }
type ReconcileAllSummary = {
  reconciled: number; totalGenerated: number; totalReactivated: number; totalCancelledInstances: number
  conflicts: { sessionId: string; instanceId: string; date: string }[]
  errors: { sessionId: string; message: string }[]
}

type SessionInstance = {
  id: string; session_id: string; date: string; start_time: string
  duration_minutes: number; max_capacity: number; status: string
  created_at: string; enrolled_count: number; revenue: number; utilisation: number
}

type WeekInstance = SessionInstance & { session_name: string; session_type: string; resource_id: string | null; session_colour_key: string | null }

type InstanceBooking = {
  id: string; client_name: string; client_email: string | null
  paid: boolean; attendance_status: string | null; status: string
  pipeline_id: string | null; is_recurring: boolean; recurring_group_id: string | null
  active_pause_from: string | null; active_pause_until: string | null
  created_at: string
}

type PropagationSummary = {
  propagated: number; alreadyPresent: number; paused: number
  capacityBlocked: number; errors: number; skippedDates: string[]
} | null

type InstanceDetail = { instance: SessionInstance; bookings: InstanceBooking[] }
type ContactBrief  = { id: string; name: string; session_id: string | null }

const LOCATIONS = ['Mt Compass Tennis Club', 'Morphett Vale Tennis Club']

const DAYS_ORDER = [1, 2, 3, 4, 5, 6, 0]
const DAY_LABEL  = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LABEL_MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY_FULL   = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const ATTENDANCE_CYCLE: Record<string, string> = {
  null: 'attending', attending: 'absent', absent: 'null',
}
const ATTENDANCE_STYLE: Record<string, { label: string; color: string; bg: string; border: string }> = {
  attending: { label: '✓ Here',   color: 'var(--status-success)', bg: 'var(--status-success-muted)',  border: 'var(--status-success-border)'  },
  absent:    { label: '✗ Absent', color: 'var(--status-danger)', bg: 'var(--status-danger-muted)',  border: 'var(--status-danger-border)'  },
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

function sessionPrice(type: string) { return SESSION_PRICES[type] ?? 0 }
function sessionRevenue(pricePerSession: number, type: string, count: number) {
  return pricePerSession > 0 ? pricePerSession * count : sessionPrice(type) * count
}
function fmtMoney(n: number) { return n === 0 ? '—' : `$${n.toLocaleString()}` }

const inp: React.CSSProperties = {
  width: '100%', background: 'var(--bg-raised)', border: '1px solid var(--border-strong)',
  borderRadius: 'var(--radius-md)', padding: '8px 11px', fontSize: 13, color: 'var(--text-primary)',
  fontFamily: FONT, boxSizing: 'border-box',
}

const navBtn: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
  background: 'var(--bg-sunken)', border: '1px solid var(--border)',
  color: 'var(--text-secondary)', fontFamily: FONT,
}

function toggleBtn(active: boolean): React.CSSProperties {
  // Raised segment: accent text on --bg-surface (accent-on-accent-tint over the
  // sunken strip was 4.35:1 in light). Border, not outline, so the focus ring wins.
  return {
    fontSize: 12, fontWeight: 600, padding: '4px 12px', borderRadius: 18, cursor: 'pointer', fontFamily: FONT,
    background: active ? 'var(--bg-surface)' : 'transparent',
    border: `1px solid ${active ? 'var(--brand-brainbase-accent-border)' : 'transparent'}`,
    color: active ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)',
  }
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

// Native-button reset for listbox options (keyboard reachable, same effect as a click).
const optionReset: React.CSSProperties = { display: 'block', width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }

function CustomSelect({ value, onChange, placeholder, options, groups, id, ariaLabel }: {
  id?: string
  ariaLabel?: string
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
      <button
        type="button"
        id={id}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        style={{ ...inp, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none', textAlign: 'left' }}
      >
        <span style={{ color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}>{displayLabel}</span>
        <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div role="listbox" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          zIndex: 9999, background: 'var(--bg-overlay)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden', maxHeight: 280, overflowY: 'auto',
          boxShadow: 'var(--shadow-menu)',
        }}>
          {placeholder && (
            <button type="button" role="option" aria-selected={!value}
              onMouseDown={() => { onChange(''); setOpen(false) }}
              onClick={() => { onChange(''); setOpen(false) }}
              style={{ ...optionReset, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontFamily: FONT, color: 'var(--text-muted)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-sunken)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >{placeholder}</button>
          )}
          {options?.map(o => (
            <button type="button" role="option" aria-selected={value === o.value} key={o.value}
              onMouseDown={() => { onChange(o.value); setOpen(false) }}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{ ...optionReset, padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                color: value === o.value ? 'var(--brand-brainbase-accent)' : 'var(--text-primary)',
                background: value === o.value ? 'var(--brand-brainbase-accent-muted)' : 'transparent' }}
              onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = 'var(--bg-sunken)' }}
              onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = 'transparent' }}
            >{o.label}</button>
          ))}
          {groups?.map(g => (
            <div key={g.label}>
              <div style={{ padding: '8px 12px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontFamily: FONT }}>{g.label}</div>
              {g.options.map(o => (
                <button type="button" role="option" aria-selected={value === o.value} key={o.value}
                  onMouseDown={() => { onChange(o.value); setOpen(false) }}
                  onClick={() => { onChange(o.value); setOpen(false) }}
                  style={{ ...optionReset, padding: '9px 14px 9px 20px', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                    color: value === o.value ? 'var(--brand-brainbase-accent)' : 'var(--text-primary)',
                    background: value === o.value ? 'var(--brand-brainbase-accent-muted)' : 'transparent' }}
                  onMouseEnter={e => { if (value !== o.value) e.currentTarget.style.background = 'var(--bg-sunken)' }}
                  onMouseLeave={e => { if (value !== o.value) e.currentTarget.style.background = 'transparent' }}
                >{o.label}</button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// A fixed, finite palette of swatch buttons — each shows an actual colour
// dot plus a readable name (never a raw hex/CSS input, never a tenant-
// supplied string). Replaces a plain CustomSelect dropdown whose options
// were just lowercase colour_key text with no visual swatch per choice,
// which technically worked but wasn't obvious/discoverable as a colour
// picker at a glance.
function ColourPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {SESSION_TYPE_COLOUR_KEYS.map(key => {
        const c = SESSION_TYPE_COLOUR_PALETTE[key]
        const isSelected = value === key
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={SESSION_TYPE_COLOUR_NAMES[key] ?? key}
            onClick={() => onChange(key)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', borderRadius: 20,
              cursor: 'pointer', fontFamily: FONT,
              background: isSelected ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-surface)',
              border: `1px solid ${isSelected ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
            }}
          >
            <span style={{ width: 12, height: 12, borderRadius: '50%', background: c.text, flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: isSelected ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)' }}>
              {SESSION_TYPE_COLOUR_NAMES[key] ?? key}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function endTime(start: string, dur: number) {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + dur
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function capacityColor(enrolled: number, max: number) {
  if (enrolled >= max)        return 'var(--status-danger)'
  if (enrolled >= max * 0.75) return 'var(--status-warning)'
  return 'var(--status-success)'
}

function scheduleSummary(s: Session): string {
  const dayLine = `${DAY_FULL[s.day_of_week]}s ${s.start_time}`
  if (s.end_mode === 'after_weeks' && s.end_after_weeks) return `${s.end_after_weeks} weeks · ${dayLine}`
  if (s.end_mode === 'on_date' && s.end_date) return `Ends ${formatDateAU(s.end_date)} · ${dayLine}`
  return `Ongoing · ${dayLine}`
}

// Just the end-rule half of scheduleSummary — used in Manage Sessions
// where day/time are already shown on their own line.
function endRuleSummary(s: Session): string {
  if (s.end_mode === 'after_weeks' && s.end_after_weeks) return `${s.end_after_weeks} weeks`
  if (s.end_mode === 'on_date' && s.end_date) return `Ends ${formatDateAU(s.end_date)}`
  return 'Ongoing'
}

type RepairResult = { instances: SessionInstance[]; reconcile: ReconcileSummary }

async function repairSession(id: string): Promise<RepairResult | null> {
  const res = await fetch(`${API}/${id}/generate-instances`, { method: 'POST' })
  if (!res.ok) return null
  return await res.json() as RepairResult
}

function formatRepairNote(reconcile: ReconcileSummary): string {
  const { generated, reactivated, cancelledInstances, conflicts } = reconcile
  if (generated === 0 && reactivated === 0 && cancelledInstances === 0 && conflicts.length === 0) return 'Already up to date — nothing to repair.'
  const parts: string[] = []
  if (generated > 0) parts.push(`added ${generated} future date${generated === 1 ? '' : 's'}`)
  if (reactivated > 0) parts.push(`restored ${reactivated} cancelled date${reactivated === 1 ? '' : 's'} to scheduled`)
  if (cancelledInstances > 0) parts.push(`removed ${cancelledInstances} stale date${cancelledInstances === 1 ? '' : 's'}`)
  if (conflicts.length > 0) parts.push(`${conflicts.length} date${conflicts.length === 1 ? '' : 's'} left unchanged (has paid/attended players)`)
  return parts.join(', ') + '.'
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

// ─── Session Form Fields (shared by Create/Edit) ───────────────────────────────

type SessionFormState = {
  name: string; day_of_week: number; start_time: string
  duration_minutes: number; max_capacity: number; session_type: string; resource_id: string; recurring: boolean
  price_per_session: number
  start_date: string; end_mode: EndMode; end_after_weeks: number; end_date: string
  session_colour_key: string // '' = inherit the session type's colour
}

const FLAT_LEGACY_TYPE_OPTIONS: SelectOption[] = SESSION_TYPE_GROUPS.flatMap(g => g.options)

const fieldLbl: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.08em',
  textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 5,
}
// Used only inside multi-column field rows (Start Date/Start Time/Duration,
// Max Capacity/Price): a fixed minHeight + explicit lineHeight reserves the
// same vertical space for every label in the row regardless of whether its
// own text wraps to two lines, so every input below it starts at the same
// Y position — the actual fix for the misaligned-fields production bug,
// not a per-field margin patch.
const fieldRowLbl: React.CSSProperties = { ...fieldLbl, minHeight: 28, lineHeight: '14px' }
const sectionLbl: React.CSSProperties = {
  fontSize: 10, fontWeight: 800, letterSpacing: '.10em', textTransform: 'uppercase', color: 'var(--text-muted)',
}

function pillStyle(active: boolean): React.CSSProperties {
  return {
    fontSize: 11, fontWeight: 700, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
    background: active ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
    border: `1px solid ${active ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
    color: active ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)', fontFamily: FONT,
  }
}

function SessionFormFields({ form, set, sessionTypes, onManageTypes }: {
  form: SessionFormState
  set: (k: keyof SessionFormState, v: string | number | boolean) => void
  sessionTypes: SessionTypeRow[]
  onManageTypes: () => void
}) {
  const typeOptions: SelectOption[] = sessionTypes.length > 0
    ? sessionTypes
        .filter(t => t.active || t.slug === form.session_type)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(t => ({ value: t.slug, label: t.name }))
    : FLAT_LEGACY_TYPE_OPTIONS

  // What the type itself currently resolves to — shown so "Use type colour"
  // reads as "Use type colour — Green", not just a bare, unhelpful label.
  const typeColourKey = sessionTypes.find(t => t.slug === form.session_type)?.colour_key
  const typeColourName = typeColourKey ? (SESSION_TYPE_COLOUR_NAMES[typeColourKey] ?? typeColourKey) : null
  const fid = useId()

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={sectionLbl}>Session Details</div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <label style={fieldLbl}>Type</label>
            <button type="button" onClick={onManageTypes} style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 11, fontFamily: FONT, padding: 0, marginBottom: 5 }}>Manage types</button>
          </div>
          <CustomSelect ariaLabel="Type" value={form.session_type} onChange={v => set('session_type', v)} placeholder="Select session type" options={typeOptions} />
        </div>
        <div>
          <label style={fieldLbl}>Optional Label</label>
          <input aria-label="Optional Label" style={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Green Ball Advanced" />
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'var(--text-muted)' }}>
            Use only when you need to distinguish this class from others of the same type. Leave blank to just show the type name.
          </p>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <label style={fieldLbl}>Session Colour</label>
            {form.session_colour_key && (
              <button type="button" onClick={() => set('session_colour_key', '')}
                style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 11, fontFamily: FONT, padding: 0, marginBottom: 5 }}>
                Use type colour
              </button>
            )}
          </div>
          <p style={{ margin: '0 0 8px', fontSize: 11, color: form.session_colour_key ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)' }}>
            {form.session_colour_key
              ? `Session override — ${SESSION_TYPE_COLOUR_NAMES[form.session_colour_key] ?? form.session_colour_key}`
              : `Use type colour${typeColourName ? ` — ${typeColourName}` : ''}`}
          </p>
          <ColourPicker value={form.session_colour_key || typeColourKey || 'slate'} onChange={v => set('session_colour_key', v)} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={sectionLbl}>Schedule</div>
        <div>
          <span id={`${fid}-day`} style={fieldLbl}>Day</span>
          <div role="group" aria-labelledby={`${fid}-day`} style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {DAYS_ORDER.map(d => (
              <button key={d} type="button" aria-pressed={form.day_of_week === d} onClick={() => set('day_of_week', d)} style={pillStyle(form.day_of_week === d)}>{DAY_LABEL[d]}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12 }}>
          <div><label htmlFor={`${fid}-start-date`} style={fieldRowLbl}>Start Date</label><input id={`${fid}-start-date`} style={inp} type="date" value={form.start_date} onChange={e => set('start_date', e.target.value)} /></div>
          <div><label htmlFor={`${fid}-start-time`} style={fieldRowLbl}>Start Time</label><input id={`${fid}-start-time`} style={inp} type="time" value={form.start_time} onChange={e => set('start_time', e.target.value)} /></div>
          <div><label htmlFor={`${fid}-duration`} style={fieldRowLbl}>Duration (min)</label><input id={`${fid}-duration`} style={inp} type="number" min={15} max={480} value={form.duration_minutes} onChange={e => set('duration_minutes', parseInt(e.target.value) || 60)} /></div>
        </div>
        <div>
          <span id={`${fid}-ends`} style={fieldLbl}>Ends</span>
          <div role="group" aria-labelledby={`${fid}-ends`} style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button type="button" aria-pressed={form.end_mode === 'after_weeks'} onClick={() => set('end_mode', 'after_weeks')} style={pillStyle(form.end_mode === 'after_weeks')}>After weeks</button>
            {form.end_mode === 'after_weeks' && (
              <>
                <input aria-label="Number of weeks" style={{ ...inp, width: 60 }} type="number" min={1} max={104} value={form.end_after_weeks} onChange={e => set('end_after_weeks', parseInt(e.target.value) || 1)} />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>weeks</span>
              </>
            )}
            <button type="button" aria-pressed={form.end_mode === 'on_date'} onClick={() => set('end_mode', 'on_date')} style={pillStyle(form.end_mode === 'on_date')}>On date</button>
            {form.end_mode === 'on_date' && (
              <input aria-label="End date" style={{ ...inp, width: 150 }} type="date" value={form.end_date} onChange={e => set('end_date', e.target.value)} />
            )}
            <button type="button" aria-pressed={form.end_mode === 'ongoing'} onClick={() => set('end_mode', 'ongoing')} style={pillStyle(form.end_mode === 'ongoing')}>Ongoing</button>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={sectionLbl}>Capacity &amp; Price</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <div><label htmlFor={`${fid}-capacity`} style={fieldRowLbl}>Max Capacity</label><input id={`${fid}-capacity`} style={inp} type="number" min={1} max={100} value={form.max_capacity} onChange={e => set('max_capacity', parseInt(e.target.value) || 8)} /></div>
          <div><label htmlFor={`${fid}-price`} style={fieldRowLbl}>Price ($)</label><input id={`${fid}-price`} style={inp} type="number" min={0} step={0.5} value={form.price_per_session} onChange={e => set('price_per_session', parseFloat(e.target.value) || 0)} /></div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={sectionLbl}>Location</div>
        <CustomSelect ariaLabel="Location" value={form.resource_id} onChange={v => set('resource_id', v)} placeholder="— Select location —" options={LOCATION_OPTIONS} />
      </div>

      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={form.recurring} onChange={e => set('recurring', e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--brand-brainbase-accent)' }} />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Allow weekly (recurring) enrolment</span>
        </label>
        <p style={{ margin: '4px 0 0 26px', fontSize: 11, color: 'var(--text-muted)' }}>
          Lets players choose Weekly when enrolling in this class. Separate from the Schedule above, which controls how often the class itself runs.
        </p>
      </div>
    </div>
  )
}

// ─── Create Modal ─────────────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate, sessionTypes, onManageTypes }: {
  onClose: () => void; onCreate: (s: Session) => void; sessionTypes: SessionTypeRow[]; onManageTypes: () => void
}) {
  const [form, setForm] = useState<SessionFormState>({
    name: '', day_of_week: 1, start_time: '10:00',
    duration_minutes: 60, max_capacity: 8, session_type: '', resource_id: '', recurring: true,
    price_per_session: 0,
    start_date: todayStr(), end_mode: 'ongoing', end_after_weeks: 10, end_date: '',
    session_colour_key: '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  // Focus moves into the dialog on open. (No Escape handler here on purpose:
  // Manage Types can open on top of this form, and a document-level Escape
  // would discard the half-filled form underneath it.)
  useEffect(() => { closeRef.current?.focus() }, [])

  const set = (k: keyof SessionFormState, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.session_type.trim() || saving) return
    if (form.end_mode === 'on_date' && !form.end_date) { setErr('Choose an end date, or switch Ends to a different option.'); return }
    setSaving(true); setErr(null)
    const res = await fetch(API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, resource_id: form.resource_id.trim() || undefined,
        end_after_weeks: form.end_mode === 'after_weeks' ? form.end_after_weeks : null,
        end_date: form.end_mode === 'on_date' ? form.end_date : null,
      }),
    })
    setSaving(false)
    if (res.ok) { const d = await res.json() as { session: Session }; onCreate(d.session); onClose() }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed') }
  }

  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '26px 28px', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', fontFamily: FONT, boxShadow: 'var(--shadow-dialog)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>New Session</h2>
            <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <SessionFormFields form={form} set={set} sessionTypes={sessionTypes} onManageTypes={onManageTypes} />
          {err && <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--status-danger)' }}>{err}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submit} disabled={!form.session_type.trim() || saving}
              style={{ flex: 2, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT, opacity: !form.session_type.trim() || saving ? .45 : 1 }}>
              {saving ? 'Creating…' : 'Create Session'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Edit Modal ───────────────────────────────────────────────────────────────

function EditModal({ session, onClose, onSave, sessionTypes, onManageTypes }: {
  session: Session; onClose: () => void; onSave: (s: Session) => void; sessionTypes: SessionTypeRow[]; onManageTypes: () => void
}) {
  const [form, setForm] = useState<SessionFormState>({
    name: session.name, day_of_week: session.day_of_week, start_time: session.start_time,
    duration_minutes: session.duration_minutes, max_capacity: session.max_capacity,
    session_type: session.session_type, resource_id: session.resource_id ?? '', recurring: session.recurring,
    price_per_session: session.price_per_session ?? 0,
    start_date: session.start_date ?? todayStr(), end_mode: session.end_mode ?? 'ongoing',
    end_after_weeks: session.end_after_weeks ?? 10, end_date: session.end_date ?? '',
    session_colour_key: session.session_colour_key ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState<string | null>(null)
  const [reconcileNote, setReconcileNote] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // Regardless of which surface opened Edit (the page header, the selected-
  // session detail, or Manage Sessions), this must be the sole active
  // dialog by the time it mounts, so it always owns focus/Escape itself
  // rather than relying on whatever opened it.
  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const set = (k: keyof SessionFormState, v: string | number | boolean) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.session_type.trim() || saving) return
    if (form.end_mode === 'on_date' && !form.end_date) { setErr('Choose an end date, or switch Ends to a different option.'); return }
    setSaving(true); setErr(null)
    const res = await fetch(`${API}/${session.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form, resource_id: form.resource_id.trim() || null,
        end_after_weeks: form.end_mode === 'after_weeks' ? form.end_after_weeks : null,
        end_date: form.end_mode === 'on_date' ? form.end_date : null,
      }),
    })
    setSaving(false)
    if (res.ok) {
      const d = await res.json() as { session: Session; reconcile: ReconcileSummary }
      if (d.reconcile.conflicts.length > 0) {
        setReconcileNote(`Saved, but ${d.reconcile.conflicts.length} future date${d.reconcile.conflicts.length === 1 ? '' : 's'} outside the new schedule already ${d.reconcile.conflicts.length === 1 ? 'has' : 'have'} paid or attended players, so ${d.reconcile.conflicts.length === 1 ? 'it was' : 'they were'} left scheduled — review manually.`)
        return
      }
      onSave({ ...d.session, enrolled_count: session.enrolled_count }); onClose()
    }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed') }
  }

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="Edit session"
        style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '26px 28px', width: '100%', maxWidth: 480, maxHeight: '88vh', overflowY: 'auto', fontFamily: FONT, boxShadow: 'var(--shadow-dialog)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Edit Session</h2>
            <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>
          <SessionFormFields form={form} set={set} sessionTypes={sessionTypes} onManageTypes={onManageTypes} />
          {err && <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--status-danger)' }}>{err}</p>}
          {reconcileNote && (
            <div style={{ margin: '12px 0 0', padding: '10px 12px', borderRadius: 8, background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)' }}>
              <p style={{ margin: 0, fontSize: 12, color: 'var(--status-warning)' }}>{reconcileNote}</p>
              <button onClick={onClose} style={{ marginTop: 8, background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: 0 }}>Close</button>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 22 }}>
            <button onClick={onClose} style={{ flex: 1, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submit} disabled={!form.session_type.trim() || saving}
              style={{ flex: 2, fontSize: 13, fontWeight: 600, padding: '9px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT, opacity: !form.session_type.trim() || saving ? .45 : 1 }}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Manage Session Types ───────────────────────────────────────────────────────

function ManageSessionTypesModal({ types, onClose, onChanged }: {
  types: SessionTypeRow[]; onClose: () => void; onChanged: () => void
}) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColour, setNewColour] = useState('slate')
  const [err, setErr] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [recolouringId, setRecolouringId] = useState<string | null>(null)

  const sorted = [...types].sort((a, b) => a.sort_order - b.sort_order)

  async function addType() {
    if (!newName.trim()) return
    setErr(null)
    const res = await fetch('/api/dashboard/session-types', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim(), colour_key: newColour }),
    })
    if (res.ok) { setNewName(''); setNewColour('slate'); setAdding(false); onChanged() }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed to add type') }
  }

  async function toggleActive(t: SessionTypeRow) {
    setBusyId(t.id)
    await fetch(`/api/dashboard/session-types/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !t.active }),
    })
    setBusyId(null); onChanged()
  }

  async function recolour(t: SessionTypeRow, colour_key: string) {
    setBusyId(t.id)
    await fetch(`/api/dashboard/session-types/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colour_key }),
    })
    setBusyId(null); onChanged()
  }

  async function saveRename(t: SessionTypeRow) {
    if (!renameValue.trim()) { setRenamingId(null); return }
    setBusyId(t.id)
    const res = await fetch(`/api/dashboard/session-types/${t.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    })
    setBusyId(null)
    if (res.ok) { setRenamingId(null); onChanged() }
    else { const d = await res.json().catch(() => ({})) as { error?: string }; setErr(d.error ?? 'Failed to rename') }
  }

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="Manage session types" style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 26px', width: '100%', maxWidth: 440, maxHeight: '82vh', overflowY: 'auto', fontFamily: FONT, boxShadow: 'var(--shadow-dialog)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Manage Session Types</h2>
            <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {sorted.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>No session types yet. Add your first one below.</p>}
            {sorted.map(t => (
              <div key={t.id} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', opacity: t.active ? 1 : .5 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button type="button" onClick={() => setRecolouringId(id => id === t.id ? null : t.id)}
                    aria-label={`Change colour — currently ${SESSION_TYPE_COLOUR_NAMES[t.colour_key] ?? t.colour_key}`}
                    aria-expanded={recolouringId === t.id}
                    style={{ width: 16, height: 16, borderRadius: 5, background: SESSION_TYPE_COLOUR_PALETTE[t.colour_key]?.text ?? '#94a3b8', flexShrink: 0, border: recolouringId === t.id ? '2px solid var(--text-primary)' : '1px solid var(--border)', cursor: 'pointer', padding: 0 }} />
                  {renamingId === t.id ? (
                    <input autoFocus aria-label={`Rename ${t.name}`} style={{ ...inp, flex: 1, padding: '4px 8px' }} value={renameValue}
                      onChange={e => setRenameValue(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') saveRename(t); if (e.key === 'Escape') setRenamingId(null) }} />
                  ) : (
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>{t.name}</span>
                  )}
                  {!t.active && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-sunken)', borderRadius: 20, padding: '1px 6px', flexShrink: 0 }}>Archived</span>}
                  {renamingId === t.id ? (
                    <button onClick={() => saveRename(t)} disabled={busyId === t.id} style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 11, fontFamily: FONT }}>Save</button>
                  ) : (
                    <button onClick={() => { setRenamingId(t.id); setRenameValue(t.name) }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, fontFamily: FONT }}>Rename</button>
                  )}
                  <button onClick={() => toggleActive(t)} disabled={busyId === t.id} style={{ background: 'none', border: 'none', color: t.active ? 'var(--status-danger)' : 'var(--status-success)', cursor: 'pointer', fontSize: 11, fontFamily: FONT, flexShrink: 0 }}>
                    {t.active ? 'Archive' : 'Restore'}
                  </button>
                </div>
                {recolouringId === t.id && (
                  <ColourPicker value={t.colour_key} onChange={v => { recolour(t, v); setRecolouringId(null) }} />
                )}
              </div>
            ))}
          </div>

          {err && <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--status-danger)' }}>{err}</p>}

          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            {adding ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input aria-label="New type name" style={inp} placeholder="New type name" value={newName} onChange={e => setNewName(e.target.value)} autoFocus />
                <ColourPicker value={newColour} onChange={setNewColour} />
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={() => setAdding(false)} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>Cancel</button>
                  <button onClick={addType} disabled={!newName.trim()} style={{ flex: 1, fontSize: 12, fontWeight: 600, padding: '7px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT, opacity: !newName.trim() ? .5 : 1 }}>Add type</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} style={{ width: '100%', fontSize: 12, fontWeight: 600, padding: '8px 0', borderRadius: 8, cursor: 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT }}>+ Add session type</button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Manage Sessions ────────────────────────────────────────────────────────
// Replaces the old horizontal SessionChip strip that used to sit above the
// calendar on every page load (visually competing with it). The calendar is
// now the only surface shown by default; this modal is the one place Luke
// reaches Repair future dates / Edit / Delete for a session template —
// still essential for a session with no scheduled instances currently
// visible in the calendar range (its schedule hasn't been reconciled since
// being edited, or its rolling horizon hasn't topped up yet), which would
// otherwise be completely unreachable for management.
function ManageSessionsModal({ sessions, sessionTypes, contacts, onClose, onEdit, onDelete, onArchive, onRestore, onRepaired }: {
  sessions: Session[]
  sessionTypes: SessionTypeRow[]
  contacts: ContactBrief[]
  onClose: () => void
  onEdit: (s: Session) => void
  onDelete: (id: string) => Promise<void> | void
  onArchive: (id: string) => Promise<{ cancelledInstances: number; conflicts: { instanceId: string; date: string }[] } | null>
  onRestore: (id: string) => Promise<ReconcileSummary | null>
  onRepaired: () => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [showArchived, setShowArchived] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    closeRef.current?.focus()
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  // Default: active only, matching "default operational views exclude
  // archived templates" — Show archived reveals everything, same
  // include_archived=1 convention Manage Types already uses.
  const visible = showArchived ? sessions : sessions.filter(s => !s.archived_at)
  const sorted = [...visible].sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time))
  const archivedCount = sessions.filter(s => s.archived_at).length

  async function handleRepair(id: string) {
    setBusyId(id); setNotes(n => ({ ...n, [id]: '' }))
    const result = await repairSession(id)
    setBusyId(null)
    if (result) { setNotes(n => ({ ...n, [id]: formatRepairNote(result.reconcile) })); onRepaired() }
  }

  async function handleDeleteConfirmed(id: string) {
    setBusyId(id)
    await onDelete(id)
    setBusyId(null); setConfirmDeleteId(null)
  }

  async function handleArchiveConfirmed(id: string) {
    setBusyId(id); setNotes(n => ({ ...n, [id]: '' }))
    const cancel = await onArchive(id)
    setBusyId(null); setConfirmArchiveId(null)
    if (cancel) {
      const parts = [`Archived — ${cancel.cancelledInstances} future date${cancel.cancelledInstances === 1 ? '' : 's'} cancelled`]
      if (cancel.conflicts.length > 0) parts.push(`${cancel.conflicts.length} left scheduled (paid/attended) — review manually`)
      setNotes(n => ({ ...n, [id]: parts.join(', ') }))
    }
  }

  async function handleRestoreClick(id: string) {
    setBusyId(id); setNotes(n => ({ ...n, [id]: '' }))
    const reconcile = await onRestore(id)
    setBusyId(null)
    if (reconcile) setNotes(n => ({ ...n, [id]: `Restored — ${formatRepairNote(reconcile)}` }))
  }

  return (
    <>
      <div role="dialog" aria-modal="true" aria-label="Manage sessions"
        style={{ position: 'fixed', inset: 0, background: 'var(--scrim)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}
        onClick={e => { if (e.target === e.currentTarget) onClose() }}>
        <div style={{ background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px 26px', width: '100%', maxWidth: 560, maxHeight: '86vh', overflowY: 'auto', fontFamily: FONT, boxShadow: 'var(--shadow-dialog)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Manage Sessions</h2>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Every session template, including any with no dates currently on the calendar.</p>
            </div>
            <button ref={closeRef} onClick={onClose} aria-label="Close" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18 }}>✕</button>
          </div>

          {archivedCount > 0 && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 14, cursor: 'pointer', width: 'fit-content' }}>
              <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}
                style={{ width: 14, height: 14, accentColor: 'var(--brand-brainbase-accent)' }} />
              <span style={{ fontSize: 11, color: 'var(--text-secondary)' }}>Show archived ({archivedCount})</span>
            </label>
          )}

          {sorted.length === 0 && <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>{showArchived || archivedCount === 0 ? 'No sessions yet.' : 'No active sessions.'}</p>}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sorted.map(s => {
              const archived = !!s.archived_at
              const title = sessionLabel(s.session_type, sessionTypes)
              const label = optionalLabel(s.name, s.session_type, sessionTypes)
              const sessionContacts = contacts.filter(c => c.session_id === s.id)
              const full = s.enrolled_count >= s.max_capacity
              const capClr = capacityColor(s.enrolled_count, s.max_capacity)
              return (
                <div key={s.id} style={{
                  padding: '10px 12px', borderRadius: 10, background: 'var(--bg-surface)',
                  border: '1px solid var(--border)', borderLeft: `3px solid ${sessionColourDot(s.session_type, sessionTypes, s.session_colour_key)}`,
                  opacity: archived ? .6 : 1,
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</div>
                        {archived && (
                          <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--bg-sunken)', borderRadius: 20, padding: '1px 6px', flexShrink: 0 }}>Archived</span>
                        )}
                      </div>
                      {label && <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 1 }}>{label}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{DAY_FULL[s.day_of_week]} · {s.start_time}–{endTime(s.start_time, s.duration_minutes)}</span>
                        {s.resource_id && <span>· {s.resource_id}</span>}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 3, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span>{endRuleSummary(s)}</span>
                        <span style={{ fontWeight: 700, color: capClr }}>{s.enrolled_count}/{s.max_capacity}</span>
                        {full && <span style={{ fontWeight: 700, color: 'var(--status-danger)' }}>Full</span>}
                      </div>
                      {sessionContacts.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 3 }}>{sessionContacts.map(c => c.name).join(', ')}</div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                      {archived ? (
                        <button onClick={() => handleRestoreClick(s.id)} disabled={busyId === s.id} aria-label={`Restore ${title}`}
                          style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: busyId === s.id ? 'not-allowed' : 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT, opacity: busyId === s.id ? .5 : 1 }}>
                          {busyId === s.id ? 'Restoring…' : 'Restore'}
                        </button>
                      ) : (
                        <button onClick={() => handleRepair(s.id)} disabled={busyId === s.id} aria-label={`Repair future dates for ${title}`}
                          style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: busyId === s.id ? 'not-allowed' : 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: FONT, opacity: busyId === s.id ? .5 : 1 }}>
                          {busyId === s.id ? 'Repairing…' : 'Repair'}
                        </button>
                      )}
                      <button onClick={() => onEdit(s)} aria-label={`Edit ${title}`}
                        style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: FONT }}>
                        Edit
                      </button>
                      {!archived && (
                        confirmArchiveId === s.id ? (
                          <>
                            <button onClick={() => handleArchiveConfirmed(s.id)} disabled={busyId === s.id} aria-label={`Confirm archive ${title}`}
                              style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', color: 'var(--status-warning)', fontFamily: FONT }}>
                              Confirm
                            </button>
                            <button onClick={() => setConfirmArchiveId(null)} aria-label="Cancel archive"
                              style={{ fontSize: 11, padding: '5px 8px', borderRadius: 20, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>
                              ✕
                            </button>
                          </>
                        ) : (
                          <button onClick={() => setConfirmArchiveId(s.id)} aria-label={`Archive ${title}`}
                            style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', color: 'var(--status-warning)', fontFamily: FONT }}>
                            Archive
                          </button>
                        )
                      )}
                      {confirmDeleteId === s.id ? (
                        <>
                          <button onClick={() => handleDeleteConfirmed(s.id)} disabled={busyId === s.id} aria-label={`Confirm delete ${title}`}
                            style={{ fontSize: 11, fontWeight: 700, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)', fontFamily: FONT }}>
                            Confirm
                          </button>
                          <button onClick={() => setConfirmDeleteId(null)} aria-label="Cancel delete"
                            style={{ fontSize: 11, padding: '5px 8px', borderRadius: 20, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>
                            ✕
                          </button>
                        </>
                      ) : (
                        <button onClick={() => setConfirmDeleteId(s.id)} aria-label={`Delete ${title}`}
                          style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)', fontFamily: FONT }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                  {notes[s.id] && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--brand-brainbase-accent)' }}>{notes[s.id]}</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Calendar (Week / Month navigation over existing session instances) ───────
// Read-only over already-scheduled session_instances rows — never generates,
// mutates, or propagates anything. The schedule-rule reconciliation in
// lib/tennisSchedule.ts (automatic on save/dashboard load, plus the manual
// "Repair future dates" recovery action) / recurrence / pause remain the
// only ways instances come into existence; this just browses them.

// Native-button reset for calendar entries: keyboard operable, same look.
const entryReset: React.CSSProperties = { width: '100%', textAlign: 'left', margin: 0, font: 'inherit' }

function CalendarEntry({ inst, compact, selected, sessionTypes, onSelect }: {
  inst: WeekInstance; compact?: boolean; selected?: boolean; sessionTypes: SessionTypeRow[]; onSelect: () => void
}) {
  const capClr = capacityColor(inst.enrolled_count, inst.max_capacity)
  const full   = inst.enrolled_count >= inst.max_capacity
  const title  = sessionLabel(inst.session_type, sessionTypes)
  // Selected state must ADD emphasis, not replace the type-colour stripe —
  // a Production bug had the two collide. Every side is set as an explicit
  // longhand (never mixing the `border` shorthand with `borderLeft`), so
  // there is no ambiguity about which one wins: the left edge is always
  // the type colour, the other three sides carry the selected-state ring.
  const typeColour = sessionColourDot(inst.session_type, sessionTypes, inst.session_colour_key)
  if (compact) {
    // Month view: tight on space, but the start time must still be visible
    // without clicking — "10:00 Hot Shots Tennis · 3/8".
    const compactBorderColor = selected ? 'var(--brand-brainbase-accent-border)' : 'transparent'
    return (
      <button type="button" aria-pressed={!!selected} onClick={onSelect} style={{
        ...entryReset,
        fontSize: 9.5, padding: '2px 5px', borderRadius: 4, cursor: 'pointer', fontFamily: FONT,
        background: selected ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
        borderTop: `1px solid ${compactBorderColor}`,
        borderRight: `1px solid ${compactBorderColor}`,
        borderBottom: `1px solid ${compactBorderColor}`,
        borderLeft: `2px solid ${typeColour}`,
        color: selected ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4,
      }}
        onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 7%, transparent)' }}
        onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-sunken)' }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span style={{ fontWeight: 700, color: selected ? 'var(--brand-brainbase-accent)' : 'var(--text-primary)' }}>{inst.start_time}</span> {title}
        </span>
        <span style={{ fontWeight: 700, color: capClr, flexShrink: 0 }}>{inst.enrolled_count}/{inst.max_capacity}</span>
      </button>
    )
  }
  const label = optionalLabel(inst.session_name, inst.session_type, sessionTypes)
  const fullBorderColor = selected ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'
  return (
    <button type="button" aria-pressed={!!selected} onClick={onSelect} style={{
      ...entryReset,
      padding: '5px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: FONT,
      background: selected ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
      borderTop: `1px solid ${fullBorderColor}`,
      borderRight: `1px solid ${fullBorderColor}`,
      borderBottom: `1px solid ${fullBorderColor}`,
      borderLeft: `3px solid ${typeColour}`,
      display: 'flex', flexDirection: 'column', gap: 2,
    }}
      onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 7%, transparent)' }}
      onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'var(--bg-sunken)' }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: selected ? 'var(--brand-brainbase-accent)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        <span style={{ fontSize: 10, fontWeight: 800, color: capClr, flexShrink: 0 }}>{inst.enrolled_count}/{inst.max_capacity}</span>
      </span>
      {label && (
        <span style={{ display: 'block', fontSize: 10, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
      )}
      <span style={{ display: 'block', fontSize: 10, fontWeight: 600, color: selected ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)' }}>
        {inst.start_time}–{endTime(inst.start_time, inst.duration_minutes)}
      </span>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
        {inst.resource_id && <span>{inst.resource_id}</span>}
        {full && <span style={{ fontWeight: 700, color: 'var(--status-danger)' }}>Full</span>}
      </span>
    </button>
  )
}

function WeekGrid({ range, instances, selectedInstanceId, sessionTypes, onSelectInstance }: {
  range: DateRange
  instances: WeekInstance[]
  selectedInstanceId: string | null
  sessionTypes: SessionTypeRow[]
  onSelectInstance: (sessionId: string, instanceId: string) => void
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(range.start, i))
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 8, minWidth: 700 }}>
      {days.map((day, i) => {
        const dateStr = toDateStr(day)
        const dayInstances = instances.filter(inst => inst.date === dateStr).sort((a, b) => a.start_time.localeCompare(b.start_time))
        const today_ = isSameDay(day, new Date())
        return (
          <div key={dateStr}>
            <div style={{
              fontSize: 11, fontWeight: 700, textAlign: 'center', marginBottom: 8, paddingBottom: 8,
              borderBottom: `1px solid ${today_ ? 'var(--brand-brainbase-accent-border)' : 'var(--border-light)'}`,
              color: today_ ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)',
            }}>
              {DAY_LABEL_MON[i]} <span style={{ color: today_ ? 'var(--brand-brainbase-accent)' : 'var(--text-secondary)' }}>{day.getDate()}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, minHeight: 32 }}>
              {dayInstances.length === 0
                ? <div style={{ height: 32, border: '1px dashed var(--border-light)', borderRadius: 6 }} />
                : dayInstances.map(inst => (
                    <CalendarEntry key={inst.id} inst={inst} selected={inst.id === selectedInstanceId} sessionTypes={sessionTypes} onSelect={() => onSelectInstance(inst.session_id, inst.id)} />
                  ))
              }
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthGrid({ range, monthAnchor, instances, selectedInstanceId, sessionTypes, onSelectInstance }: {
  range: DateRange
  monthAnchor: Date
  instances: WeekInstance[]
  selectedInstanceId: string | null
  sessionTypes: SessionTypeRow[]
  onSelectInstance: (sessionId: string, instanceId: string) => void
}) {
  const days = eachDayInRange(range)
  const weeks: Date[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 700 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
        {DAY_LABEL_MON.map(l => (
          <div key={l} style={{ fontSize: 10, fontWeight: 700, textAlign: 'center', color: 'var(--text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>{l}</div>
        ))}
      </div>
      {weeks.map((week, wi) => (
        <div key={wi} style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {week.map(day => {
            const dateStr = toDateStr(day)
            const inMonth = day.getMonth() === monthAnchor.getMonth()
            const today_ = isSameDay(day, new Date())
            const dayInstances = instances.filter(inst => inst.date === dateStr).sort((a, b) => a.start_time.localeCompare(b.start_time))
            const shown = dayInstances.slice(0, 3)
            const extra = dayInstances.length - shown.length
            return (
              <div key={dateStr} style={{
                minHeight: 74, padding: 6, borderRadius: 8,
                background: today_ ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-surface)',
                border: `1px solid ${today_ ? 'var(--brand-brainbase-accent-border)' : 'var(--border-light)'}`,
                opacity: inMonth ? 1 : .35,
              }}>
                <div style={{ fontSize: 10, fontWeight: today_ ? 800 : 600, color: today_ ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)', marginBottom: 4 }}>{day.getDate()}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {shown.map(inst => (
                    <CalendarEntry key={inst.id} inst={inst} compact selected={inst.id === selectedInstanceId} sessionTypes={sessionTypes} onSelect={() => onSelectInstance(inst.session_id, inst.id)} />
                  ))}
                  {extra > 0 && <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>+{extra} more</div>}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ─── Instance Roster ──────────────────────────────────────────────────────────

type Contact = { id: string; name: string; email: string | null; phone: string | null }

function summaryText(s: PropagationSummary): string | null {
  if (!s) return null
  const parts: string[] = []
  if (s.propagated > 0) parts.push(`Added to ${s.propagated} future session${s.propagated === 1 ? '' : 's'}`)
  if (s.capacityBlocked > 0) parts.push(`${s.capacityBlocked} session${s.capacityBlocked === 1 ? '' : 's'} full (${s.skippedDates.join(', ')})`)
  if (s.errors > 0) parts.push(`${s.errors} failed`)
  if (parts.length === 0) return s.alreadyPresent > 0 ? 'Already enrolled in all upcoming sessions.' : null
  return parts.join('. ') + '.'
}

function InstanceRoster({ detail, sessionRecurring, hasOtherInstances, onBookingUpdate, onEnroll, onRemove, onRemoveFuture, onRefresh, toggleErrId, toggleErr, onToggleError }: {
  detail: InstanceDetail
  sessionRecurring: boolean
  hasOtherInstances: boolean
  onBookingUpdate: (id: string, patch: Partial<InstanceBooking>) => void
  onEnroll: (booking: InstanceBooking) => void
  onRemove: (bookingId: string) => void
  onRemoveFuture: (bookingId: string) => void
  onRefresh: () => void
  toggleErrId: string | null
  toggleErr: string | null
  onToggleError: (id: string | null, message: string | null) => void
}) {
  const { instance, bookings } = detail
  if (!instance) return null
  // A session flagged `recurring` should always offer Weekly, even before
  // any future instances exist yet — but `recurring` alone is not a
  // reliable signal in practice: generate-instances does not require it,
  // so a session flagged non-recurring can still have future instances to
  // propagate into (this was the actual production bug — Weekly was
  // wrongly hidden for such a session). Offer Weekly whenever either is true.
  const canOfferWeekly = sessionRecurring || hasOtherInstances
  const end  = endTime(instance.start_time, instance.duration_minutes)
  const paid = bookings.filter(b => b.paid).length
  const [showEnroll, setShowEnroll] = useState(false)
  const [enrollForm, setEnrollForm] = useState({ name: '', email: '' })
  const [frequency, setFrequency]   = useState<'weekly' | 'once'>(canOfferWeekly ? 'weekly' : 'once')
  const [enrolling, setEnrolling]   = useState(false)
  const [enrollErr, setEnrollErr]   = useState<string | null>(null)
  const [contacts, setContacts]     = useState<Contact[]>([])
  const [nameQuery, setNameQuery]   = useState('')
  const [showDrop, setShowDrop]     = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [pausingId, setPausingId]   = useState<string | null>(null)
  const [pauseForm, setPauseForm]   = useState({ from: '', until: '', reason: '' })
  const [pauseErr, setPauseErr]     = useState<string | null>(null)
  const [notice, setNotice]         = useState<string | null>(null)

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
      body: JSON.stringify({ client_name: enrollForm.name, client_email: enrollForm.email || undefined, frequency }),
    })
    setEnrolling(false)
    if (res.ok) {
      const d = await res.json() as { booking: InstanceBooking; propagation: PropagationSummary }
      onEnroll(d.booking)
      setEnrollForm({ name: '', email: '' }); setNameQuery(''); setShowEnroll(false)
      const text = summaryText(d.propagation)
      setNotice(frequency === 'weekly' ? `Enrolled weekly.${text ? ' ' + text : ''}` : 'Enrolled.')
      if (d.propagation && (d.propagation.propagated > 0 || d.propagation.capacityBlocked > 0)) onRefresh()
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
        recurring_group_id: b.recurring_group_id,
      }),
    })
    if (res.ok) onRemoveFuture(b.id)
  }

  async function toggleRecurring(b: InstanceBooking) {
    const next = !b.is_recurring
    onToggleError(null, null)
    const res  = await fetch(`/api/dashboard/enrolments/${b.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_recurring: next }) })
    if (res.ok) {
      const d = await res.json() as { booking: { recurring_group_id: string | null }; propagation?: PropagationSummary; futureCancelled?: number }
      onBookingUpdate(b.id, { is_recurring: next, recurring_group_id: d.booking.recurring_group_id })
      if (next) {
        const text = summaryText(d.propagation ?? null)
        setNotice(`Switched to weekly.${text ? ' ' + text : ''}`)
        if (d.propagation && (d.propagation.propagated > 0 || d.propagation.capacityBlocked > 0)) onRefresh()
      } else {
        setNotice(d.futureCancelled ? `Switched to once. Removed ${d.futureCancelled} future session${d.futureCancelled === 1 ? '' : 's'}.` : 'Switched to once.')
        if (d.futureCancelled) onRefresh()
      }
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      onToggleError(b.id, d.error ?? 'Failed to update')
    }
  }

  async function submitPause(b: InstanceBooking) {
    if (!pauseForm.from || !pauseForm.until) { setPauseErr('Both dates are required'); return }
    setPauseErr(null)
    const res = await fetch(`/api/dashboard/enrolments/${b.id}/pause`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pause_from: pauseForm.from, pause_until: pauseForm.until, reason: pauseForm.reason || undefined }),
    })
    if (res.ok) {
      const d = await res.json() as { pause: { pause_from: string; pause_until: string }; cancelled: number; conflicts: { id: string; date: string }[] }
      onBookingUpdate(b.id, { active_pause_from: d.pause.pause_from, active_pause_until: d.pause.pause_until })
      setPausingId(null); setPauseForm({ from: '', until: '', reason: '' })
      setNotice(d.conflicts.length > 0
        ? `Paused. ${d.cancelled} session(s) removed. ${d.conflicts.length} could not be removed (already paid/attended) — review manually.`
        : `Paused ${d.pause.pause_from}–${d.pause.pause_until}. ${d.cancelled} session(s) removed.`)
      onRefresh()
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string }
      setPauseErr(d.error ?? 'Failed to pause')
    }
  }

  async function resumeEarly(b: InstanceBooking) {
    const res = await fetch(`/api/dashboard/enrolments/${b.id}/pause`, { method: 'DELETE' })
    if (res.ok) {
      const d = await res.json() as { propagation: PropagationSummary }
      onBookingUpdate(b.id, { active_pause_from: null, active_pause_until: null })
      const text = summaryText(d.propagation)
      setNotice(`Resumed weekly.${text ? ' ' + text : ''}`)
      onRefresh()
    }
  }

  const capClr = capacityColor(bookings.length, instance.max_capacity)

  return (
    <div style={{ marginTop: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{formatDateAU(instance.date)} · {instance.start_time}–{end}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: capClr }}>{bookings.length}/{instance.max_capacity} enrolled</span>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{paid}/{bookings.length} paid</span>
          <button onClick={() => { setShowEnroll(v => !v); setEnrollErr(null) }} style={{
            fontSize: 12, fontWeight: 600, padding: '5px 12px', borderRadius: 20, cursor: 'pointer',
            background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)',
            color: 'var(--brand-brainbase-accent)', fontFamily: FONT,
          }}>+ Enroll</button>
        </div>
      </div>

      {notice && (
        <div style={{ padding: '8px 20px', fontSize: 12, color: 'var(--brand-brainbase-accent)', background: 'var(--brand-brainbase-accent-muted)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNotice(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
        </div>
      )}

      {showEnroll && (
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 180, position: 'relative' }}>
            <label htmlFor={`enrol-search-${instance.id}`} style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Search Contact *</label>
            <input
              id={`enrol-search-${instance.id}`}
              style={inp}
              placeholder="Type a name to search…"
              value={nameQuery}
              autoComplete="off"
              onChange={e => { setNameQuery(e.target.value); setEnrollForm(f => ({ ...f, name: e.target.value })); setShowDrop(true) }}
              onFocus={() => setShowDrop(true)}
              onBlur={() => setTimeout(() => setShowDrop(false), 150)}
            />
            {showDrop && filtered.length > 0 && (
              <div role="listbox" aria-label="Matching contacts" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, background: 'var(--bg-overlay)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', marginTop: 2, overflow: 'hidden', boxShadow: 'var(--shadow-menu)' }}>
                {filtered.map(c => (
                  <div key={c.id} role="option" aria-selected={false} onMouseDown={() => selectContact(c)} style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13, color: 'var(--text-primary)', display: 'flex', flexDirection: 'column', gap: 2 }}
                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--brand-brainbase-accent-muted)')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    {c.email && <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.email}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 160 }}>
            <label htmlFor={`enrol-email-${instance.id}`} style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Email (optional)</label>
            <input id={`enrol-email-${instance.id}`} style={inp} placeholder="client@email.com" type="email" value={enrollForm.email} onChange={e => setEnrollForm(f => ({ ...f, email: e.target.value }))} />
          </div>
          {canOfferWeekly && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '.08em', textTransform: 'uppercase', marginBottom: 4 }}>Booking frequency</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {(['weekly', 'once'] as const).map(f => (
                  <button key={f} aria-pressed={frequency === f} onClick={() => setFrequency(f)} style={{
                    fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8, cursor: 'pointer', fontFamily: FONT,
                    background: frequency === f ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
                    border: `1px solid ${frequency === f ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                    color: frequency === f ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)',
                  }}>{f === 'weekly' ? '↻ Weekly' : 'Once'}</button>
                ))}
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => { setShowEnroll(false); setEnrollErr(null); setNameQuery('') }} style={{ fontSize: 12, fontWeight: 600, padding: '8px 14px', borderRadius: 8, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>Cancel</button>
            <button onClick={submitEnroll} disabled={!enrollForm.name.trim() || enrolling} style={{ fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8, cursor: 'pointer', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', color: 'var(--brand-brainbase-accent)', fontFamily: FONT, opacity: !enrollForm.name.trim() || enrolling ? .45 : 1 }}>{enrolling ? 'Enrolling…' : 'Confirm'}</button>
          </div>
          {enrollErr && <div style={{ width: '100%', fontSize: 12, color: 'var(--status-danger)' }}>{enrollErr}</div>}
        </div>
      )}

      {bookings.length === 0 ? (
        <div style={{ padding: '28px 20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No clients booked yet. Use + Enroll to add one.</div>
      ) : (
        <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', minWidth: 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
              {['Client', 'Email', 'Payment', 'Attendance', 'Recurring', ''].map(h => (
                <th key={h} style={{ padding: '10px 20px', fontSize: 10, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-muted)', textAlign: 'left' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bookings.map((b, i) => (
              <tr key={b.id} style={{ borderBottom: i < bookings.length - 1 ? '1px solid var(--border-light)' : 'none' }}>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 7 }}>
                    {b.client_name}
                    {b.is_recurring && (
                      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brand-brainbase-accent)', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', borderRadius: 20, padding: '1px 6px' }}>Recurring</span>
                    )}
                  </div>
                  {b.is_recurring && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>Applies to future sessions</div>
                  )}
                </td>
                <td style={{ padding: '12px 20px', fontSize: 12, color: 'var(--text-muted)' }}>{b.client_email ?? '—'}</td>
                <td style={{ padding: '12px 20px' }}>
                  <button onClick={() => togglePaid(b)} style={{
                    fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                    background: b.paid ? 'var(--status-success-muted)' : 'var(--bg-sunken)',
                    border: `1px solid ${b.paid ? 'var(--status-success-border)' : 'var(--border)'}`,
                    color: b.paid ? 'var(--status-success)' : 'var(--text-muted)',
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
                      background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)',
                    }}>Mark</button>
                  )}
                </td>
                <td style={{ padding: '12px 20px' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
                    <button onClick={() => toggleRecurring(b)} style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 12px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                      background: b.is_recurring ? 'var(--brand-brainbase-accent-muted)' : 'var(--bg-sunken)',
                      border: `1px solid ${b.is_recurring ? 'var(--brand-brainbase-accent-border)' : 'var(--border)'}`,
                      color: b.is_recurring ? 'var(--brand-brainbase-accent)' : 'var(--text-muted)',
                    }}>{b.is_recurring ? '↻ Weekly' : 'Once'}</button>
                    {toggleErrId === b.id && toggleErr && (
                      <div style={{ fontSize: 10, color: 'var(--status-danger)', maxWidth: 180 }}>{toggleErr}</div>
                    )}
                    {b.is_recurring && b.active_pause_from && b.active_pause_until && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--status-warning)', background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', borderRadius: 20, padding: '1px 6px' }}>
                          Paused {formatDateAU(b.active_pause_from)}–{formatDateAU(b.active_pause_until)}
                        </span>
                        <button onClick={() => resumeEarly(b)} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Resume early</button>
                      </div>
                    )}
                    {b.is_recurring && !b.active_pause_from && pausingId !== b.id && (
                      <button onClick={() => { setPausingId(b.id); setPauseErr(null) }} style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Pause</button>
                    )}
                    {pausingId === b.id && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 8, borderRadius: 8, background: 'var(--bg-surface)', border: '1px solid var(--border)', minWidth: 180 }}>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input type="date" aria-label="Pause from" value={pauseForm.from} onChange={e => setPauseForm(f => ({ ...f, from: e.target.value }))} style={{ ...inp, padding: '4px 6px', fontSize: 11 }} />
                          <input type="date" aria-label="Pause until" value={pauseForm.until} onChange={e => setPauseForm(f => ({ ...f, until: e.target.value }))} style={{ ...inp, padding: '4px 6px', fontSize: 11 }} />
                        </div>
                        <input aria-label="Pause reason (optional)" placeholder="Reason (optional)" value={pauseForm.reason} onChange={e => setPauseForm(f => ({ ...f, reason: e.target.value }))} style={{ ...inp, padding: '4px 6px', fontSize: 11 }} />
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button onClick={() => submitPause(b)} style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', color: 'var(--status-warning)' }}>Confirm pause</button>
                          <button aria-label="Cancel pause" onClick={() => { setPausingId(null); setPauseErr(null) }} style={{ fontSize: 10, padding: '4px 8px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>✕</button>
                        </div>
                        {pauseErr && <div style={{ fontSize: 10, color: 'var(--status-danger)' }}>{pauseErr}</div>}
                      </div>
                    )}
                  </div>
                </td>
                <td style={{ padding: '12px 20px' }}>
                  {removingId === b.id ? (
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        onClick={() => { removeBooking(b); setRemovingId(null) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)' }}
                      >This session</button>
                      <button
                        onClick={() => { removeFuture(b); setRemovingId(null) }}
                        style={{ fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)' }}
                      >All future</button>
                      <button
                        aria-label="Cancel remove"
                        onClick={() => setRemovingId(null)}
                        style={{ fontSize: 11, padding: '4px 8px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                      >✕</button>
                    </div>
                  ) : (
                    <button onClick={() => setRemovingId(b.id)} style={{
                      fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                      background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)',
                    }}>Remove</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
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
  const [calendarView, setCalendarView]             = useState<'week' | 'month'>('week')
  const [calendarAnchor, setCalendarAnchor]         = useState<Date>(() => new Date())
  const [calendarInstances, setCalendarInstances]   = useState<WeekInstance[]>([])
  const [calendarLoading, setCalendarLoading]       = useState(true)
  const [confirmDel, setConfirmDel]                 = useState(false)
  const [deleteErr, setDeleteErr]                   = useState<string | null>(null)
  const [repairNote, setRepairNote]                 = useState<string | null>(null)
  const [reconcileWarning, setReconcileWarning]     = useState<string | null>(null)
  const [toggleErrId, setToggleErrId]               = useState<string | null>(null)
  const [toggleErr, setToggleErr]                   = useState<string | null>(null)
  const [sessionTypes, setSessionTypes]             = useState<SessionTypeRow[]>([])
  const [showManageTypes, setShowManageTypes]       = useState(false)
  const [showManageSessions, setShowManageSessions] = useState(false)

  const loadSessionTypes = useCallback(() => {
    fetch('/api/dashboard/session-types?include_archived=1').then(r => r.json()).then(d => setSessionTypes(d.types ?? [])).catch(() => null)
  }, [])

  // Bounded to the currently visible week/month range — never fetches all
  // history. Navigating (Prev/Today/Next, Week|Month) only ever re-reads
  // already-scheduled session_instances rows; it never generates or
  // mutates them.
  const loadCalendar = useCallback((anchor: Date, view: 'week' | 'month') => {
    const range = view === 'week' ? getWeekRange(anchor) : getMonthGridRange(anchor)
    fetch(`${API}/instances?date_from=${toDateStr(range.start)}&date_to=${toDateStr(range.end)}`)
      .then(r => r.json())
      .then(d => setCalendarInstances(d.instances ?? []))
      .catch(() => setCalendarInstances([]))
      .finally(() => setCalendarLoading(false))
  }, [])

  useEffect(() => {
    loadCalendar(calendarAnchor, calendarView)
  }, [calendarAnchor, calendarView, loadCalendar])

  useEffect(() => {
    const today = todayStr()

    Promise.all([
      fetch(`${API}?include_archived=1`).then(r => r.json()),
      fetch(`${API}/instances`).then(r => r.json()),
    ]).then(([sessData, instData]) => {
      const loadedSessions: Session[] = sessData.sessions ?? []
      const loadedInstances: WeekInstance[] = instData.instances ?? []
      setSessions(loadedSessions)
      setLoading(false)

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
        )).catch(() => null)
      }
    }).catch(() => setLoading(false))

    fetch('/api/contacts').then(r => r.json()).then(d => setContacts(d.contacts ?? [])).catch(() => null)
    loadSessionTypes()
  }, [loadSessionTypes])

  // The one automatic top-up trigger for Ongoing schedules: an explicit,
  // authenticated, awaited POST called once on page entry — never an
  // unawaited write inside GET /api/dashboard/sessions (a fire-and-forget
  // write there was rejected: a serverless request can be frozen/recycled
  // the instant the response is sent, before the write actually lands, and
  // a GET mutating state at all is surprising for anything that might
  // refetch/prefetch/cache it later). Failure here must not make the
  // dashboard unusable — sessions/calendar data already loaded by the
  // effect above is left exactly as it is; "Repair future dates" remains
  // available per-session as a manual fallback.
  useEffect(() => {
    fetch(`${API}/reconcile`, { method: 'POST' })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`reconcile failed (${r.status})`)))
      .then((result: ReconcileAllSummary) => {
        if (result.errors.length > 0) {
          setReconcileWarning(`Automatic schedule check had ${result.errors.length} error${result.errors.length === 1 ? '' : 's'} for some classes — use "Repair future dates" on those sessions if their calendar looks out of date.`)
        }
        if (result.totalGenerated > 0 || result.totalReactivated > 0 || result.totalCancelledInstances > 0) {
          fetch(`${API}?include_archived=1`).then(r => r.json()).then(d => setSessions(d.sessions ?? [])).catch(() => null)
          loadCalendar(calendarAnchor, calendarView)
        }
      })
      .catch(() => setReconcileWarning('Could not run the automatic schedule check. Existing sessions and dates below are unaffected — use "Repair future dates" on a session if it looks out of date.'))
    // Deliberately mount-only: this refreshes the calendar range that was
    // showing when the page loaded, using calendarAnchor/calendarView's
    // initial values — not a dependency this should re-run for on every
    // Prev/Next/Week|Month click.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCalendar])

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
            loadCalendar(calendarAnchor, calendarView)
          })
          .catch(() => null)
      }
    }
  }, [loadCalendar, calendarAnchor, calendarView])

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

  // Single shared refresh path for every recurrence-related mutation
  // (initial Weekly/Once enrolment, Once<->Weekly toggle, Pause, Resume,
  // Remove future) — refetches from the server rather than hand-patching
  // local counts, and preserves the currently selected session/date instead
  // of collapsing the roster panel back to the date picker.
  function refreshDashboard() {
    fetch(`${API}?include_archived=1`).then(r => r.json()).then(d => setSessions(d.sessions ?? [])).catch(() => null)
    if (selectedSessionId) {
      fetch(`${API}/${selectedSessionId}`).then(r => r.json()).then(d => { if (d.instances) setInstances(d.instances) }).catch(() => null)
      if (selectedInstanceId) loadRoster(selectedSessionId, selectedInstanceId)
    }
    loadCalendar(calendarAnchor, calendarView)
  }

  function calendarPrev() { setCalendarLoading(true); setCalendarAnchor(a => calendarView === 'week' ? addWeeks(a, -1) : addMonths(a, -1)) }
  function calendarNext() { setCalendarLoading(true); setCalendarAnchor(a => calendarView === 'week' ? addWeeks(a, 1) : addMonths(a, 1)) }
  function calendarToday() { setCalendarLoading(true); setCalendarAnchor(new Date()) }
  function setCalendarViewAndReload(view: 'week' | 'month') { setCalendarLoading(true); setCalendarView(view) }

  async function generateInstances() {
    if (!selectedSessionId || generating) return
    setGenerating(true); setRepairNote(null)
    const result = await repairSession(selectedSessionId)
    setGenerating(false)
    if (result) {
      setInstances(result.instances ?? [])
      loadCalendar(calendarAnchor, calendarView)
      setRepairNote(formatRepairNote(result.reconcile))
    }
  }

  function handleBookingUpdate(bookingId: string, patch: Partial<InstanceBooking>) {
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.map(b => b.id === bookingId ? { ...b, ...patch } : b) } : d)
  }

  function handleRemove(bookingId: string) {
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.filter(b => b.id !== bookingId) } : d)
    refreshDashboard()
  }

  function handleRemoveFuture(bookingId: string) {
    // Clear recurring flag on the current booking — it stays, just won't propagate
    setInstanceDetail(d => d ? { ...d, bookings: d.bookings.map(b => b.id === bookingId ? { ...b, is_recurring: false } : b) } : d)
    refreshDashboard()
  }

  function handleCreate(s: Session) {
    setSessions(prev => [...prev, s].sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    setTimeout(() => loadCalendar(calendarAnchor, calendarView), 1500)
  }

  function handleSave(updated: Session) {
    setSessions(prev => prev.map(s => s.id === updated.id ? updated : s).sort((a, b) => a.day_of_week !== b.day_of_week ? a.day_of_week - b.day_of_week : a.start_time.localeCompare(b.start_time)))
    loadCalendar(calendarAnchor, calendarView)
  }

  async function handleDelete(id: string) {
    setDeleteErr(null)
    const res = await fetch(`${API}/${id}`, { method: 'DELETE' })
    if (res.ok) {
      setSessions(prev => prev.filter(s => s.id !== id))
      setSelectedSessionId(null); setInstances([]); setSelectedInstanceId(null); setInstanceDetail(null)
      setConfirmDel(false)
      loadCalendar(calendarAnchor, calendarView)
    } else {
      const errData = await res.json().catch(() => ({})) as { error?: string }
      setDeleteErr(errData.error ?? 'Failed to delete session')
      setConfirmDel(false)
    }
  }

  // Retires a session template in place (row stays in `sessions`, just
  // gains archived_at) rather than removing it — Manage Sessions' "Show
  // archived" toggle is what makes it visible/invisible, matching how
  // Manage Types already treats an archived session type. Refreshes the
  // calendar since archiving may have cancelled future instances.
  async function handleArchive(id: string): Promise<{ cancelledInstances: number; conflicts: { instanceId: string; date: string }[] } | null> {
    const res = await fetch(`${API}/${id}/archive`, { method: 'POST' })
    if (!res.ok) return null
    const d = await res.json() as { archived: boolean; cancel: { cancelledInstances: number; conflicts: { instanceId: string; date: string }[] } }
    setSessions(prev => prev.map(s => s.id === id ? { ...s, archived_at: new Date().toISOString() } : s))
    loadCalendar(calendarAnchor, calendarView)
    return d.cancel
  }

  // Un-retires a session and immediately re-reconciles it, restoring its
  // future horizon from its existing (untouched) schedule rules.
  async function handleRestore(id: string): Promise<ReconcileSummary | null> {
    const res = await fetch(`${API}/${id}/restore`, { method: 'POST' })
    if (!res.ok) return null
    const d = await res.json() as { restored: boolean; reconcile: ReconcileSummary }
    setSessions(prev => prev.map(s => s.id === id ? { ...s, archived_at: null } : s))
    loadCalendar(calendarAnchor, calendarView)
    return d.reconcile
  }

  // `sessions` is fetched with include_archived=1 (mirrors sessionTypes'
  // own always-fetch-everything pattern) so a historical calendar entry
  // belonging to an archived session can still resolve its detail panel —
  // never filter that lookup. Operational aggregates (revenue, the header
  // count, the empty-state check) are "what's actually running" views, so
  // they use activeSessions instead.
  const activeSessions         = sessions.filter(s => !s.archived_at)
  const selectedSession        = sessions.find(s => s.id === selectedSessionId) ?? null
  const weeklyRevenue          = activeSessions.reduce((sum, s) => sum + sessionRevenue(s.price_per_session ?? 0, s.session_type, s.enrolled_count), 0)
  const selRevenue             = selectedSession ? sessionRevenue(selectedSession.price_per_session ?? 0, selectedSession.session_type, selectedSession.enrolled_count) : 0
  // PLAYERS / FILL RATE describe the currently selected instance/date, not
  // a session-wide aggregate — selectedSession.enrolled_count is the
  // unique-roster-across-all-instances count (correct for the session
  // card in the list above), which is a different metric and was
  // incorrectly reused here. Fall back to the session-level figure only
  // when no specific date is selected yet.
  const selectedCapacity       = instanceDetail ? instanceDetail.instance.max_capacity : (selectedSession?.max_capacity ?? 0)
  const selectedPlayers        = instanceDetail ? instanceDetail.bookings.length : (selectedSession?.enrolled_count ?? 0)
  const selCapClr              = selectedSession ? capacityColor(selectedPlayers, selectedCapacity) : 'var(--status-success)'
  const selUtilisation         = selectedCapacity > 0 ? Math.round(selectedPlayers / selectedCapacity * 100) : 0
  const instancesTotalRevenue  = instances.reduce((sum, i) => sum + (i.revenue ?? 0), 0)
  const paidCount              = instanceDetail ? instanceDetail.bookings.filter(b => b.paid).length : null

  const lbl10: React.CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '.08em',
    textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4,
  }

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', padding: '32px 16px', fontFamily: FONT, color: 'var(--text-primary)', minWidth: 0 }}>
      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreate={handleCreate} sessionTypes={sessionTypes} onManageTypes={() => setShowManageTypes(true)} />}
      {editingSession && <EditModal session={editingSession} onClose={() => setEditingSession(null)} onSave={handleSave} sessionTypes={sessionTypes} onManageTypes={() => setShowManageTypes(true)} />}
      {showManageTypes && <ManageSessionTypesModal types={sessionTypes} onClose={() => setShowManageTypes(false)} onChanged={loadSessionTypes} />}
      {showManageSessions && (
        <ManageSessionsModal
          sessions={sessions} sessionTypes={sessionTypes} contacts={contacts}
          onClose={() => setShowManageSessions(false)}
          onEdit={s => { setShowManageSessions(false); setEditingSession(s) }}
          onDelete={handleDelete}
          onArchive={handleArchive}
          onRestore={handleRestore}
          onRepaired={() => { fetch(`${API}?include_archived=1`).then(r => r.json()).then(d => setSessions(d.sessions ?? [])).catch(() => null); loadCalendar(calendarAnchor, calendarView) }}
        />
      )}

      {/* ── Page header ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0, letterSpacing: '-.02em' }}>Sessions</h1>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {activeSessions.length} session{activeSessions.length !== 1 ? 's' : ''} · click a date below to view its roster
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => setShowManageSessions(true)} style={{
            fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 20, cursor: 'pointer',
            background: 'var(--bg-sunken)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontFamily: FONT,
          }}>Manage sessions</button>
          <button onClick={() => setShowCreate(true)} style={{
            fontSize: 13, fontWeight: 600, padding: '8px 18px', borderRadius: 20, cursor: 'pointer',
            background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)',
            color: 'var(--brand-brainbase-accent)', fontFamily: FONT,
          }}>+ New Session</button>
        </div>
      </div>

      {!loading && sessions.length === 0 && (
        <div style={{ marginTop: 20, border: '1px dashed var(--border)', borderRadius: 14, padding: '48px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
          No sessions yet.{' '}
          <button onClick={() => setShowCreate(true)} style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0 }}>
            Create your first session →
          </button>
        </div>
      )}

      {/* Non-destructive: the automatic schedule check failing (or partially
          failing) never hides already-loaded sessions/calendar data below —
          it only surfaces this dismissible note and points at the manual
          "Repair future dates" fallback. */}
      {reconcileWarning && (
        <div style={{ marginTop: 16, padding: '10px 16px', borderRadius: 10, background: 'var(--status-warning-muted)', border: '1px solid var(--status-warning-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--status-warning)' }}>{reconcileWarning}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setReconcileWarning(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13, flexShrink: 0 }}>✕</button>
        </div>
      )}

      {/* ── Calendar: the ONE primary scheduling surface ────────────────────
          Week/Month navigation over already-scheduled session_instances rows.
          Read-only — never generates, mutates, or propagates anything. */}
      {loading ? (
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading…</div>
      ) : sessions.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {/* Summary / controls row: Weekly Revenue (left) · Prev/Today/Next + Week|Month (right) */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            {weeklyRevenue > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--text-secondary)' }}>Weekly Revenue</span>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.02em' }}>{fmtMoney(weeklyRevenue)}</span>
              </div>
            ) : <div />}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={calendarPrev} style={navBtn}>‹ Prev</button>
                <button onClick={calendarToday} style={navBtn}>Today</button>
                <button onClick={calendarNext} style={navBtn}>Next ›</button>
              </div>
              <div style={{ display: 'flex', gap: 2, background: 'var(--bg-sunken)', border: '1px solid var(--border)', borderRadius: 20, padding: 2 }}>
                <button aria-pressed={calendarView === 'week'} onClick={() => setCalendarViewAndReload('week')} style={toggleBtn(calendarView === 'week')}>Week</button>
                <button aria-pressed={calendarView === 'month'} onClick={() => setCalendarViewAndReload('month')} style={toggleBtn(calendarView === 'month')}>Month</button>
              </div>
            </div>
          </div>

          {/* Date heading (left) — already carried by the controls row above on desktop; shown here for the calendar itself */}
          <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12 }}>
            {calendarView === 'week' ? formatWeekHeading(getWeekRange(calendarAnchor)) : formatMonthHeading(calendarAnchor)}
          </div>

          {calendarLoading ? (
            <div style={{ padding: '24px 0', color: 'var(--text-muted)', fontSize: 13 }}>Loading calendar…</div>
          ) : (
            <div style={{ overflowX: 'auto', paddingBottom: 4 }}>
              {calendarView === 'week' ? (
                <WeekGrid range={getWeekRange(calendarAnchor)} instances={calendarInstances} selectedInstanceId={selectedInstanceId} sessionTypes={sessionTypes} onSelectInstance={selectInstance} />
              ) : (
                <MonthGrid range={getMonthGridRange(calendarAnchor)} monthAnchor={calendarAnchor} instances={calendarInstances} selectedInstanceId={selectedInstanceId} sessionTypes={sessionTypes} onSelectInstance={selectInstance} />
              )}
            </div>
          )}
        </div>
      )}

      {selectedSessionId && selectedSession && (
        <div style={{ marginTop: 32, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>

          {/* Session header + actions */}
          <div style={{ padding: '16px 22px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 10, height: 10, borderRadius: 3, background: sessionColourDot(selectedSession.session_type, sessionTypes, selectedSession.session_colour_key), flexShrink: 0 }} />
                {sessionLabel(selectedSession.session_type, sessionTypes)}
              </div>
              {optionalLabel(selectedSession.name, selectedSession.session_type, sessionTypes) && (
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>
                  {optionalLabel(selectedSession.name, selectedSession.session_type, sessionTypes)}
                </div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {DAY_FULL[selectedSession.day_of_week]} · {selectedSession.start_time}–{endTime(selectedSession.start_time, selectedSession.duration_minutes)}
                {selectedSession.resource_id && <><span>·</span><span>📍 {selectedSession.resource_id}</span></>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>Schedule: {scheduleSummary(selectedSession)}</span>
                <button onClick={() => setEditingSession(selectedSession)} style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 12, fontFamily: FONT, padding: 0, textDecoration: 'underline' }}>Edit schedule</button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexShrink: 0, alignItems: 'center', flexWrap: 'wrap' }}>
              <button onClick={generateInstances} disabled={generating} title="Force-reconcile future dates now, without waiting for the next automatic check" style={{ fontSize: 11, fontWeight: 600, padding: '5px 10px', borderRadius: 20, cursor: generating ? 'not-allowed' : 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT, opacity: generating ? .5 : 1 }}>{generating ? 'Repairing…' : 'Repair future dates'}</button>
              <button onClick={() => setEditingSession(selectedSession)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', background: 'var(--bg-sunken)', border: '1px solid var(--border)', color: 'var(--text-secondary)', fontFamily: FONT }}>Edit</button>
              {confirmDel ? (
                <>
                  <button onClick={() => handleDelete(selectedSession.id)} style={{ fontSize: 12, fontWeight: 700, padding: '6px 14px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)', fontFamily: FONT }}>Confirm delete</button>
                  <button onClick={() => setConfirmDel(false)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 10px', borderRadius: 20, cursor: 'pointer', background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)', fontFamily: FONT }}>Cancel</button>
                </>
              ) : (
                <button onClick={() => setConfirmDel(true)} style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', background: 'var(--status-danger-muted)', border: '1px solid var(--status-danger-border)', color: 'var(--status-danger)', fontFamily: FONT }}>Delete</button>
              )}
            </div>
          </div>
          {deleteErr && <div style={{ padding: '8px 22px', fontSize: 12, color: 'var(--status-danger)', background: 'var(--status-danger-muted)', borderBottom: '1px solid var(--status-danger-border)' }}>{deleteErr}</div>}
          {repairNote && (
            <div style={{ padding: '8px 22px', fontSize: 12, color: 'var(--brand-brainbase-accent)', background: 'var(--brand-brainbase-accent-muted)', borderBottom: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{repairNote}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setRepairNote(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 13 }}>✕</button>
            </div>
          )}

          {/* Stats: players · fill rate · revenue · instances total · paid */}
          <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border-light)', display: 'flex', gap: 32, flexWrap: 'wrap' }}>
            <div>
              <div style={lbl10}>Players{instanceDetail ? ' (this date)' : ''}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: selCapClr, letterSpacing: '-.02em' }}>
                {selectedPlayers}
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>/{selectedCapacity}</span>
              </div>
            </div>
            <div>
              <div style={lbl10}>Fill Rate</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: selCapClr, letterSpacing: '-.02em' }}>{selUtilisation}%</div>
            </div>
            {selRevenue > 0 && (
              <div>
                <div style={lbl10}>Per Session</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-.02em' }}>{fmtMoney(selRevenue)}</div>
              </div>
            )}
            {instancesTotalRevenue > 0 && (
              <div>
                <div style={lbl10}>6-Week Revenue</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--status-success)', letterSpacing: '-.02em' }}>{fmtMoney(instancesTotalRevenue)}</div>
              </div>
            )}
            {paidCount !== null && instanceDetail && (
              <div>
                <div style={lbl10}>Paid (this date)</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--status-success)', letterSpacing: '-.02em' }}>
                  {paidCount}
                  <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)' }}>/{instanceDetail.bookings.length}</span>
                </div>
              </div>
            )}
          </div>

          {/* Upcoming date chips */}
          {instancesLoading ? (
            <div style={{ padding: '24px 22px', color: 'var(--text-muted)', fontSize: 13 }}>Loading dates…</div>
          ) : instances.length === 0 ? (
            <div style={{ padding: '28px 22px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              No dates yet.{' '}
              <button onClick={generateInstances} style={{ background: 'none', border: 'none', color: 'var(--brand-brainbase-accent)', cursor: 'pointer', fontSize: 13, fontFamily: FONT, padding: 0 }}>Generate →</button>
            </div>
          ) : (
            <div style={{ padding: '12px 22px', borderBottom: '1px solid var(--border-light)' }}>
              <div style={lbl10}>Upcoming Dates</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {instances.map(inst => {
                  const sel    = selectedInstanceId === inst.id
                  const today_ = isToday(inst.date)
                  const capC   = capacityColor(inst.enrolled_count, inst.max_capacity)
                  return (
                    <button key={inst.id} aria-pressed={sel} onClick={() => loadRoster(selectedSessionId, inst.id)}
                      style={{
                        padding: '6px 13px', borderRadius: 20, cursor: 'pointer', fontFamily: FONT,
                        display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: sel ? 'var(--brand-brainbase-accent-muted)' : today_ ? 'color-mix(in srgb, var(--text-primary) 7%, transparent)' : 'var(--bg-sunken)',
                        border: `1px solid ${sel ? 'var(--brand-brainbase-accent-border)' : today_ ? 'var(--border-strong)' : 'var(--border)'}`,
                        color: sel ? 'var(--brand-brainbase-accent)' : today_ ? 'var(--text-primary)' : 'var(--text-secondary)',
                      }}>
                      <span style={{ fontSize: 12, fontWeight: today_ ? 700 : 500 }}>{formatDateAU(inst.date)}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: sel ? 'var(--brand-brainbase-accent)' : capC }}>{inst.enrolled_count}/{inst.max_capacity}</span>
                      {inst.revenue > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--status-success)' }}>${inst.revenue}</span>}
                      {today_ && <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--brand-brainbase-accent)', background: 'var(--brand-brainbase-accent-muted)', border: '1px solid var(--brand-brainbase-accent-border)', borderRadius: 20, padding: '1px 5px' }}>Today</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Roster — stacked below dates */}
          {!selectedInstanceId && !instancesLoading && instances.length > 0 ? (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
              ↑ Select a date above to view the roster
            </div>
          ) : rosterLoading ? (
            <div style={{ padding: '32px 22px', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>Loading roster…</div>
          ) : instanceDetail ? (
            <InstanceRoster
              key={instanceDetail.instance.id}
              detail={instanceDetail}
              sessionRecurring={selectedSession?.recurring ?? false}
              hasOtherInstances={instances.some(i => i.id !== instanceDetail.instance.id)}
              onBookingUpdate={handleBookingUpdate}
              onRemove={handleRemove}
              onRemoveFuture={handleRemoveFuture}
              onRefresh={refreshDashboard}
              toggleErrId={toggleErrId}
              toggleErr={toggleErr}
              onToggleError={(id, message) => { setToggleErrId(id); setToggleErr(message) }}
              onEnroll={b => {
                setInstanceDetail(d => d ? { ...d, bookings: [...d.bookings, b] } : d)
                refreshDashboard()
              }}
            />
          ) : null}

        </div>
      )}
    </div>
  )
}
