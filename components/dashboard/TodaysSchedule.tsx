import Link from 'next/link'
import { sessionLabel, optionalLabel, sessionColourDot, type SessionTypeRow } from '@/lib/sessionDisplay'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

export type TodaySessionInstance = {
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
  session_colour_key: string | null
  enrolled_count: number
}

type Props = {
  instances: TodaySessionInstance[]
  sessionTypes: SessionTypeRow[]
}

// Small, local time-math helper — mirrors the identical private endTime()
// already used the same way in app/dashboard/sessions/page.tsx. Not shared
// via lib/ since it's a trivial one-line computation, not the
// title/colour-resolution logic that genuinely must not be duplicated
// (see lib/sessionDisplay.ts, used below instead of reimplementing it).
function endTime(start: string, durationMinutes: number): string {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + durationMinutes
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

function capacityColor(enrolled: number, max: number): string {
  if (max <= 0) return 'rgba(255,255,255,.35)'
  const pct = enrolled / max
  if (pct >= 1) return '#f87171'
  if (pct >= 0.75) return '#fbbf24'
  return '#4ade80'
}

export default function TodaysSchedule({ instances, sessionTypes }: Props) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.04)',
      border: '1px solid rgba(255,255,255,.14)',
      borderRadius: 14, overflow: 'hidden',
      fontFamily: FONT,
    }}>
      <div style={{
        padding: '14px 22px',
        borderBottom: '1px solid rgba(255,255,255,.07)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.40)' }}>
          Today&apos;s Schedule
        </span>
        <Link href="/dashboard/sessions" style={{ fontSize: 11, color: 'rgba(129,140,248,.65)', textDecoration: 'none', fontWeight: 600 }}>
          View Sessions →
        </Link>
      </div>

      {instances.length === 0 ? (
        <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.18)', fontSize: 12, lineHeight: 1.7 }}>
          No sessions scheduled today
        </div>
      ) : (
        <div>
          {instances.map((inst, i) => {
            const title  = sessionLabel(inst.session_type, sessionTypes)
            const label  = optionalLabel(inst.session_name, inst.session_type, sessionTypes)
            // Single shared resolver — session override, then Session Type
            // colour, then a neutral fallback. Never re-derived here.
            const colour = sessionColourDot(inst.session_type, sessionTypes, inst.session_colour_key)
            const isLast = i === instances.length - 1
            const capClr = capacityColor(inst.enrolled_count, inst.max_capacity)
            return (
              <div
                key={inst.id}
                style={{
                  padding: '12px 22px',
                  borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.06)',
                  borderLeft: `3px solid ${colour}`,
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <div style={{ width: 84, flexShrink: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#F5F7FA' }}>{inst.start_time}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.32)' }}>–{endTime(inst.start_time, inst.duration_minutes)}</div>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,.32)', marginTop: 2, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {label && <span>{label}</span>}
                    {inst.resource_id && <span>{label ? '· ' : ''}{inst.resource_id}</span>}
                  </div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: capClr, flexShrink: 0 }}>
                  {inst.enrolled_count}/{inst.max_capacity}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
