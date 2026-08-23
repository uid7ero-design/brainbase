import Link from 'next/link'
import {
  sessionLabel,
  optionalLabel,
  sessionColourDot,
  type SessionTypeRow,
} from '@/lib/sessionDisplay'

const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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

function endTime(start: string, durationMinutes: number): string {
  const [h, m] = start.split(':').map(Number)
  const total = h * 60 + m + durationMinutes

  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(
    total % 60
  ).padStart(2, '0')}`
}

function capacityMeta(
  enrolled: number,
  max: number
): {
  color: string
  bg: string
  border: string
  label: string
  pct: number
} {
  if (max <= 0) {
    return {
      color: 'rgba(255,255,255,.40)',
      bg: 'rgba(255,255,255,.04)',
      border: 'rgba(255,255,255,.08)',
      label: 'Open',
      pct: 0,
    }
  }

  const pct = Math.min((enrolled / max) * 100, 100)

  if (enrolled >= max) {
    return {
      color: '#f87171',
      bg: 'rgba(248,113,113,.08)',
      border: 'rgba(248,113,113,.18)',
      label: 'Full',
      pct,
    }
  }

  if (pct >= 75) {
    return {
      color: '#fbbf24',
      bg: 'rgba(251,191,36,.08)',
      border: 'rgba(251,191,36,.18)',
      label: 'Filling',
      pct,
    }
  }

  return {
    color: '#4ade80',
    bg: 'rgba(34,197,94,.07)',
    border: 'rgba(34,197,94,.16)',
    label: 'Available',
    pct,
  }
}

function formatTime(time: string): string {
  const [hourString, minute] = time.split(':')
  const hour = Number(hourString)

  if (Number.isNaN(hour)) return time

  const suffix = hour >= 12 ? 'pm' : 'am'
  const displayHour = hour % 12 || 12

  return `${displayHour}:${minute}${suffix}`
}

export default function TodaysSchedule({
  instances,
  sessionTypes,
}: Props) {
  return (
    <section className="bb-schedule-panel">
      <div className="bb-schedule-header">
        <div>
          <div className="bb-schedule-eyebrow">Sessions</div>

          <div className="bb-schedule-title">
            Today&apos;s Schedule
          </div>
        </div>

        <div className="bb-schedule-header-right">
          {instances.length > 0 && (
            <span className="bb-session-count">
              {instances.length}{' '}
              {instances.length === 1 ? 'session' : 'sessions'}
            </span>
          )}

          <Link
            href="/dashboard/sessions"
            className="bb-schedule-link"
          >
            View Sessions
            <span>→</span>
          </Link>
        </div>
      </div>

      {instances.length === 0 ? (
        <div className="bb-schedule-empty">
          <div className="bb-schedule-empty-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M16 3v4M8 3v4M3 10h18" />
              <path d="M9 15h6" />
            </svg>
          </div>

          <div className="bb-schedule-empty-title">
            Clear schedule today
          </div>

          <div className="bb-schedule-empty-copy">
            No coaching sessions are currently scheduled for today.
          </div>

          <Link
            href="/dashboard/sessions"
            className="bb-schedule-empty-action"
          >
            Open session calendar
            <span>→</span>
          </Link>
        </div>
      ) : (
        <div className="bb-session-list">
          {instances.map((instance, index) => {
            const title = sessionLabel(
              instance.session_type,
              sessionTypes
            )

            const label = optionalLabel(
              instance.session_name,
              instance.session_type,
              sessionTypes
            )

            const colour = sessionColourDot(
              instance.session_type,
              sessionTypes,
              instance.session_colour_key
            )

            const capacity = capacityMeta(
              instance.enrolled_count,
              instance.max_capacity
            )

            return (
              <Link
                key={instance.id}
                href={`/dashboard/sessions`}
                className={`bb-session-row ${
                  index === instances.length - 1
                    ? 'bb-session-row-last'
                    : ''
                }`}
                style={
                  {
                    '--session-colour': colour,
                  } as React.CSSProperties
                }
              >
                <div
                  className="bb-session-accent"
                  style={{
                    background: colour,
                    boxShadow: `0 0 14px ${colour}45`,
                  }}
                />

                <div className="bb-session-time">
                  <div className="bb-session-start">
                    {formatTime(instance.start_time)}
                  </div>

                  <div className="bb-session-end">
                    to{' '}
                    {formatTime(
                      endTime(
                        instance.start_time,
                        instance.duration_minutes
                      )
                    )}
                  </div>
                </div>

                <div
                  className="bb-session-icon"
                  style={{
                    color: colour,
                    background: `${colour}0d`,
                    borderColor: `${colour}22`,
                  }}
                >
                  <svg
                    width="17"
                    height="17"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                  >
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </div>

                <div className="bb-session-copy">
                  <div className="bb-session-name">
                    {title}
                  </div>

                  <div className="bb-session-meta">
                    {label && (
                      <span className="bb-session-meta-item">
                        {label}
                      </span>
                    )}

                    {instance.resource_id && (
                      <>
                        {label && (
                          <span className="bb-session-divider">
                            •
                          </span>
                        )}

                        <span className="bb-session-meta-item">
                          {instance.resource_id}
                        </span>
                      </>
                    )}

                    <span className="bb-session-divider">
                      •
                    </span>

                    <span className="bb-session-meta-item">
                      {instance.duration_minutes} min
                    </span>
                  </div>
                </div>

                <div className="bb-capacity-wrap">
                  <div className="bb-capacity-top">
                    <span className="bb-capacity-number">
                      {instance.enrolled_count}/
                      {instance.max_capacity}
                    </span>

                    <span
                      className="bb-capacity-status"
                      style={{
                        color: capacity.color,
                        background: capacity.bg,
                        borderColor: capacity.border,
                      }}
                    >
                      {capacity.label}
                    </span>
                  </div>

                  <div className="bb-capacity-track">
                    <div
                      className="bb-capacity-fill"
                      style={{
                        width: `${capacity.pct}%`,
                        background: capacity.color,
                        boxShadow: `0 0 8px ${capacity.color}35`,
                      }}
                    />
                  </div>
                </div>

                <span className="bb-session-arrow">
                  →
                </span>
              </Link>
            )
          })}
        </div>
      )}

      <style>{`
        .bb-schedule-panel {
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.028);
          font-family: ${FONT};
        }

        .bb-schedule-header {
          min-height: 54px;
          padding: 12px 20px;
          border-bottom: 1px solid rgba(255,255,255,.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .bb-schedule-eyebrow {
          font-size: 7px;
          font-weight: 750;
          letter-spacing: .12em;
          color: rgba(167,139,250,.52);
          text-transform: uppercase;
          margin-bottom: 3px;
        }

        .bb-schedule-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: rgba(255,255,255,.48);
        }

        .bb-schedule-header-right {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .bb-session-count {
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid rgba(255,255,255,.06);
          background: rgba(255,255,255,.03);
          color: rgba(255,255,255,.28);
          font-size: 8px;
          font-weight: 650;
        }

        .bb-schedule-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          font-size: 10px;
          color: rgba(167,139,250,.62);
          text-decoration: none;
          font-weight: 600;
          transition: color .16s ease;
        }

        .bb-schedule-link:hover {
          color: #c4b5fd;
        }

        .bb-schedule-empty {
          min-height: 220px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
          padding: 30px 22px;
        }

        .bb-schedule-empty-icon {
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
          border-radius: 11px;
          border: 1px solid rgba(139,92,246,.16);
          background: rgba(139,92,246,.065);
          color: rgba(167,139,250,.68);
        }

        .bb-schedule-empty-title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          color: rgba(245,247,250,.72);
        }

        .bb-schedule-empty-copy {
          max-width: 270px;
          font-size: 10.5px;
          line-height: 1.55;
          color: rgba(255,255,255,.27);
        }

        .bb-schedule-empty-action {
          margin-top: 13px;
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 7px 11px;
          border-radius: 8px;
          border: 1px solid rgba(139,92,246,.18);
          background: rgba(139,92,246,.075);
          color: rgba(196,181,253,.72);
          text-decoration: none;
          font-size: 9px;
          font-weight: 650;
          transition:
            background .16s ease,
            color .16s ease,
            transform .16s ease;
        }

        .bb-schedule-empty-action:hover {
          transform: translateY(-1px);
          background: rgba(139,92,246,.12);
          color: #c4b5fd;
        }

        .bb-session-list {
          display: flex;
          flex-direction: column;
        }

        .bb-session-row {
          position: relative;
          min-height: 76px;
          display: flex;
          align-items: center;
          gap: 13px;
          padding: 11px 18px 11px 20px;
          border-bottom: 1px solid rgba(255,255,255,.045);
          text-decoration: none;
          transition:
            background .16s ease,
            border-color .16s ease;
        }

        .bb-session-row:hover {
          background: rgba(255,255,255,.025);
        }

        .bb-session-row-last {
          border-bottom: 0;
        }

        .bb-session-accent {
          position: absolute;
          left: 0;
          top: 13px;
          bottom: 13px;
          width: 2px;
          border-radius: 0 999px 999px 0;
        }

        .bb-session-time {
          width: 72px;
          flex-shrink: 0;
        }

        .bb-session-start {
          font-size: 12px;
          line-height: 1.25;
          font-weight: 700;
          color: rgba(245,247,250,.88);
        }

        .bb-session-end {
          margin-top: 3px;
          font-size: 8.5px;
          line-height: 1.2;
          color: rgba(255,255,255,.27);
        }

        .bb-session-icon {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: 9px;
        }

        .bb-session-copy {
          flex: 1;
          min-width: 0;
        }

        .bb-session-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          line-height: 1.3;
          font-weight: 600;
          color: rgba(245,247,250,.9);
        }

        .bb-session-meta {
          margin-top: 5px;
          display: flex;
          align-items: center;
          gap: 5px;
          flex-wrap: wrap;
          font-size: 9px;
          line-height: 1.3;
          color: rgba(255,255,255,.28);
        }

        .bb-session-divider {
          color: rgba(255,255,255,.13);
        }

        .bb-capacity-wrap {
          width: 90px;
          flex-shrink: 0;
        }

        .bb-capacity-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          margin-bottom: 7px;
        }

        .bb-capacity-number {
          font-size: 10px;
          font-weight: 700;
          color: rgba(255,255,255,.55);
        }

        .bb-capacity-status {
          padding: 2px 5px;
          border: 1px solid;
          border-radius: 999px;
          font-size: 6.5px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: .04em;
          text-transform: uppercase;
        }

        .bb-capacity-track {
          height: 3px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255,255,255,.055);
        }

        .bb-capacity-fill {
          height: 100%;
          min-width: 2px;
          border-radius: inherit;
          transition: width .25s ease;
        }

        .bb-session-arrow {
          flex-shrink: 0;
          color: rgba(167,139,250,.32);
          font-size: 12px;
          transition:
            transform .16s ease,
            color .16s ease;
        }

        .bb-session-row:hover .bb-session-arrow {
          transform: translateX(2px);
          color: rgba(196,181,253,.72);
        }

        @media (max-width: 620px) {
          .bb-session-count {
            display: none;
          }

          .bb-session-row {
            align-items: flex-start;
            flex-wrap: wrap;
            gap: 10px;
            padding-top: 14px;
            padding-bottom: 14px;
          }

          .bb-session-time {
            width: 66px;
          }

          .bb-session-icon {
            margin-top: 1px;
          }

          .bb-session-copy {
            min-width: calc(100% - 122px);
          }

          .bb-capacity-wrap {
            width: calc(100% - 76px);
            margin-left: 76px;
          }

          .bb-session-arrow {
            position: absolute;
            right: 16px;
            top: 20px;
          }
        }

        @media (max-width: 430px) {
          .bb-schedule-header {
            padding: 12px 15px;
          }

          .bb-session-row {
            padding-left: 16px;
            padding-right: 14px;
          }

          .bb-session-time {
            width: 58px;
          }

          .bb-session-start {
            font-size: 11px;
          }

          .bb-session-icon {
            width: 30px;
            height: 30px;
          }

          .bb-session-copy {
            min-width: calc(100% - 105px);
          }

          .bb-capacity-wrap {
            width: calc(100% - 68px);
            margin-left: 68px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-session-row,
          .bb-session-arrow,
          .bb-capacity-fill,
          .bb-schedule-empty-action {
            transition: none !important;
          }
        }
      `}</style>
    </section>
  )
}