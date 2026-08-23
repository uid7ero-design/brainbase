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

const DEFAULT_LAT = -34.93
const DEFAULT_LNG = 138.6
const DEFAULT_TZ = 'Australia/Adelaide'
const DEFAULT_LOCATION_LABEL = 'Adelaide'
const DEFAULT_CONTEXT_LABEL = 'Playability Forecast'

const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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

type Playability = {
  label: string
  color: string
  bg: string
  border: string
}

function pctPlayability(rain: number): Playability {
  if (rain > 60) {
    return {
      label: 'Sessions at risk',
      color: '#f87171',
      bg: 'rgba(248,113,113,.10)',
      border: 'rgba(248,113,113,.20)',
    }
  }

  if (rain >= 30) {
    return {
      label: 'Monitor conditions',
      color: '#fbbf24',
      bg: 'rgba(251,191,36,.10)',
      border: 'rgba(251,191,36,.20)',
    }
  }

  return {
    label: 'Good for play',
    color: '#4ade80',
    bg: 'rgba(74,222,128,.10)',
    border: 'rgba(74,222,128,.20)',
  }
}

function probBarColor(pct: number): string {
  if (pct > 60) return 'rgba(248,113,113,.82)'
  if (pct >= 30) return 'rgba(251,191,36,.82)'
  return 'rgba(74,222,128,.70)'
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
  const fill = probBarColor(Number(props.rainPct ?? 0))

  const d =
    `M${x},${y + h} ` +
    `V${y + r} ` +
    `Q${x},${y} ${x + r},${y} ` +
    `H${x + w - r} ` +
    `Q${x + w},${y} ${x + w},${y + r} ` +
    `V${y + h} Z`

  return <path d={d} fill={fill} />
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
    <span
      className="bb-weather-play-badge"
      style={{
        background: p.bg,
        color: p.color,
        borderColor: p.border,
      }}
    >
      {p.label}
    </span>
  )
}

