'use client'

import { useEffect, useState } from 'react'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Badge } from '@/components/ui/app'
import styles from './WeatherPanel.module.css'

const DEFAULT_LAT = -34.93
const DEFAULT_LNG = 138.6
const DEFAULT_TZ = 'Australia/Adelaide'
const DEFAULT_LOCATION_LABEL = 'Adelaide'
const DEFAULT_CONTEXT_LABEL = 'Playability Forecast'

type Props = {
  latitude?: number
  longitude?: number
  timezone?: string
  locationLabel?: string
  contextLabel?: string
}

type Day = {
  date: string
  maxTemp: number
  minTemp: number
  rainPct: number
  rainMm: number
  code: number
}

// Playability is a status encoding: the thresholds are unchanged, the
// colour now comes from the semantic status tokens (readable in both
// themes) instead of fixed pale hues.
type PlayState = 'error' | 'warning' | 'success'

type Playability = {
  label: string
  state: PlayState
}

function pctPlayability(rain: number): Playability {
  if (rain > 60) {
    return {
      label: 'Sessions at risk',
      state: 'error',
    }
  }

  if (rain >= 30) {
    return {
      label: 'Monitor conditions',
      state: 'warning',
    }
  }

  return {
    label: 'Good for play',
    state: 'success',
  }
}

const BAR_CLASS: Record<PlayState, string> = {
  error: styles.barError,
  warning: styles.barWarning,
  success: styles.barSuccess,
}

function probBarShape(props: {
  x?: number
  y?: number
  width?: number
  height?: number
  rainPct?: unknown
}) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const w = Number(props.width ?? 0)
  const h = Number(props.height ?? 0)

  if (h <= 0 || w <= 0) return null

  const r = Math.min(4, w / 2)
  const className = BAR_CLASS[pctPlayability(Number(props.rainPct ?? 0)).state]

  const d =
    `M${x},${y + h} ` +
    `V${y + r} ` +
    `Q${x},${y} ${x + r},${y} ` +
    `H${x + w - r} ` +
    `Q${x + w},${y} ${x + w},${y + r} ` +
    `V${y + h} Z`

  return <path d={d} className={className} />
}

function weatherIcon(code: number, rain: number): string {
  if (code === 0) return '☀️'
  if (code <= 3) return '🌤'
  if (code <= 48) return '☁️'
  if (code <= 67 || code <= 82) return rain > 50 ? '🌧' : '🌦'
  if (code >= 95) return '⛈'

  return '🌥'
}

function dayLabel(dateStr: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tmrw'

  return new Date(`${dateStr}T12:00:00`).toLocaleDateString('en-AU', {
    weekday: 'short',
  })
}

function PlayBadge({ p }: { p: Playability }) {
  return (
    <Badge state={p.state} className={styles.playBadge}>
      {p.label}
    </Badge>
  )
}

