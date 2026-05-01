'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type Props = {
  rawData: { day: string; leads: number }[]
}

// Recharts v3 shape prop — replaces deprecated Cell, draws top-rounded bars
type BarShapeProps = { x?: number; y?: number; width?: number; height?: number; isToday?: unknown; leads?: unknown }
function leadsBarShape(props: BarShapeProps) {
  const x = Number(props.x ?? 0), y = Number(props.y ?? 0)
  const w = Number(props.width ?? 0), h = Number(props.height ?? 0)
  if (h <= 0 || w <= 0) return null
  const r    = Math.min(4, w / 2)
  const fill = props.isToday ? 'rgba(129,140,248,.85)' : Number(props.leads) > 0 ? 'rgba(99,102,241,.55)' : 'rgba(99,102,241,.15)'
  const d    = `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`
  return <path d={d} fill={fill} />
}

function buildChartData(raw: Props['rawData']) {
  const map = new Map(raw.map(r => [r.day, r.leads]))
  const result: { label: string; leads: number; isToday: boolean }[] = []
  const now = new Date()
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const key = d.toLocaleDateString('en-CA', { timeZone: 'Australia/Adelaide' }) // YYYY-MM-DD
    const label = i === 0 ? 'Today' : d.toLocaleDateString('en-AU', { weekday: 'short', timeZone: 'Australia/Adelaide' })
    result.push({ label, leads: map.get(key) ?? 0, isToday: i === 0 })
  }
  return result
}

export default function LeadsChart({ rawData }: Props) {
  const data = buildChartData(rawData)
  const total = data.reduce((s, d) => s + d.leads, 0)

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
          Leads This Week
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.30)' }}>
          {total} total
        </span>
      </div>

      {/* Chart */}
      <div style={{ padding: '14px 10px 14px' }}>
        <ResponsiveContainer width="100%" height={160}>
          <BarChart data={data} barSize={26} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
            <XAxis
              dataKey="label"
              tick={{ fill: 'rgba(255,255,255,.38)', fontSize: 11, fontFamily: FONT }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fill: 'rgba(255,255,255,.35)', fontSize: 10, fontFamily: FONT }}
              axisLine={false}
              tickLine={false}
              width={24}
              tickCount={4}
            />
            <Tooltip
              cursor={{ fill: 'rgba(255,255,255,.06)', radius: 4 } as object}
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
              formatter={(value: unknown) => { const n = Number(value ?? 0); return [n === 1 ? '1 lead' : `${n} leads`, ''] }}
            />
            <Bar dataKey="leads" shape={leadsBarShape} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
