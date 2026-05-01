'use client'

import { useEffect, useState } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const LAT = -34.93
const LNG = 138.60
const TZ  = 'Australia/Adelaide'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type Day = {
  date: string; maxTemp: number; minTemp: number; rainPct: number; rainMm: number; code: number
}

type Playability = { label: string; color: string; bg: string; border: string }

function pctPlayability(rain: number): Playability {
  if (rain > 60)  return { label: 'Sessions at risk',   color: '#f87171', bg: 'rgba(248,113,113,.10)', border: 'rgba(248,113,113,.20)' }
  if (rain >= 30) return { label: 'Monitor conditions', color: '#fbbf24', bg: 'rgba(251,191,36,.10)',  border: 'rgba(251,191,36,.20)'  }
  return              { label: 'Good for play',         color: '#4ade80', bg: 'rgba(74,222,128,.10)',  border: 'rgba(74,222,128,.20)'  }
}

function probBarColor(pct: number): string {
  if (pct > 60)  return 'rgba(248,113,113,.82)'
  if (pct >= 30) return 'rgba(251,191,36,.82)'
  return 'rgba(74,222,128,.70)'
}

function probBarShape(props: { x?: number; y?: number; width?: number; height?: number; rainPct?: unknown }) {
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0)
  const w = Number(props.width ?? 0), h = Number(props.height ?? 0)
  if (h <= 0 || w <= 0) return null
  const r    = Math.min(4, w / 2)
  const fill = probBarColor(Number(props.rainPct ?? 0))
  const d    = `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  return <path d={d} fill={fill} />
}

function weatherIcon(code: number, rain: number): string {
  if (code === 0)               return '☀️'
  if (code <= 3)                return '🌤'
  if (code <= 48)               return '☁️'
  if (code <= 67 || code <= 82) return rain > 50 ? '🌧' : '🌦'
  if (code >= 95)               return '⛈'
  return '🌥'
}

function dayLabel(dateStr: string, idx: number): string {
  if (idx === 0) return 'Today'
  if (idx === 1) return 'Tmrw'
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' })
}

function PlayBadge({ p }: { p: Playability }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, padding: '3px 9px', borderRadius: 20, flexShrink: 0,
      background: p.bg, color: p.color, border: `1px solid ${p.border}`,
      letterSpacing: '.03em', whiteSpace: 'nowrap',
    }}>
      {p.label}
    </span>
  )
}

function SectionLabel({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{
      padding: '10px 18px 8px',
      borderTop: '1px solid rgba(255,255,255,.06)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>
        {title}
      </span>
      {right}
    </div>
  )
}

function LoadingRows() {
  return (
    <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 9 }}>
      {[1,2,3,4,5,6,7].map(i => (
        <div key={i} style={{ height: 28, borderRadius: 5, background: 'rgba(255,255,255,.05)', animation: `pulse 1.6s ease-in-out ${i * 0.08}s infinite` }} />
      ))}
      <style>{`@keyframes pulse{0%,100%{opacity:.35}50%{opacity:.80}}`}</style>
    </div>
  )
}

export default function WeatherPanel() {
  const [days,    setDays]    = useState<Day[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(false)

  useEffect(() => {
    const url = [
      'https://api.open-meteo.com/v1/forecast',
      `?latitude=${LAT}&longitude=${LNG}`,
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,weathercode`,
      `&timezone=${encodeURIComponent(TZ)}&forecast_days=7`,
    ].join('')

    fetch(url)
      .then(r => r.json())
      .then((data) => {
        const d = data.daily as {
          time: string[]
          temperature_2m_max: number[]
          temperature_2m_min: number[]
          precipitation_probability_max: number[]
          precipitation_sum: number[]
          weathercode: number[]
        }
        setDays(d.time.map((date, i) => ({
          date,
          maxTemp: Math.round(d.temperature_2m_max[i]),
          minTemp: Math.round(d.temperature_2m_min[i]),
          rainPct: Math.round(d.precipitation_probability_max[i] ?? 0),
          rainMm:  Math.round((d.precipitation_sum[i] ?? 0) * 10) / 10,
          code:    d.weathercode[i] ?? 0,
        })))
        setLoading(false)
      })
      .catch(() => { setError(true); setLoading(false) })
  }, [])

  const todayStatus = pctPlayability(days[0]?.rainPct ?? 0)
  const chartData   = days.map((d, i) => ({ ...d, label: dayLabel(d.date, i) }))

  return (
    <div style={{
      background: 'rgba(255,255,255,.025)',
      border: '1px solid rgba(255,255,255,.07)',
      borderRadius: 14, overflow: 'hidden',
      fontFamily: FONT,
    }}>
      {/* Header */}
      <div style={{
        padding: '13px 20px',
        borderBottom: '1px solid rgba(255,255,255,.06)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.35)' }}>
          Playability Forecast
        </span>
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,.20)' }}>Adelaide · 7 days</span>
      </div>

      {loading ? <LoadingRows /> : error ? (
        <div style={{ padding: '24px 20px', textAlign: 'center', color: 'rgba(255,255,255,.22)', fontSize: 12 }}>
          Weather unavailable
        </div>
      ) : (
        <>
          {/* ── 7-day forecast rows ────────────────────────────────── */}
          <div>
            {days.map((day, i) => {
              const play   = pctPlayability(day.rainPct)
              const isLast = i === days.length - 1
              return (
                <div
                  key={day.date}
                  style={{
                    padding: '12px 20px',
                    borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.05)',
                    display: 'flex', alignItems: 'center', gap: 12,
                  }}
                >
                  <span style={{ fontSize: 20, width: 26, textAlign: 'center', lineHeight: 1, flexShrink: 0 }}>
                    {weatherIcon(day.code, day.rainPct)}
                  </span>

                  <div style={{ width: 72, flexShrink: 0 }}>
                    <span style={{ fontSize: 14, fontWeight: 500, color: i === 0 ? '#F5F7FA' : 'rgba(255,255,255,.70)' }}>
                      {dayLabel(day.date, i)}
                    </span>
                  </div>

                  <div style={{ width: 58, flexShrink: 0, textAlign: 'right' }}>
                    <span style={{ fontSize: 14, fontWeight: 600, color: '#F5F7FA' }}>{day.maxTemp}°</span>
                    <span style={{ fontSize: 13, color: 'rgba(255,255,255,.40)', marginLeft: 4 }}>{day.minTemp}°</span>
                  </div>

                  <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)' }}>
                      <div style={{
                        height: '100%', borderRadius: 2,
                        width: `${day.rainPct}%`,
                        background: day.rainPct > 60 ? '#f87171' : day.rainPct >= 30 ? '#fbbf24' : '#4ade80',
                      }} />
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right', minWidth: 58 }}>
                      <div style={{ fontSize: 13, color: 'rgba(255,255,255,.80)', fontWeight: 600 }}>
                        {day.rainPct}%
                      </div>
                      {day.rainMm > 0 && (
                        <div style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', marginTop: 1 }}>
                          {day.rainMm.toFixed(1)}mm
                        </div>
                      )}
                    </div>
                  </div>

                  <PlayBadge p={play} />
                </div>
              )
            })}
          </div>

          {/* ── 7-day rain probability chart ───────────────────────── */}
          <SectionLabel
            title="Rain Probability — 7 Days"
            right={<PlayBadge p={todayStatus} />}
          />
          <div style={{ padding: '4px 10px 14px' }}>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={chartData} barSize={28} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'rgba(255,255,255,.30)', fontSize: 9, fontFamily: FONT }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: 'rgba(255,255,255,.28)', fontSize: 9, fontFamily: FONT }}
                  axisLine={false}
                  tickLine={false}
                  width={24}
                  tickCount={3}
                  tickFormatter={(v: number) => `${v}%`}
                />
                <Tooltip
                  cursor={{ fill: 'rgba(255,255,255,.04)', radius: 4 } as object}
                  contentStyle={{
                    background: '#ffffff',
                    border: '1px solid rgba(0,0,0,.10)',
                    borderRadius: 8,
                    fontSize: 12,
                    color: '#111827',
                    fontFamily: FONT,
                    padding: '8px 12px',
                    boxShadow: '0 4px 16px rgba(0,0,0,.25)',
                  }}
                  labelStyle={{ color: '#374151', marginBottom: 4, fontWeight: 600 }}
                  itemStyle={{ color: '#111827' }}
                  formatter={(value: unknown, _: unknown, item: { payload?: { rainMm?: number } }) => {
                    const mm = item?.payload?.rainMm ?? 0
                    const pct = Number(value ?? 0)
                    return [mm > 0 ? `${pct}% · ${mm.toFixed(1)}mm` : `${pct}%`, 'Rain']
                  }}
                />
                <Bar dataKey="rainPct" shape={probBarShape} />
              </BarChart>
            </ResponsiveContainer>

            {/* Legend */}
            <div style={{ display: 'flex', gap: 14, padding: '4px 8px 0', justifyContent: 'center' }}>
              {[
                { color: 'rgba(74,222,128,.70)',  label: '<30% good for play' },
                { color: 'rgba(251,191,36,.82)',  label: '30–60% monitor' },
                { color: 'rgba(248,113,113,.82)', label: '>60% at risk' },
              ].map(({ color, label }) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: 'rgba(255,255,255,.30)', whiteSpace: 'nowrap' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
