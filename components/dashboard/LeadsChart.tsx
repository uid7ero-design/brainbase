'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import styles from './LeadsChart.module.css'

type Props = {
  rawData: { day: string; leads: number }[]
}

type BarShapeProps = {
  x?: number
  y?: number
  width?: number
  height?: number
  isToday?: unknown
  leads?: unknown
}

function leadsBarShape(props: BarShapeProps) {
  const x = Number(props.x ?? 0)
  const y = Number(props.y ?? 0)
  const w = Number(props.width ?? 0)
  const h = Number(props.height ?? 0)

  if (h <= 0 || w <= 0) return null

  const r = Math.min(4, w / 2)

  // Series colour comes from the module (theme tokens), not an SVG fill
  // attribute, so the bars read in light and dark.
  const className = props.isToday
    ? styles.barToday
    : Number(props.leads) > 0
      ? styles.barActive
      : styles.barZero

  const d =
    `M${x},${y + h} ` +
    `V${y + r} ` +
    `Q${x},${y} ${x + r},${y} ` +
    `H${x + w - r} ` +
    `Q${x + w},${y} ${x + w},${y + r} ` +
    `V${y + h} Z`

  return <path d={d} className={className} />
}

function buildChartData(raw: Props['rawData']) {
  const map = new Map(raw.map((row) => [row.day, row.leads]))

  const result: {
    label: string
    leads: number
    isToday: boolean
  }[] = []

  const now = new Date()

  for (let i = 6; i >= 0; i--) {
    const d = new Date(now)

    d.setDate(d.getDate() - i)

    const key = d.toLocaleDateString('en-CA', {
      timeZone: 'Australia/Adelaide',
    })

    const label =
      i === 0
        ? 'Today'
        : d.toLocaleDateString('en-AU', {
            weekday: 'short',
            timeZone: 'Australia/Adelaide',
          })

    result.push({
      label,
      leads: map.get(key) ?? 0,
      isToday: i === 0,
    })
  }

  return result
}

function EmptyState() {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon} aria-hidden="true">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <path d="M12 5v14M5 12h14" />
          <circle cx="12" cy="12" r="9" />
        </svg>
      </div>

      <div className={styles.emptyTitle}>
        No new leads this week
      </div>

      <div className={styles.emptyCopy}>
        New enquiries will appear here as they enter BrainBase.
      </div>
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

export default function LeadsChart({ rawData }: Props) {
  const data = buildChartData(rawData)

  const total = data.reduce(
    (sum, day) => sum + day.leads,
    0
  )

  const today =
    data.find((day) => day.isToday)?.leads ?? 0

  const activeDays =
    data.filter((day) => day.leads > 0).length

  return (
    <section className={styles.panel}>
      <header className={styles.header}>
        <div>
          <div className={styles.eyebrow}>
            Lead Activity
          </div>

          <h2 className={styles.title}>
            Leads This Week
          </h2>
        </div>

        <div className={styles.summary}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryValue}>
              {total}
            </span>

            <span className={styles.summaryLabel}>
              total
            </span>
          </div>

          <div className={styles.divider} aria-hidden="true" />

          <div className={styles.summaryItem}>
            <span className={styles.summaryValue}>
              {today}
            </span>

            <span className={styles.summaryLabel}>
              today
            </span>
          </div>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className={styles.body}>
          <div className={styles.meta}>
            <div className={styles.metaGroup}>
              <span className={styles.metaValue}>
                {activeDays}
              </span>

              <span className={styles.metaLabel}>
                active {activeDays === 1 ? 'day' : 'days'}
              </span>
            </div>

            <div className={styles.metaDot} aria-hidden="true" />

            <div className={styles.metaLabel}>
              Last 7 days
            </div>
          </div>

          <div className={styles.chartArea}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={data}
                barSize={24}
                margin={{
                  top: 22,
                  right: 18,
                  bottom: 14,
                  left: 2,
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
                  allowDecimals={false}
                  tick={{
                    fontSize: 11,
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                  tickCount={4}
                  tickMargin={7}
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
                  formatter={(value: unknown) => {
                    const n = Number(value ?? 0)

                    return [
                      n === 1
                        ? '1 lead'
                        : `${n} leads`,
                      'Leads',
                    ]
                  }}
                />

                <Bar
                  dataKey="leads"
                  shape={leadsBarShape}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className={styles.legend}>
            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendStandard}`} aria-hidden="true" />
              <span>Previous days</span>
            </div>

            <div className={styles.legendItem}>
              <span className={`${styles.legendDot} ${styles.legendToday}`} aria-hidden="true" />
              <span>Today</span>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