function LoadingRows() {
  return (
    <div className="bb-weather-loading">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className="bb-weather-loading-row"
          style={{
            animationDelay: `${i * 0.08}s`,
          }}
        />
      ))}
    </div>
  )
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
    <section className="bb-weather-panel">
      <header className="bb-weather-header">
        <div>
          <div className="bb-weather-eyebrow">
            Weather Intelligence
          </div>

          <div className="bb-weather-title">
            {contextLabel}
          </div>
        </div>

        <div className="bb-weather-location">
          {locationLabel}
          <span>·</span>
          7 days
        </div>
      </header>

      {loading ? (
        <LoadingRows />
      ) : error ? (
        <div className="bb-weather-error">
          Weather data is currently unavailable.
        </div>
      ) : (
        <>
          <div className="bb-weather-forecast">
            {days.map((day, i) => {
              const play = pctPlayability(day.rainPct)

              return (
                <div
                  key={day.date}
                  className={`bb-weather-row ${
                    i === days.length - 1
                      ? 'bb-weather-row-last'
                      : ''
                  }`}
                >
                  <div className="bb-weather-icon">
                    {weatherIcon(day.code, day.rainPct)}
                  </div>

                  <div
                    className={`bb-weather-day ${
                      i === 0 ? 'bb-weather-day-today' : ''
                    }`}
                  >
                    {dayLabel(day.date, i)}
                  </div>

                  <div className="bb-weather-temp">
                    <span className="bb-weather-max">
                      {day.maxTemp}°
                    </span>

                    <span className="bb-weather-min">
                      {day.minTemp}°
                    </span>
                  </div>

                  <div className="bb-weather-rain-track">
                    <div
                      className="bb-weather-rain-fill"
                      style={{
                        width: `${day.rainPct}%`,
                        background: probBarColor(day.rainPct),
                      }}
                    />
                  </div>

                  <div className="bb-weather-rain-data">
                    <div className="bb-weather-rain-pct">
                      {day.rainPct}%
                    </div>

                    <div className="bb-weather-rain-mm">
                      {day.rainMm > 0
                        ? `${day.rainMm.toFixed(1)}mm`
                        : '—'}
                    </div>
                  </div>

                  <div className="bb-weather-status">
                    <PlayBadge p={play} />
                  </div>
                </div>
              )
            })}
          </div>

          <div className="bb-weather-chart-section">
            <div className="bb-weather-chart-header">
              <div>
                <div className="bb-weather-chart-eyebrow">
                  Rain Probability
                </div>

                <div className="bb-weather-chart-title">
                  Next 7 days
                </div>
              </div>

              <div className="bb-weather-chart-status">
                <PlayBadge p={todayStatus} />
              </div>
            </div>

            <div className="bb-weather-chart-wrap">
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
                      fill: 'rgba(255,255,255,.32)',
                      fontSize: 9,
                      fontFamily: FONT,
                    }}
                    axisLine={false}
                    tickLine={false}
                    dy={7}
                  />

                  <YAxis
                    domain={[0, 100]}
                    ticks={[0, 50, 100]}
                    tick={{
                      fill: 'rgba(255,255,255,.22)',
                      fontSize: 8,
                      fontFamily: FONT,
                    }}
                    axisLine={false}
                    tickLine={false}
                    width={34}
                    tickMargin={8}
                    tickFormatter={(value: number) => `${value}%`}
                  />

                  <Tooltip
                    cursor={{
                      fill: 'rgba(255,255,255,.025)',
                      radius: 4,
                    } as object}
                    contentStyle={{
                      background: '#111216',
                      border: '1px solid rgba(255,255,255,.10)',
                      borderRadius: 8,
                      fontSize: 11,
                      color: '#F5F7FA',
                      fontFamily: FONT,
                      padding: '8px 11px',
                      boxShadow: '0 8px 28px rgba(0,0,0,.35)',
                    }}
                    labelStyle={{
                      color: 'rgba(245,247,250,.75)',
                      marginBottom: 4,
                      fontWeight: 600,
                    }}
                    itemStyle={{
                      color: '#F5F7FA',
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

            <div className="bb-weather-legend">
              <div className="bb-weather-legend-item">
                <span
                  className="bb-weather-legend-dot"
                  style={{
                    background: 'rgba(74,222,128,.70)',
                  }}
                />

                <span>&lt;30% good for play</span>
              </div>

              <div className="bb-weather-legend-item">
                <span
                  className="bb-weather-legend-dot"
                  style={{
                    background: 'rgba(251,191,36,.82)',
                  }}
                />

                <span>30–60% monitor</span>
              </div>

              <div className="bb-weather-legend-item">
                <span
                  className="bb-weather-legend-dot"
                  style={{
                    background: 'rgba(248,113,113,.82)',
                  }}
                />

                <span>&gt;60% at risk</span>
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes bbWeatherPulse {
          0%, 100% {
            opacity: .32;
          }

          50% {
            opacity: .72;
          }
        }

        .bb-weather-panel {
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.025);
          font-family: ${FONT};
        }

        .bb-weather-header {
          min-height: 58px;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-bottom: 1px solid rgba(255,255,255,.055);
        }

        .bb-weather-eyebrow {
          margin-bottom: 3px;
          font-size: 7px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color: rgba(167,139,250,.48);
        }

        .bb-weather-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: rgba(255,255,255,.48);
        }

        .bb-weather-location {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 9px;
          color: rgba(255,255,255,.22);
          white-space: nowrap;
        }

        .bb-weather-loading {
          padding: 12px 18px;
          display: flex;
          flex-direction: column;
          gap: 7px;
        }

        .bb-weather-loading-row {
          height: 45px;
          border-radius: 8px;
          background: rgba(255,255,255,.045);
          animation: bbWeatherPulse 1.6s ease-in-out infinite;
        }

        .bb-weather-error {
          min-height: 220px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px 20px;
          text-align: center;
          color: rgba(255,255,255,.26);
          font-size: 11px;
        }

        .bb-weather-forecast {
          width: 100%;
        }

        .bb-weather-row {
          min-height: 55px;
          display: grid;
          grid-template-columns:
            30px
            58px
            62px
            minmax(82px, 1fr)
            52px
            112px;
          align-items: center;
          column-gap: 12px;
          padding: 0 18px;
          border-bottom: 1px solid rgba(255,255,255,.045);
          transition: background .15s ease;
        }

        .bb-weather-row:hover {
          background: rgba(255,255,255,.018);
        }

        .bb-weather-row-last {
          border-bottom: 0;
        }

        .bb-weather-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 30px;
          font-size: 17px;
          line-height: 1;
        }

        .bb-weather-day {
          font-size: 11px;
          font-weight: 600;
          color: rgba(255,255,255,.55);
        }

        .bb-weather-day-today {
          color: rgba(245,247,250,.92);
        }

        .bb-weather-temp {
          display: flex;
          align-items: baseline;
          justify-content: flex-start;
          gap: 4px;
          white-space: nowrap;
        }

        .bb-weather-max {
          font-size: 12px;
          font-weight: 700;
          color: rgba(245,247,250,.9);
        }

        .bb-weather-min {
          font-size: 10px;
          color: rgba(255,255,255,.30);
        }

        .bb-weather-rain-track {
          width: 100%;
          height: 4px;
          overflow: hidden;
          border-radius: 999px;
          background: rgba(255,255,255,.07);
        }

        .bb-weather-rain-fill {
          height: 100%;
          min-width: 2px;
          border-radius: inherit;
          transition: width .25s ease;
        }

        .bb-weather-rain-data {
          width: 52px;
          text-align: right;
        }

        .bb-weather-rain-pct {
          font-size: 11px;
          line-height: 1.2;
          font-weight: 700;
          color: rgba(245,247,250,.78);
        }

        .bb-weather-rain-mm {
          min-height: 11px;
          margin-top: 2px;
          font-size: 8px;
          line-height: 1.2;
          color: rgba(255,255,255,.28);
        }

        .bb-weather-status {
          width: 112px;
          display: flex;
          justify-content: flex-end;
        }

        .bb-weather-play-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 96px;
          min-height: 24px;
          padding: 3px 9px;
          border: 1px solid;
          border-radius: 999px;
          font-size: 8px;
          line-height: 1;
          font-weight: 750;
          letter-spacing: .02em;
          white-space: nowrap;
        }

        .bb-weather-chart-section {
          border-top: 1px solid rgba(255,255,255,.055);
          padding: 16px 18px 18px;
        }

        .bb-weather-chart-header {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 12px;
        }

        .bb-weather-chart-status {
          padding-top: 2px;
        }

        .bb-weather-chart-eyebrow {
          margin-bottom: 4px;
          font-size: 7px;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color: rgba(167,139,250,.42);
        }

        .bb-weather-chart-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .07em;
          text-transform: uppercase;
          color: rgba(255,255,255,.42);
        }

        .bb-weather-chart-wrap {
          height: 150px;
          margin: 2px -2px 0;
        }

        .bb-weather-legend {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 16px;
          flex-wrap: wrap;
          margin-top: 12px;
          padding-bottom: 2px;
        }

        .bb-weather-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 8px;
          line-height: 1.3;
          color: rgba(255,255,255,.28);
          white-space: nowrap;
        }

        .bb-weather-legend-dot {
          width: 7px;
          height: 7px;
          flex-shrink: 0;
          border-radius: 2px;
        }

        @media (max-width: 1080px) {
          .bb-weather-row {
            grid-template-columns:
              28px
              52px
              56px
              minmax(60px, 1fr)
              46px
              96px;
            column-gap: 9px;
            padding: 0 14px;
          }

          .bb-weather-status {
            width: 96px;
          }

          .bb-weather-play-badge {
            min-width: 88px;
            padding-left: 7px;
            padding-right: 7px;
            font-size: 7px;
          }
        }

        @media (max-width: 620px) {
          .bb-weather-row {
            min-height: 62px;
            grid-template-columns:
              28px
              52px
              58px
              minmax(60px, 1fr)
              48px;
            column-gap: 8px;
          }

          .bb-weather-status {
            display: none;
          }

          .bb-weather-chart-status {
            display: none;
          }
        }

        @media (max-width: 460px) {
          .bb-weather-header {
            padding-left: 15px;
            padding-right: 15px;
          }

          .bb-weather-row {
            grid-template-columns:
              24px
              46px
              50px
              minmax(48px, 1fr)
              42px;
            column-gap: 7px;
            padding: 0 12px;
          }

          .bb-weather-icon {
            width: 24px;
            font-size: 15px;
          }

          .bb-weather-day {
            font-size: 10px;
          }

          .bb-weather-max {
            font-size: 11px;
          }

          .bb-weather-min {
            font-size: 9px;
          }

          .bb-weather-rain-pct {
            font-size: 10px;
          }

          .bb-weather-chart-section {
            padding-left: 12px;
            padding-right: 12px;
          }

          .bb-weather-legend {
            gap: 10px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-weather-loading-row,
          .bb-weather-rain-fill,
          .bb-weather-row {
            animation: none !important;
            transition: none !important;
          }
        }
      `}</style>
    </section>
  )
}