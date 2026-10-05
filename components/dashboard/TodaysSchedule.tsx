import Link from 'next/link'
import { sessionLabel, optionalLabel, sessionColourDot, type SessionTypeRow } from '@/lib/sessionDisplay'
import { buttonProps } from '@/components/ui/app'
import styles from './TodaysSchedule.module.css'

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

type CapacityState = 'error' | 'warning' | 'success' | 'inactive'

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
  state: CapacityState
  label: string
  pct: number
} {
  if (max <= 0) {
    return {
      state: 'inactive',
      label: 'Open',
      pct: 0,
    }
  }

  const pct = Math.min((enrolled / max) * 100, 100)

  if (enrolled >= max) {
    return {
      state: 'error',
      label: 'Full',
      pct,
    }
  }

  if (pct >= 75) {
    return {
      state: 'warning',
      label: 'Filling',
      pct,
    }
  }

  return {
    state: 'success',
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
    <section className={styles.panel}>
      <div className={styles.header}>
        <div>
          <div className={styles.eyebrow}>Sessions</div>

          <h2 className={styles.title}>
            Today&apos;s Schedule
          </h2>
        </div>

        <div className={styles.headerRight}>
          {instances.length > 0 && (
            <span className={styles.count}>
              {instances.length}{' '}
              {instances.length === 1 ? 'session' : 'sessions'}
            </span>
          )}

          <Link
            href="/dashboard/sessions"
            className={styles.link}
          >
            View Sessions
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      {instances.length === 0 ? (
        <div className={styles.empty}>
          <div className={styles.emptyIcon} aria-hidden="true">
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

          <div className={styles.emptyTitle}>
            Clear schedule today
          </div>

          <div className={styles.emptyCopy}>
            No coaching sessions are currently scheduled for today.
          </div>

          <Link
            href="/dashboard/sessions"
            {...buttonProps('secondary', 'sm')}
            className={`${buttonProps('secondary', 'sm').className} ${styles.emptyAction}`}
          >
            Open session calendar
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      ) : (
        <ul className={styles.list}>
          {instances.map((instance) => {
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
              <li key={instance.id}>
                <Link
                  href={`/dashboard/sessions`}
                  className={styles.row}
                  style={
                    {
                      '--session-colour': colour,
                    } as React.CSSProperties
                  }
                >
                  <span className={styles.accent} aria-hidden="true" />

                  <div className={styles.time}>
                    <div className={styles.start}>
                      {formatTime(instance.start_time)}
                    </div>

                    <div className={styles.end}>
                      to{' '}
                      {formatTime(
                        endTime(
                          instance.start_time,
                          instance.duration_minutes
                        )
                      )}
                    </div>
                  </div>

                  <div className={styles.icon} aria-hidden="true">
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

                  <div className={styles.copy}>
                    <div className={styles.name}>
                      {title}
                    </div>

                    <div className={styles.meta}>
                      {label && (
                        <span>
                          {label}
                        </span>
                      )}

                      {instance.resource_id && (
                        <>
                          {label && (
                            <span className={styles.divider} aria-hidden="true">
                              •
                            </span>
                          )}

                          <span>
                            {instance.resource_id}
                          </span>
                        </>
                      )}

                      <span className={styles.divider} aria-hidden="true">
                        •
                      </span>

                      <span>
                        {instance.duration_minutes} min
                      </span>
                    </div>
                  </div>

                  <div className={styles.capacity}>
                    <div className={styles.capacityTop}>
                      <span className={styles.capacityNumber}>
                        {instance.enrolled_count}/
                        {instance.max_capacity}
                      </span>

                      <span
                        className={styles.capacityStatus}
                        data-state={capacity.state}
                      >
                        {capacity.label}
                      </span>
                    </div>

                    <div className={styles.track} aria-hidden="true">
                      <div
                        className={styles.fill}
                        data-state={capacity.state}
                        style={{
                          width: `${capacity.pct}%`,
                        }}
                      />
                    </div>
                  </div>

                  <span className={styles.arrow} aria-hidden="true">
                    →
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
