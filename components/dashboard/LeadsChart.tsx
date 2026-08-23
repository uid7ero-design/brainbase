'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

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

  const fill = props.isToday
    ? 'rgba(139,92,246,.95)'
    : Number(props.leads) > 0
      ? 'rgba(99,102,241,.58)'
      : 'rgba(99,102,241,.12)'

  const d =
    `M${x},${y + h} ` +
    `V${y + r} ` +
    `Q${x},${y} ${x + r},${y} ` +
    `H${x + w - r} ` +
    `Q${x + w},${y} ${x + w},${y + r} ` +
    `V${y + h} Z`

  return <path d={d} fill={fill} />
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
    <div className="bb-leads-empty">
      <div className="bb-leads-empty-icon">
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

      <div className="bb-leads-empty-title">
        No new leads this week
      </div>

      <div className="bb-leads-empty-copy">
        New enquiries will appear here as they enter BrainBase.
      </div>
    </div>
  )
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
    <section className="bb-leads-panel">
      <header className="bb-leads-header">
        <div>
          <div className="bb-leads-eyebrow">
            Lead Activity
          </div>

          <div className="bb-leads-title">
            Leads This Week
          </div>
        </div>

        <div className="bb-leads-summary">
          <div className="bb-leads-summary-item">
            <span className="bb-leads-summary-value">
              {total}
            </span>

            <span className="bb-leads-summary-label">
              total
            </span>
          </div>

          <div className="bb-leads-summary-divider" />

          <div className="bb-leads-summary-item">
            <span className="bb-leads-summary-value bb-leads-summary-today">
              {today}
            </span>

            <span className="bb-leads-summary-label">
              today
            </span>
          </div>
        </div>
      </header>

      {total === 0 ? (
        <EmptyState />
      ) : (
        <div className="bb-leads-body">
          <div className="bb-leads-chart-meta">
            <div>
              <span className="bb-leads-meta-value">
                {activeDays}
              </span>

              <span className="bb-leads-meta-label">
                active {activeDays === 1 ? 'day' : 'days'}
              </span>
            </div>

            <div className="bb-leads-meta-dot" />

            <div className="bb-leads-meta-copy">
              Last 7 days
            </div>
          </div>

          <div className="bb-leads-chart-area">
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
                    fill: 'rgba(255,255,255,.32)',
                    fontSize: 9,
                    fontFamily: FONT,
                  }}
                  axisLine={false}
                  tickLine={false}
                  dy={7}
                />

                <YAxis
                  allowDecimals={false}
                  tick={{
                    fill: 'rgba(255,255,255,.20)',
                    fontSize: 8,
                    fontFamily: FONT,
                  }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                  tickCount={4}
                  tickMargin={7}
                />

                <Tooltip
                  cursor={{
                    fill: 'rgba(255,255,255,.025)',
                    radius: 4,
                  } as object}
                  contentStyle={{
                    background: '#111216',
                    border:
                      '1px solid rgba(255,255,255,.10)',
                    borderRadius: 8,
                    fontSize: 11,
                    color: '#F5F7FA',
                    fontFamily: FONT,
                    padding: '8px 11px',
                    boxShadow:
                      '0 8px 28px rgba(0,0,0,.35)',
                  }}
                  labelStyle={{
                    color:
                      'rgba(245,247,250,.72)',
                    marginBottom: 4,
                    fontWeight: 600,
                  }}
                  itemStyle={{
                    color: '#F5F7FA',
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

          <div className="bb-leads-legend">
            <div className="bb-leads-legend-item">
              <span className="bb-leads-legend-dot bb-leads-legend-standard" />
              <span>Previous days</span>
            </div>

            <div className="bb-leads-legend-item">
              <span className="bb-leads-legend-dot bb-leads-legend-today" />
              <span>Today</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .bb-leads-panel {
          height: 100%;
          min-height: 100%;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.025);
          font-family: ${FONT};
        }

        .bb-leads-header {
          min-height: 58px;
          flex-shrink: 0;
          padding: 12px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          border-bottom:
            1px solid rgba(255,255,255,.055);
        }

        .bb-leads-eyebrow {
          margin-bottom: 3px;
          font-size: 7px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
          color: rgba(167,139,250,.48);
        }

        .bb-leads-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: rgba(255,255,255,.48);
        }

        .bb-leads-summary {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .bb-leads-summary-item {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .bb-leads-summary-value {
          font-size: 13px;
          font-weight: 750;
          color: rgba(245,247,250,.76);
        }

        .bb-leads-summary-today {
          color: rgba(196,181,253,.92);
        }

        .bb-leads-summary-label {
          font-size: 8px;
          font-weight: 550;
          color: rgba(255,255,255,.24);
          text-transform: uppercase;
          letter-spacing: .05em;
        }

        .bb-leads-summary-divider {
          width: 1px;
          height: 16px;
          background: rgba(255,255,255,.07);
        }

        .bb-leads-body {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }

        .bb-leads-chart-meta {
          flex-shrink: 0;
          min-height: 42px;
          padding: 13px 20px 5px;
          display: flex;
          align-items: center;
          gap: 7px;
          color: rgba(255,255,255,.26);
        }

        .bb-leads-chart-meta > div:first-child {
          display: flex;
          align-items: baseline;
          gap: 4px;
        }

        .bb-leads-meta-value {
          font-size: 11px;
          font-weight: 700;
          color: rgba(245,247,250,.58);
        }

        .bb-leads-meta-label,
        .bb-leads-meta-copy {
          font-size: 8px;
          letter-spacing: .03em;
          color: rgba(255,255,255,.24);
        }

        .bb-leads-meta-dot {
          width: 3px;
          height: 3px;
          border-radius: 999px;
          background: rgba(255,255,255,.14);
        }

        .bb-leads-chart-area {
          flex: 1;
          min-height: 300px;
          padding: 0 10px;
        }

        .bb-leads-legend {
          min-height: 46px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 18px;
          padding: 8px 18px 16px;
        }

        .bb-leads-legend-item {
          display: flex;
          align-items: center;
          gap: 5px;
          font-size: 8px;
          line-height: 1.2;
          color: rgba(255,255,255,.28);
        }

        .bb-leads-legend-dot {
          width: 7px;
          height: 7px;
          flex-shrink: 0;
          border-radius: 2px;
        }

        .bb-leads-legend-standard {
          background:
            rgba(99,102,241,.58);
        }

        .bb-leads-legend-today {
          background:
            rgba(139,92,246,.95);
          box-shadow:
            0 0 8px rgba(139,92,246,.25);
        }

        .bb-leads-empty {
          flex: 1;
          min-height: 300px;
          padding: 32px 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .bb-leads-empty-icon {
          width: 42px;
          height: 42px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
          border-radius: 11px;
          border:
            1px solid rgba(139,92,246,.16);
          background:
            rgba(139,92,246,.065);
          color:
            rgba(167,139,250,.68);
        }

        .bb-leads-empty-title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          color:
            rgba(245,247,250,.72);
        }

        .bb-leads-empty-copy {
          max-width: 270px;
          font-size: 10.5px;
          line-height: 1.55;
          color:
            rgba(255,255,255,.27);
        }

        @media (max-width: 900px) {
          .bb-leads-chart-area {
            min-height: 260px;
          }
        }

        @media (max-width: 620px) {
          .bb-leads-header {
            padding-left: 15px;
            padding-right: 15px;
          }

          .bb-leads-chart-meta {
            padding-left: 15px;
            padding-right: 15px;
          }

          .bb-leads-chart-area {
            min-height: 220px;
            padding-left: 4px;
            padding-right: 4px;
          }
        }

        @media (max-width: 420px) {
          .bb-leads-summary-label {
            display: none;
          }

          .bb-leads-summary {
            gap: 7px;
          }

          .bb-leads-summary-divider {
            height: 13px;
          }

          .bb-leads-chart-area {
            min-height: 205px;
          }

          .bb-leads-legend {
            padding-bottom: 13px;
          }
        }
      `}</style>
    </section>
  )
}