function LoadingRows() {
  return (
    <div className={styles.loading} role="status" aria-label="Loading weather">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className={styles.loadingRow}
          style={{
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
}

const TOOLTIP_STYLE: React.CSSProperties = {
  background: 'var(--bg-overlay)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  fontSize: 12,
  color: 'var(--text-primary)',
  fontFamily: 'var(--bb-font-sans)',
  padding: '8px 11px',
  boxShadow: 'var(--shadow-popover)',
}

export default function WeatherPanel({
  latitude = DEFAULT_LAT,
  longitude = DEFAULT_LNG,
  timezone = DEFAULT_TZ,
  locationLabel = DEFAULT_LOCATION_LABEL,
  contextLabel = DEFAULT_CONTEXT_LABEL,
}: Props) {
  const [days, setDays] = useState<Day[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const url = [
      'https://api.open-meteo.com/v1/forecast',
      `?latitude=${latitude}&longitude=${longitude}`,
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weathercode',
      `&timezone=${encodeURIComponent(timezone)}&forecast_days=7`,
    ].join('')

    fetch(url)
      .then((response) => response.json())
      .then((data) => {
        const daily = data.daily as {
          time: string[]
          temperature_2m_max: number[]
          temperature_2m_min: number[]
          precipitation_probability_max: number[]
          precipitation_sum: number[]
          weathercode: number[]
        }

        setDays(
          daily.time.map((date, i) => ({
            date,
            maxTemp: Math.round(daily.temperature_2m_max[i]),
            minTemp: Math.round(daily.temperature_2m_min[i]),
            rainPct: Math.round(
              daily.precipitation_probability_max[i] ?? 0
            ),
            rainMm:
              Math.round((daily.precipitation_sum[i] ?? 0) * 10) / 10,
            code: daily.weathercode[i] ?? 0,
          }))
        )

        setLoading(false)
      })
      .catch(() => {
        setError(true)
        setLoading(false)
      })
  }, [latitude, longitude, timezone])

  const todayStatus = pctPlayability(days[0]?.rainPct ?? 0)

  const chartData = days.map((day, i) => ({
    ...day,
    label: dayLabel(day.date, i),
  }))


  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            Weather Intelligence
          </div>

          <h2 className={styles.title}>
            {contextLabel}
          </h2>
        </div>

        <div className={styles.location}>
          {locationLabel}
          <span aria-hidden="true">·</span>
          7 days
        </div>
      </header>

      {loading ? (
        <LoadingRows />
      ) : error ? (
        <div className={styles.error}>
          Weather data is currently unavailable.
        </div>
      ) : (
        <>
          <ul className={styles.forecast}>
            {days.map((day, i) => {
              const play = pctPlayability(day.rainPct)

              return (
                <li
                  key={day.date}
                  className={styles.row}
                >
                  <div className={styles.icon}>
                    {weatherIcon(day.code, day.rainPct)}
                  </div>

                  <div
                    className={styles.day}
                    data-today={i === 0 ? 'true' : undefined}
                  >
                    {dayLabel(day.date, i)}
                  </div>

                  <div className={styles.temp}>
                    <span className={styles.max}>
                      {day.maxTemp}°
                    </span>

                    <span className={styles.min}>
                      {day.minTemp}°
                    </span>
                  </div>

                  <div className={styles.rainTrack} aria-hidden="true">
                    <div
                      className={styles.rainFill}
                      data-play={play.state}
                      style={{
                        width: `${day.rainPct}%`,
                      }}
                    />
                  </div>

                  <div className={styles.rainData}>
                    <div className={styles.rainPct}>
                      {day.rainPct}%
                    </div>

                    <div className={styles.rainMm}>
                      {day.rainMm > 0
                        ? `${day.rainMm.toFixed(1)}mm`
                        : '—'}
                    </div>
                  </div>

                  <div className={styles.status}>
                    <PlayBadge p={play} />
                  </div>
                </li>
              )
            })}
          </ul>

          <div className={styles.chartSection}>
            <div className={styles.chartHeader}>
              <div>
                <div className={styles.chartEyebrow}>
                  Rain Probability
                </div>

                <h3 className={styles.chartTitle}>
                  Next 7 days
                </h3>
              </div>

              <div>
                <PlayBadge p={todayStatus} />
              </div>
            </div>

            <div className={styles.chartWrap}>
              <ResponsiveContainer width="100%" height={150}>
                <BarChart
                  data={chartData}
                  barSize={20}
                  margin={{
                    top: 16,
                    right: 12,
                    bottom: 10,
                    left: 4,
                  }}
                >
                  <XAxis
                    dataKey="label"
                    tick={{
                      fontSize: 11,
                    }}
                    axisLine={false}
                    tickLine={false}
                    dy={7}
                  />

                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 50, 100]}
                    tick={{
                      fontSize: 11,
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={34}
                    tickMargin={8}
                    tickFormatter={(value: number) => `${value}%`}
                  />

                  <Tooltip
                    cursor={{
                      radius: 4,
                    } as object}
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{
                      color: 'var(--text-secondary)',
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                    itemStyle={{
                      color: 'var(--text-primary)',
                    }}
                    formatter={(
                      value: unknown,
                      _: unknown,
                      item: {
                        payload?: {
                          rainMm?: number
                        }
                      }
                    ) => {
                      const mm = item?.payload?.rainMm ?? 0
                      const pct = Number(value ?? 0)

                      return [
                        mm > 0
                          ? `${pct}% · ${mm.toFixed(1)}mm`
                          : `${pct}%`,
                        'Rain',
                      ]
                    }}
                  />

                  <Bar
                    dataKey="rainPct"
                    shape={probBarShape}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <ul className={styles.legend}>
              <li className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  data-play="success"
                  aria-hidden="true"
                />

                <span>&lt;30% good for play</span>
              </li>

              <li className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  data-play="warning"
                  aria-hidden="true"
                />

                <span>30–60% monitor</span>
              </li>

              <li className={styles.legendItem}>
                <span
                  className={styles.legendDot}
                  data-play="error"
                  aria-hidden="true"
                />

                <span>&gt;60% at risk</span>
              </li>
            </ul>
          </div>
        </>
      )}
    </section>
  )
}
