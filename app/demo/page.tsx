'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { HlnaOrb } from '@/components/brand/HlnaOrb'
import { BrainBaseWordmark } from '@/components/brand/BrainBaseWordmark'

const FONT =
  'var(--font-inter), "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

type TabId =
  | 'overview'
  | 'financial'
  | 'operations'
  | 'customers'
  | 'workforce'
  | 'assets'
  | 'reporting'

type DemoQuestion = {
  question: string
  answer: string
}

type Metric = {
  label: string
  value: string
  note: string
  colour: string
}

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'financial', label: 'Financial' },
  { id: 'operations', label: 'Operations' },
  { id: 'customers', label: 'Customers' },
  { id: 'workforce', label: 'Workforce' },
  { id: 'assets', label: 'Assets' },
  { id: 'reporting', label: 'Reporting' },
]

const SYSTEM_STATUS = [
  {
    label: 'Operations',
    status: 'Attention',
    colour: '#fbbf24',
  },
  {
    label: 'Customers',
    status: 'Stable',
    colour: '#4ade80',
  },
  {
    label: 'Assets',
    status: 'Operational',
    colour: '#4ade80',
  },
  {
    label: 'Workforce',
    status: 'Watch',
    colour: '#fbbf24',
  },
  {
    label: 'Financial',
    status: 'Stable',
    colour: '#4ade80',
  },
  {
    label: 'Service Risk',
    status: 'Elevated',
    colour: '#f87171',
  },
]

const DEMO_QUESTIONS: DemoQuestion[] = [
  {
    question: 'What needs attention today?',
    answer:
      'Three areas need attention. The service backlog is the highest priority, with 18 requests outside target. Operating costs are 4.8% above monthly plan, primarily from fuel, contractor hours and reactive maintenance. Tomorrow also has three uncovered shifts. I would address the backlog first, then confirm workforce coverage before reviewing the cost variance.',
  },
  {
    question: 'Where are costs increasing?',
    answer:
      'Operating costs are currently 4.8% above monthly plan. The main drivers are fuel, external contractor hours and reactive asset maintenance. Fleet Unit 08 is contributing disproportionately to maintenance expenditure and should be reviewed before the next service cycle.',
  },
  {
    question: 'Summarise operational risk',
    answer:
      'Overall operational risk is moderate. Customer response performance is improving, but one service backlog is outside target and workforce capacity is constrained tomorrow. Asset availability remains healthy at 92%, so the immediate risk is resourcing rather than equipment capacity.',
  },
  {
    question: 'What is performing well?',
    answer:
      'Customer response performance is the strongest current improvement. 91% of requests are now being handled within target, up 6 percentage points over the last reporting period. Asset availability is stable at 92%, and customer satisfaction remains above target.',
  },
]

const ALERTS = [
  {
    label: 'High Priority',
    title: 'Service backlog exceeding target',
    value: '18',
    detail: 'open requests',
    description:
      'Customer requests in the southern service area are exceeding the target response window.',
    colour: '#f87171',
  },
  {
    label: 'Monitor',
    title: 'Operating cost trending above forecast',
    value: '+4.8%',
    detail: 'vs monthly plan',
    description:
      'Fuel, contractor hours and reactive maintenance are driving the current variance.',
    colour: '#fbbf24',
  },
  {
    label: 'Workforce',
    title: 'Tomorrow has uncovered capacity',
    value: '3',
    detail: 'shifts uncovered',
    description:
      'Available internal capacity is below planned requirements for tomorrow morning.',
    colour: '#fbbf24',
  },
]

const FINANCIAL_METRICS: Metric[] = [
  {
    label: 'Operating Budget',
    value: '$4.82m',
    note: 'Annual allocation',
    colour: '#a78bfa',
  },
  {
    label: 'Actual YTD',
    value: '$3.11m',
    note: '64.5% utilised',
    colour: '#60a5fa',
  },
  {
    label: 'Forecast',
    value: '$4.91m',
    note: '+1.9% variance',
    colour: '#fbbf24',
  },
  {
    label: 'Identified Savings',
    value: '$184k',
    note: 'Current opportunities',
    colour: '#4ade80',
  },
]

const COST_DRIVERS = [
  ['Fuel & Energy', '$672k', '+7.2%', '#f87171'],
  ['Labour', '$1.42m', '+1.4%', '#4ade80'],
  ['Contractors', '$583k', '+9.8%', '#f87171'],
  ['Maintenance', '$438k', '+5.6%', '#fbbf24'],
  ['Processing', '$721k', '-2.3%', '#4ade80'],
]

const CUSTOMER_ROWS = [
  ['REQ-1048', 'Service request', 'Escalated', '6 days'],
  ['REQ-1042', 'Missed service', 'Active', '3 days'],
  ['REQ-1037', 'General enquiry', 'In progress', '2 days'],
  ['REQ-1029', 'Asset issue', 'Resolved', '1 day'],
]

const ASSET_ROWS = [
  ['Fleet Unit 08', 'Heavy Vehicle', 'Unavailable', 'Maintenance review'],
  ['Fleet Unit 12', 'Heavy Vehicle', 'Operational', 'Available'],
  ['Mobile Crew 03', 'Field Asset', 'Operational', 'Available'],
  ['Site Plant 04', 'Plant', 'Restricted', 'Inspection due'],
]

const REPORTS = [
  {
    icon: '↗',
    title: 'Executive Summary',
    description:
      'Operational performance, exceptions and key decisions in one briefing.',
    status: 'Ready',
  },
  {
    icon: '◫',
    title: 'Monthly Performance',
    description:
      'Service, customer, asset and financial performance prepared automatically.',
    status: 'Scheduled',
  },
  {
    icon: '⚡',
    title: 'Exception Report',
    description:
      'Only surface areas that have moved outside an agreed threshold.',
    status: 'Automated',
  },
  {
    icon: '◎',
    title: 'HLNΛ Analysis',
    description:
      'Ask questions across operational information without building another report.',
    status: 'Live',
  },
]

function DemoBadge() {
  return (
    <div className="bb-demo-badge">
      <span />
      Demo data
    </div>
  )
}

function MetricCard({
  label,
  value,
  note,
  colour,
}: Metric) {
  return (
    <div className="bb-metric">
      <div
        className="bb-metric-line"
        style={{
          background: `linear-gradient(90deg, transparent, ${colour}55, transparent)`,
        }}
      />

      <div className="bb-metric-label">
        {label}
      </div>

      <div className="bb-metric-bottom">
        <div>
          <strong>{value}</strong>

          <small
            style={{
              color: colour,
            }}
          >
            {note}
          </small>
        </div>

        <div className="bb-spark">
          {[32, 46, 40, 61, 54, 78].map(
            (height, index) => (
              <span
                key={index}
                style={{
                  height: `${height}%`,
                  background:
                    index === 5
                      ? colour
                      : undefined,
                }}
              />
            ),
          )}
        </div>
      </div>
    </div>
  )
}

function PanelHeader({
  eyebrow,
  title,
  right,
}: {
  eyebrow: string
  title: string
  right?: React.ReactNode
}) {
  return (
    <div className="bb-panel-head">
      <div>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
      </div>

      {right}
    </div>
  )
}

function PageHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="bb-tab-heading">
      <div>
        <small>{eyebrow}</small>

        <h2>{title}</h2>

        <p>{description}</p>
      </div>

      <DemoBadge />
    </div>
  )
}

function DataTable({
  headings,
  rows,
}: {
  headings: string[]
  rows: string[][]
}) {
  return (
    <div className="bb-table-wrap">
      <div
        className="bb-table"
        style={{
          gridTemplateColumns: `repeat(${headings.length}, minmax(130px, 1fr))`,
        }}
      >
        {headings.map((heading) => (
          <div
            key={heading}
            className="bb-table-heading"
          >
            {heading}
          </div>
        ))}

        {rows.flatMap((row, rowIndex) =>
          row.map((cell, cellIndex) => (
            <div
              key={`${rowIndex}-${cellIndex}`}
              className={
                cellIndex === 0
                  ? 'bb-table-cell bb-table-strong'
                  : 'bb-table-cell'
              }
            >
              {cell}
            </div>
          )),
        )}
      </div>
    </div>
  )
}

const SCENARIO_STEPS = [
  'New service request logged — REQ-1053',
  'Added to the open requests queue — Open Requests 48 → 49',
  'Flagged for Operations — workload updated',
  "HLNΛ: This adds to today's backlog — worth prioritising before end of day.",
]

function OverviewTab({
  askHlna,
}: {
  askHlna: (question: string) => void
}) {
  const [scenarioStep, setScenarioStep] =
    useState(0)

  const [scenarioLog, setScenarioLog] =
    useState<string[]>([])

  const openRequests =
    scenarioStep >= 2 ? 49 : 48

  function runScenario() {
    if (scenarioStep > 0) return

    setScenarioStep(1)
    setScenarioLog([SCENARIO_STEPS[0]])

    window.setTimeout(() => {
      setScenarioLog(log => [
        ...log,
        SCENARIO_STEPS[1],
      ])
      setScenarioStep(2)

      window.setTimeout(() => {
        setScenarioLog(log => [
          ...log,
          SCENARIO_STEPS[2],
        ])
        setScenarioStep(3)

        window.setTimeout(() => {
          setScenarioLog(log => [
            ...log,
            SCENARIO_STEPS[3],
          ])
          setScenarioStep(4)
        }, 700)
      }, 700)
    }, 700)
  }

  function resetScenario() {
    setScenarioStep(0)
    setScenarioLog([])
  }

  return (
    <div className="bb-tab-page">
      <div className="bb-scenario-bar">
        <div>
          <strong>
            Try it: run an example scenario
          </strong>

          <span>
            See how a new request moves through the
            connected operation.
          </span>
        </div>

        <button
          onClick={
            scenarioStep === 4
              ? resetScenario
              : runScenario
          }
          disabled={
            scenarioStep > 0 &&
            scenarioStep < 4
          }
          className="bb-scenario-button"
        >
          {scenarioStep === 0
            ? 'Run scenario'
            : scenarioStep < 4
              ? 'Running…'
              : 'Reset scenario'}
        </button>
      </div>

      {scenarioLog.length > 0 && (
        <div className="bb-scenario-log">
          {scenarioLog.map((line, index) => (
            <div
              key={index}
              className="bb-scenario-log-line"
            >
              {line}
            </div>
          ))}

          <div className="bb-scenario-note">
            Example scenario using demo data —
            reset anytime.
          </div>
        </div>
      )}

      <div className="bb-kpi-five">
        <MetricCard
          label="Open Requests"
          value={String(openRequests)}
          note={
            scenarioStep >= 2
              ? 'Updated by scenario'
              : '+9% this week'
          }
          colour="#f87171"
        />

        <MetricCard
          label="Within Target"
          value="91%"
          note="+6 pts"
          colour="#4ade80"
        />

        <MetricCard
          label="Active Alerts"
          value="4"
          note="1 high priority"
          colour="#fbbf24"
        />

        <MetricCard
          label="Customer Score"
          value="4.6"
          note="+3.2%"
          colour="#4ade80"
        />

        <MetricCard
          label="Asset Availability"
          value="92%"
          note="Stable"
          colour="#60a5fa"
        />
      </div>

      <div className="bb-status-grid">
        {SYSTEM_STATUS.map((item) => (
          <div
            key={item.label}
            className="bb-status-item"
          >
            <span
              style={{
                background: item.colour,
                boxShadow: `0 0 8px ${item.colour}66`,
              }}
            />

            <div>
              <strong>{item.label}</strong>

              <small
                style={{
                  color: item.colour,
                }}
              >
                {item.status}
              </small>
            </div>
          </div>
        ))}
      </div>

      <div className="bb-primary-grid">
        <section className="bb-panel bb-hlna-panel">
          <PanelHeader
            eyebrow="Intelligence Layer"
            title="HLNΛ Operational Briefing"
            right={
              <div className="bb-connected">
                <span />
                Connected
              </div>
            }
          />

          <div className="bb-hlna-body">
            <div className="bb-current-briefing">
              <small>Current briefing</small>

              <p>
                Service performance remains broadly
                stable, with one customer backlog and
                tomorrow&apos;s workforce coverage
                requiring attention.
              </p>
            </div>

            <div className="bb-intel-grid">
              <IntelCard
                label="Situation"
                body="18 customer requests are now outside the target response window."
                colour="#60a5fa"
              />

              <IntelCard
                label="Context"
                body="Overall request performance remains at 91% within target despite higher demand."
                colour="#a78bfa"
              />

              <IntelCard
                label="Risk"
                body="Three uncovered shifts tomorrow may increase the existing service backlog."
                colour="#fbbf24"
              />

              <IntelCard
                label="Action"
                body="Reallocate available workforce to the highest-risk requests before tomorrow."
                colour="#4ade80"
              />
            </div>

            <div className="bb-question-pills">
              {DEMO_QUESTIONS.slice(0, 3).map(
                item => (
                  <button
                    key={item.question}
                    onClick={() =>
                      askHlna(item.question)
                    }
                  >
                    {item.question}
                  </button>
                ),
              )}
            </div>
          </div>
        </section>

        <section className="bb-panel">
          <PanelHeader
            eyebrow="Environmental Context"
            title="Operational Conditions"
            right={
              <span className="bb-muted">
                Adelaide
              </span>
            }
          />

          <div className="bb-weather">
            <div className="bb-weather-main">
              <div>
                <strong>18°</strong>
                <span>Clear conditions</span>
              </div>

              <div className="bb-weather-icon">
                ☀
              </div>
            </div>

            <div className="bb-weather-ok">
              <span />
              Good operating conditions
            </div>

            <div className="bb-weather-days">
              {[
                ['Mon', '18°', '10%'],
                ['Tue', '20°', '5%'],
                ['Wed', '17°', '35%'],
                ['Thu', '16°', '62%'],
                ['Fri', '19°', '18%'],
              ].map(([day, temp, rain]) => (
                <div key={day}>
                  <small>{day}</small>
                  <strong>{temp}</strong>
                  <span>{rain} rain</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      <div className="bb-secondary-grid">
        <section className="bb-panel">
          <PanelHeader
            eyebrow="Priority Management"
            title="What Needs Attention"
            right={
              <span className="bb-count">
                3 active
              </span>
            }
          />

          <div className="bb-alert-list">
            {ALERTS.map(alert => (
              <div
                key={alert.title}
                className="bb-alert"
              >
                <div
                  className="bb-alert-accent"
                  style={{
                    background: alert.colour,
                  }}
                />

                <div className="bb-alert-copy">
                  <div>
                    <small
                      style={{
                        color: alert.colour,
                      }}
                    >
                      {alert.label}
                    </small>

                    <strong
                      style={{
                        color: alert.colour,
                      }}
                    >
                      {alert.value}
                    </strong>
                  </div>

                  <h3>{alert.title}</h3>

                  <p>{alert.description}</p>

                  <span>{alert.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className="bb-side-stack">
          <section className="bb-panel">
            <PanelHeader
              eyebrow="Changes"
              title="Last 24 Hours"
            />

            <div className="bb-change-list">
              {[
                [
                  'Open requests',
                  '+9%',
                  '#f87171',
                ],
                [
                  'Response time',
                  '-14%',
                  '#4ade80',
                ],
                [
                  'Operating cost',
                  '+4.8%',
                  '#f87171',
                ],
                [
                  'Customer score',
                  '+3.2%',
                  '#4ade80',
                ],
              ].map(
                ([label, value, colour]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong
                      style={{
                        color: colour,
                      }}
                    >
                      {value}
                    </strong>
                  </div>
                ),
              )}
            </div>
          </section>

          <section className="bb-panel">
            <PanelHeader
              eyebrow="Quick Actions"
              title="Operational Actions"
            />

            <div className="bb-actions">
              <button>
                <span>!</span>
                Review priority alerts
                <small>→</small>
              </button>

              <button>
                <span>↔</span>
                Reallocate workload
                <small>→</small>
              </button>

              <button>
                <span>+</span>
                Create operational task
                <small>→</small>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function IntelCard({
  label,
  body,
  colour,
}: {
  label: string
  body: string
  colour: string
}) {
  return (
    <div
      className="bb-intel-card"
      style={{
        borderColor: `${colour}22`,
        background: `${colour}08`,
      }}
    >
      <small
        style={{
          color: colour,
        }}
      >
        {label}
      </small>

      <p>{body}</p>
    </div>
  )
}

function FinancialTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Financial Intelligence"
        title="Understand where money is moving."
        description="Bring budgets, actuals, forecasts and cost drivers into the same operational view."
      />

      <div className="bb-kpi-four">
        {FINANCIAL_METRICS.map(item => (
          <MetricCard
            key={item.label}
            {...item}
          />
        ))}
      </div>

      <section className="bb-panel">
        <PanelHeader
          eyebrow="Cost Intelligence"
          title="Primary Cost Drivers"
          right={
            <span className="bb-muted">
              Current period
            </span>
          }
        />

        <div className="bb-cost-list">
          {COST_DRIVERS.map(
            ([label, value, movement, colour]) => (
              <div key={label}>
                <strong>{label}</strong>
                <span>{value}</span>
                <small
                  style={{
                    color: colour,
                  }}
                >
                  {movement}
                </small>
              </div>
            ),
          )}
        </div>
      </section>
    </div>
  )
}

function OperationsTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Operational Intelligence"
        title="See performance before it becomes a problem."
        description="Monitor workload, service delivery, risk and operational capacity from one workspace."
      />

      <div className="bb-kpi-four">
        <MetricCard
          label="Jobs Scheduled"
          value="326"
          note="+4.1% this week"
          colour="#60a5fa"
        />

        <MetricCard
          label="Completed"
          value="297"
          note="91.1%"
          colour="#4ade80"
        />

        <MetricCard
          label="At Risk"
          value="18"
          note="Needs attention"
          colour="#fbbf24"
        />

        <MetricCard
          label="Overdue"
          value="11"
          note="+3 today"
          colour="#f87171"
        />
      </div>

      <div className="bb-two-grid">
        <section className="bb-panel">
          <PanelHeader
            eyebrow="Service Delivery"
            title="Operational Performance"
          />

          <div className="bb-performance">
            {[
              ['North', 96, '#4ade80'],
              ['Central', 93, '#4ade80'],
              ['South', 82, '#fbbf24'],
              ['Coastal', 89, '#60a5fa'],
              ['Hills', 91, '#4ade80'],
            ].map(
              ([label, value, colour]) => (
                <div key={label}>
                  <span>{label}</span>

                  <div className="bb-progress">
                    <div
                      style={{
                        width: `${value}%`,
                        background:
                          colour as string,
                      }}
                    />
                  </div>

                  <strong
                    style={{
                      color:
                        colour as string,
                    }}
                  >
                    {value}%
                  </strong>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="bb-panel">
          <PanelHeader
            eyebrow="Live Priorities"
            title="Workload"
          />

          <div className="bb-workload">
            {[
              ['18', 'Outside target'],
              ['11', 'Due today'],
              ['42', 'In progress'],
              ['297', 'Completed'],
            ].map(([value, label]) => (
              <div key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function CustomersTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Customer Intelligence"
        title="Connect service activity to customer experience."
        description="Track demand, response performance, escalation and customer outcomes without jumping between systems."
      />

      <div className="bb-kpi-four">
        <MetricCard
          label="Requests"
          value="184"
          note="+8% this month"
          colour="#60a5fa"
        />

        <MetricCard
          label="Within Target"
          value="91%"
          note="+6 pts"
          colour="#4ade80"
        />

        <MetricCard
          label="Escalated"
          value="4"
          note="1 urgent"
          colour="#f87171"
        />

        <MetricCard
          label="Satisfaction"
          value="4.6"
          note="out of 5"
          colour="#a78bfa"
        />
      </div>

      <section className="bb-panel">
        <PanelHeader
          eyebrow="CRM"
          title="Recent Requests"
        />

        <DataTable
          headings={[
            'Request',
            'Category',
            'Status',
            'Age',
          ]}
          rows={CUSTOMER_ROWS}
        />
      </section>
    </div>
  )
}

function WorkforceTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Workforce Intelligence"
        title="Match people and capacity to demand."
        description="Understand workforce availability, coverage and pressure points before they affect service delivery."
      />

      <div className="bb-kpi-four">
        <MetricCard
          label="Available Today"
          value="54"
          note="94% coverage"
          colour="#4ade80"
        />

        <MetricCard
          label="Tomorrow"
          value="51"
          note="3 shifts uncovered"
          colour="#fbbf24"
        />

        <MetricCard
          label="Overtime"
          value="126h"
          note="+8% this period"
          colour="#f87171"
        />

        <MetricCard
          label="Leave"
          value="6"
          note="Current absences"
          colour="#60a5fa"
        />
      </div>

      <div className="bb-two-grid">
        <section className="bb-panel">
          <PanelHeader
            eyebrow="Coverage"
            title="Next 5 Days"
          />

          <div className="bb-coverage">
            {[
              ['Mon', 96],
              ['Tue', 94],
              ['Wed', 88],
              ['Thu', 91],
              ['Fri', 97],
            ].map(([day, coverage]) => (
              <div key={day}>
                <div className="bb-coverage-track">
                  <span
                    style={{
                      height: `${coverage}%`,
                    }}
                  />
                </div>

                <strong>
                  {coverage}%
                </strong>

                <small>{day}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="bb-panel">
          <PanelHeader
            eyebrow="Resource Planning"
            title="Capacity Signals"
          />

          <div className="bb-signals">
            <Signal
              colour="#f87171"
              title="South operations"
              detail="Coverage below planned requirement"
            />

            <Signal
              colour="#fbbf24"
              title="Field team 03"
              detail="Overtime trending above average"
            />

            <Signal
              colour="#4ade80"
              title="Central operations"
              detail="Capacity available for reallocation"
            />
          </div>
        </section>
      </div>
    </div>
  )
}

function Signal({
  colour,
  title,
  detail,
}: {
  colour: string
  title: string
  detail: string
}) {
  return (
    <div>
      <span
        style={{
          background: colour,
          boxShadow: `0 0 7px ${colour}55`,
        }}
      />

      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </div>
  )
}

function AssetsTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Asset Intelligence"
        title="Know what is available and what is costing you."
        description="Bring utilisation, availability, maintenance and operational impact into a single asset view."
      />

      <div className="bb-kpi-four">
        <MetricCard
          label="Total Assets"
          value="126"
          note="Tracked"
          colour="#60a5fa"
        />

        <MetricCard
          label="Available"
          value="92%"
          note="116 operational"
          colour="#4ade80"
        />

        <MetricCard
          label="Maintenance"
          value="7"
          note="Open work orders"
          colour="#fbbf24"
        />

        <MetricCard
          label="Unavailable"
          value="3"
          note="Needs action"
          colour="#f87171"
        />
      </div>

      <section className="bb-panel">
        <PanelHeader
          eyebrow="Asset Register"
          title="Operational Assets"
        />

        <DataTable
          headings={[
            'Asset',
            'Type',
            'Status',
            'Note',
          ]}
          rows={ASSET_ROWS}
        />
      </section>
    </div>
  )
}

function ReportingTab() {
  return (
    <div className="bb-tab-page">
      <PageHeading
        eyebrow="Reporting & Automation"
        title="Turn operational data into decisions."
        description="BRΛINBΛSE can surface trends, prepare reporting and automate recurring information flows around the work your team already performs."
      />

      <div className="bb-report-grid">
        {REPORTS.map(item => (
          <div
            key={item.title}
            className="bb-report-card"
          >
            <div className="bb-report-top">
              <span>{item.icon}</span>
              <small>{item.status}</small>
            </div>

            <h3>{item.title}</h3>

            <p>{item.description}</p>

            <button>
              Preview
              <span>→</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function DemoPage() {
  const [activeTab, setActiveTab] =
    useState<TabId>('overview')

  const [question, setQuestion] = useState(
    DEMO_QUESTIONS[0].question,
  )

  const [answer, setAnswer] = useState(
    DEMO_QUESTIONS[0].answer,
  )

  const [thinking, setThinking] =
    useState(false)

  const activeQuestion = useMemo(
    () =>
      DEMO_QUESTIONS.find(
        item =>
          item.question === question,
      ),
    [question],
  )

  void activeQuestion

  function askHlna(
    nextQuestion?: string,
  ) {
    const q = (
      nextQuestion ?? question
    ).trim()

    if (!q || thinking) return

    setQuestion(q)
    setThinking(true)

    window.setTimeout(() => {
      const exact =
        DEMO_QUESTIONS.find(
          item =>
            item.question.toLowerCase() ===
            q.toLowerCase(),
        )

      const lower = q.toLowerCase()

      const matched =
        exact ??
        (lower.includes('cost')
          ? DEMO_QUESTIONS[1]
          : lower.includes('risk')
            ? DEMO_QUESTIONS[2]
            : lower.includes(
                  'perform',
                )
              ? DEMO_QUESTIONS[3]
              : DEMO_QUESTIONS[0])

      setAnswer(matched.answer)
      setThinking(false)
    }, 650)
  }

  return (
    <main className="bb-demo-page">
      <style>{`
        @keyframes bbFadeUp {
          from {
            opacity: 0;
            transform: translateY(12px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes bbPulse {
          0%, 100% {
            opacity: .55;
          }

          50% {
            opacity: 1;
          }
        }

        @keyframes bbThinking {
          0%, 100% {
            opacity: .28;
            transform: translateY(0);
          }

          50% {
            opacity: 1;
            transform: translateY(-3px);
          }
        }

        * {
          box-sizing: border-box;
        }

        .bb-demo-page {
          min-height: 100vh;
          overflow-x: hidden;
          background:
            radial-gradient(
              circle at 50% -120px,
              rgba(138,77,255,.11),
              transparent 540px
            ),
            #08090c;
          color: #f5f7fa;
          font-family: ${FONT};
        }

        .bb-site-header {
          position: sticky;
          top: 0;
          z-index: 50;
          height: 62px;
          padding: 0 28px;
          display: flex;
          align-items: center;
          border-bottom:
            1px solid rgba(255,255,255,.06);
          background:
            rgba(8,9,12,.88);
          backdrop-filter: blur(18px);
        }

        .bb-logo {
          display: inline-flex;
          align-items: center;
          text-decoration: none;
        }

        .bb-logo img {
          display: block;
          height: 25px;
          width: auto;
        }

        .bb-header-spacer {
          flex: 1;
        }

        .bb-header-actions {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .bb-back {
          color:
            rgba(255,255,255,.36);
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
        }

        .bb-header-cta {
          min-height: 34px;
          padding: 0 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border:
            1px solid rgba(138,77,255,.34);
          background:
            rgba(138,77,255,.14);
          color: #c4b5fd;
          font-size: 10px;
          font-weight: 700;
          text-decoration: none;
        }

        .bb-hero {
          max-width: 1180px;
          margin: 0 auto;
          padding: 68px 28px 45px;
          text-align: center;
          animation:
            bbFadeUp .5s ease both;
        }

        .bb-orb-wrap {
          height: 102px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .bb-demo-badge {
          display: inline-flex;
          align-items: center;
          gap: 7px;
          min-height: 25px;
          padding: 0 9px;
          border-radius: 999px;
          border:
            1px solid rgba(167,139,250,.18);
          background:
            rgba(138,77,255,.065);
          color:
            rgba(196,181,253,.72);
          font-size: 7.5px;
          font-weight: 750;
          letter-spacing: .1em;
          text-transform: uppercase;
          white-space: nowrap;
        }

        .bb-demo-badge > span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #a78bfa;
          box-shadow:
            0 0 8px rgba(167,139,250,.45);
        }

        .bb-hero h1 {
          max-width: 850px;
          margin: 17px auto 15px;
          font-size:
            clamp(38px, 5vw, 60px);
          line-height: 1.04;
          letter-spacing: -.047em;
          font-weight: 700;
        }

        .bb-hero h1 span {
          background:
            linear-gradient(
              90deg,
              #a78bfa,
              #8a4dff 52%,
              #5677ff
            );
          -webkit-background-clip: text;
          -webkit-text-fill-color:
            transparent;
          background-clip: text;
        }

        .bb-hero > p {
          max-width: 700px;
          margin: 0 auto;
          color:
            rgba(245,247,250,.47);
          font-size: 14px;
          line-height: 1.7;
        }

        .bb-hero-actions {
          margin-top: 25px;
          display: flex;
          justify-content: center;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }

        .bb-primary-cta,
        .bb-secondary-cta {
          min-height: 40px;
          padding: 0 17px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border-radius: 9px;
          text-decoration: none;
          font-size: 11px;
          font-weight: 700;
        }

        .bb-primary-cta {
          background:
            linear-gradient(
              100deg,
              #6a3dff,
              #8a4dff 55%,
              #5677ff
            );
          border:
            1px solid rgba(167,139,250,.28);
          color: #fff;
          box-shadow:
            0 8px 28px rgba(106,61,255,.15);
        }

        .bb-secondary-cta {
          border:
            1px solid rgba(255,255,255,.08);
          background:
            rgba(255,255,255,.025);
          color:
            rgba(245,247,250,.58);
        }

        .bb-shell {
          max-width: 1380px;
          margin: 0 auto 90px;
          padding: 0 22px;
        }

        .bb-workspace {
          overflow: hidden;
          border-radius: 17px;
          border:
            1px solid rgba(255,255,255,.075);
          background:
            rgba(11,12,16,.90);
          box-shadow:
            0 30px 90px rgba(0,0,0,.32),
            inset 0 1px 0 rgba(255,255,255,.025);
        }

        .bb-workspace-top {
          min-height: 52px;
          padding: 0 17px;
          display: flex;
          align-items: center;
          gap: 12px;
          border-bottom:
            1px solid rgba(255,255,255,.055);
          background:
            rgba(255,255,255,.016);
        }

        .bb-workspace-brand {
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .bb-workspace-icon {
          width: 30px;
          height: 30px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          border:
            1px solid rgba(138,77,255,.18);
          background:
            rgba(138,77,255,.065);
          color: #c4b5fd;
          font-size: 13px;
        }

        .bb-workspace-brand small {
          display: block;
          margin-bottom: 2px;
          color:
            rgba(167,139,250,.47);
          font-size: 6.5px;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
        }

        .bb-workspace-brand strong {
          display: block;
          color:
            rgba(245,247,250,.70);
          font-size: 10px;
          font-weight: 700;
        }

        .bb-workspace-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 9px;
        }

        .bb-connected {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color:
            rgba(74,222,128,.65);
          font-size: 7px;
          font-weight: 700;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .bb-connected > span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #4ade80;
          box-shadow:
            0 0 7px rgba(74,222,128,.45);
          animation:
            bbPulse 2.2s ease-in-out infinite;
        }

        .bb-tabs {
          display: flex;
          align-items: stretch;
          min-height: 43px;
          padding: 0 12px;
          overflow-x: auto;
          scrollbar-width: none;
          border-bottom:
            1px solid rgba(255,255,255,.05);
        }

        .bb-tabs::-webkit-scrollbar {
          display: none;
        }

        .bb-tabs button {
          position: relative;
          height: 43px;
          padding: 0 16px;
          flex-shrink: 0;
          border: 0;
          border-bottom:
            2px solid transparent;
          background: transparent;
          color:
            rgba(255,255,255,.30);
          font-family: ${FONT};
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
        }

        .bb-tabs button:hover {
          color:
            rgba(255,255,255,.65);
        }

        .bb-tabs button.active {
          border-bottom-color:
            #8a4dff;
          background:
            rgba(138,77,255,.055);
          color: #c4b5fd;
        }

        .bb-connected-context {
          padding: 16px 17px;
          border-bottom:
            1px solid rgba(255,255,255,.05);
          background:
            rgba(138,77,255,.025);
        }

        .bb-connected-context strong {
          display: block;
          margin-bottom: 4px;
          color: #f5f7fa;
          font-size: 12px;
          font-weight: 700;
        }

        .bb-connected-context > p {
          margin: 0 0 11px;
          max-width: 640px;
          color: rgba(226,232,240,.48);
          font-size: 11px;
          line-height: 1.55;
        }

        .bb-connection-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .bb-connection-list span {
          padding: 6px 11px;
          border-radius: 999px;
          border:
            1px solid rgba(255,255,255,.07);
          background:
            rgba(255,255,255,.02);
          color: rgba(226,232,240,.55);
          font-size: 10px;
          line-height: 1.4;
        }

        .bb-content {
          min-height: 700px;
          padding: 13px;
        }

        .bb-tab-page {
          animation:
            bbFadeUp .25s ease both;
        }

        .bb-scenario-bar {
          margin-bottom: 12px;
          padding: 13px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 14px;
          flex-wrap: wrap;
          border-radius: 12px;
          border:
            1px solid rgba(138,77,255,.14);
          background:
            rgba(138,77,255,.04);
        }

        .bb-scenario-bar strong {
          display: block;
          margin-bottom: 2px;
          color: #f5f7fa;
          font-size: 11.5px;
          font-weight: 700;
        }

        .bb-scenario-bar span {
          color: rgba(226,232,240,.44);
          font-size: 10.5px;
        }

        .bb-scenario-button {
          flex-shrink: 0;
          min-height: 34px;
          padding: 0 15px;
          border-radius: 8px;
          border:
            1px solid rgba(167,139,250,.30);
          background:
            rgba(138,77,255,.14);
          color: #c4b5fd;
          font-family: ${FONT};
          font-size: 10.5px;
          font-weight: 700;
          cursor: pointer;
        }

        .bb-scenario-button:disabled {
          opacity: .55;
          cursor: not-allowed;
        }

        .bb-scenario-log {
          margin-bottom: 12px;
          padding: 13px 16px;
          border-radius: 12px;
          border:
            1px solid rgba(255,255,255,.06);
          background:
            rgba(255,255,255,.018);
          animation:
            bbFadeUp .25s ease both;
        }

        .bb-scenario-log-line {
          padding: 5px 0;
          color: rgba(226,232,240,.62);
          font-size: 11px;
          line-height: 1.5;
          animation:
            bbFadeUp .3s ease both;
        }

        .bb-scenario-log-line:not(:last-child) {
          border-bottom:
            1px solid rgba(255,255,255,.04);
        }

        .bb-scenario-note {
          margin-top: 8px;
          color: rgba(255,255,255,.24);
          font-size: 9px;
        }

        .bb-kpi-five,
        .bb-kpi-four {
          display: grid;
          overflow: hidden;
          margin-bottom: 11px;
          border-radius: 12px;
          border:
            1px solid rgba(255,255,255,.065);
        }

        .bb-kpi-five {
          grid-template-columns:
            repeat(5, minmax(0,1fr));
        }

        .bb-kpi-four {
          grid-template-columns:
            repeat(4, minmax(0,1fr));
        }

        .bb-metric {
          position: relative;
          min-height: 112px;
          padding: 15px 17px;
          border-right:
            1px solid rgba(255,255,255,.05);
          background:
            rgba(255,255,255,.021);
        }

        .bb-metric-line {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          height: 1px;
        }

        .bb-metric-label {
          margin-bottom: 11px;
          color:
            rgba(255,255,255,.31);
          font-size: 7.5px;
          font-weight: 750;
          letter-spacing: .12em;
          text-transform: uppercase;
        }

        .bb-metric-bottom {
          display: flex;
          align-items: flex-end;
          justify-content: space-between;
          gap: 10px;
        }

        .bb-metric strong {
          display: block;
          margin-bottom: 7px;
          color:
            rgba(245,247,250,.92);
          font-size: 28px;
          line-height: 1;
          letter-spacing: -.035em;
        }

        .bb-metric small {
          display: block;
          font-size: 8px;
          font-weight: 650;
        }

        .bb-spark {
          height: 28px;
          display: flex;
          align-items: flex-end;
          gap: 3px;
        }

        .bb-spark span {
          width: 4px;
          border-radius:
            2px 2px 0 0;
          background:
            rgba(138,77,255,.30);
        }

        .bb-status-grid {
          min-height: 60px;
          margin-bottom: 11px;
          display: grid;
          grid-template-columns:
            repeat(6, minmax(0,1fr));
          overflow: hidden;
          border-radius: 11px;
          border:
            1px solid rgba(255,255,255,.06);
          background:
            rgba(255,255,255,.017);
        }

        .bb-status-item {
          padding: 11px 12px;
          display: flex;
          align-items: center;
          gap: 8px;
          border-right:
            1px solid rgba(255,255,255,.045);
        }

        .bb-status-item > span {
          width: 6px;
          height: 6px;
          flex-shrink: 0;
          border-radius: 50%;
        }

        .bb-status-item strong {
          display: block;
          margin-bottom: 2px;
          color:
            rgba(255,255,255,.49);
          font-size: 9px;
          font-weight: 600;
        }

        .bb-status-item small {
          display: block;
          font-size: 6.5px;
          font-weight: 750;
          letter-spacing: .07em;
          text-transform: uppercase;
        }

        .bb-primary-grid,
        .bb-secondary-grid,
        .bb-two-grid {
          display: grid;
          gap: 11px;
        }

        .bb-primary-grid,
        .bb-secondary-grid {
          grid-template-columns:
            minmax(0,2fr)
            minmax(280px,.9fr);
        }

        .bb-primary-grid {
          margin-bottom: 11px;
        }

        .bb-two-grid {
          grid-template-columns:
            repeat(2,minmax(0,1fr));
        }

        .bb-side-stack {
          display: grid;
          gap: 11px;
        }

        .bb-panel {
          overflow: hidden;
          border-radius: 13px;
          border:
            1px solid rgba(255,255,255,.065);
          background:
            rgba(255,255,255,.02);
        }

        .bb-hlna-panel {
          border-color:
            rgba(138,77,255,.16);
          background:
            linear-gradient(
              120deg,
              rgba(99,102,241,.045),
              rgba(138,77,255,.022) 52%,
              rgba(255,255,255,.015)
            );
        }

        .bb-panel-head {
          min-height: 54px;
          padding: 11px 16px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 15px;
          border-bottom:
            1px solid rgba(255,255,255,.05);
        }

        .bb-panel-head small {
          display: block;
          margin-bottom: 3px;
          color:
            rgba(167,139,250,.45);
          font-size: 6.5px;
          font-weight: 750;
          letter-spacing: .13em;
          text-transform: uppercase;
        }

        .bb-panel-head strong {
          display: block;
          color:
            rgba(245,247,250,.64);
          font-size: 9.5px;
          font-weight: 700;
          letter-spacing: .075em;
          text-transform: uppercase;
        }

        .bb-muted {
          color:
            rgba(255,255,255,.24);
          font-size: 8px;
        }

        .bb-hlna-body {
          padding: 16px;
        }

        .bb-current-briefing {
          margin-bottom: 13px;
          padding-bottom: 13px;
          border-bottom:
            1px solid rgba(255,255,255,.05);
        }

        .bb-current-briefing small {
          display: block;
          margin-bottom: 5px;
          color:
            rgba(167,139,250,.48);
          font-size: 7px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .bb-current-briefing p {
          margin: 0;
          color:
            rgba(245,247,250,.66);
          font-size: 11px;
          line-height: 1.6;
        }

        .bb-intel-grid {
          display: grid;
          grid-template-columns:
            repeat(2,minmax(0,1fr));
          gap: 8px;
        }

        .bb-intel-card {
          padding: 12px;
          border-radius: 9px;
          border: 1px solid;
        }

        .bb-intel-card small {
          display: block;
          margin-bottom: 5px;
          font-size: 7px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .bb-intel-card p {
          margin: 0;
          color:
            rgba(245,247,250,.47);
          font-size: 9px;
          line-height: 1.55;
        }

        .bb-question-pills,
        .bb-hlna-suggestions {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }

        .bb-question-pills {
          margin-top: 13px;
        }

        .bb-question-pills button,
        .bb-hlna-suggestions button {
          padding: 6px 9px;
          border-radius: 7px;
          border:
            1px solid rgba(138,77,255,.14);
          background:
            rgba(138,77,255,.045);
          color:
            rgba(196,181,253,.59);
          font-family: ${FONT};
          font-size: 8px;
          cursor: pointer;
        }

        .bb-weather {
          padding: 16px;
        }

        .bb-weather-main {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
        }

        .bb-weather-main strong {
          display: block;
          margin-bottom: 4px;
          font-size: 35px;
          line-height: 1;
        }

        .bb-weather-main span {
          color:
            rgba(255,255,255,.38);
          font-size: 9px;
        }

        .bb-weather-icon {
          font-size: 34px;
        }

        .bb-weather-ok {
          margin-bottom: 15px;
          padding: 8px 10px;
          display: flex;
          align-items: center;
          gap: 7px;
          border-radius: 8px;
          background:
            rgba(74,222,128,.04);
          border:
            1px solid rgba(74,222,128,.10);
          color:
            rgba(74,222,128,.62);
          font-size: 8px;
        }

        .bb-weather-ok span {
          width: 5px;
          height: 5px;
          border-radius: 50%;
          background: #4ade80;
        }

        .bb-weather-days {
          display: grid;
          grid-template-columns:
            repeat(5,1fr);
          gap: 5px;
        }

        .bb-weather-days > div {
          padding: 7px 4px;
          text-align: center;
          border-radius: 7px;
          background:
            rgba(255,255,255,.018);
          border:
            1px solid rgba(255,255,255,.04);
        }

        .bb-weather-days small,
        .bb-weather-days span {
          display: block;
          font-size: 6.5px;
          color:
            rgba(255,255,255,.24);
        }

        .bb-weather-days strong {
          display: block;
          margin: 4px 0;
          font-size: 10px;
        }

        .bb-alert-list {
          display: grid;
        }

        .bb-alert {
          position: relative;
          min-height: 105px;
          padding: 14px 15px 14px 18px;
          border-bottom:
            1px solid rgba(255,255,255,.045);
        }

        .bb-alert:last-child {
          border-bottom: 0;
        }

        .bb-alert-accent {
          position: absolute;
          top: 15px;
          bottom: 15px;
          left: 0;
          width: 2px;
        }

        .bb-alert-copy > div {
          display: flex;
          justify-content: space-between;
          gap: 10px;
        }

        .bb-alert-copy > div small {
          font-size: 7px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .bb-alert-copy > div strong {
          font-size: 14px;
        }

        .bb-alert h3 {
          margin: 5px 0;
          color:
            rgba(245,247,250,.67);
          font-size: 10px;
        }

        .bb-alert p {
          margin: 0 0 4px;
          color:
            rgba(255,255,255,.33);
          font-size: 8px;
          line-height: 1.5;
        }

        .bb-alert-copy > span {
          color:
            rgba(255,255,255,.20);
          font-size: 7px;
        }

        .bb-count {
          padding: 4px 7px;
          border-radius: 999px;
          background:
            rgba(248,113,113,.055);
          border:
            1px solid rgba(248,113,113,.12);
          color:
            rgba(248,113,113,.60);
          font-size: 7px;
        }

        .bb-change-list {
          padding: 8px 15px;
        }

        .bb-change-list > div {
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          border-bottom:
            1px solid rgba(255,255,255,.04);
        }

        .bb-change-list > div:last-child {
          border-bottom: 0;
        }

        .bb-change-list span {
          color:
            rgba(255,255,255,.37);
          font-size: 8px;
        }

        .bb-change-list strong {
          font-size: 8px;
        }

        .bb-actions {
          padding: 9px;
          display: grid;
          gap: 6px;
        }

        .bb-actions button {
          min-height: 34px;
          padding: 0 10px;
          display: flex;
          align-items: center;
          gap: 8px;
          border-radius: 7px;
          border:
            1px solid rgba(255,255,255,.045);
          background:
            rgba(255,255,255,.018);
          color:
            rgba(255,255,255,.40);
          font-family: ${FONT};
          font-size: 8px;
          cursor: pointer;
        }

        .bb-actions button > span {
          width: 19px;
          height: 19px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 5px;
          color: #a78bfa;
          background:
            rgba(138,77,255,.08);
        }

        .bb-actions small {
          margin-left: auto;
        }

        .bb-tab-heading {
          min-height: 105px;
          padding: 12px 3px 22px;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 25px;
        }

        .bb-tab-heading > div:first-child {
          max-width: 650px;
        }

        .bb-tab-heading small {
          display: block;
          margin-bottom: 7px;
          color:
            rgba(167,139,250,.56);
          font-size: 7px;
          font-weight: 750;
          letter-spacing: .11em;
          text-transform: uppercase;
        }

        .bb-tab-heading h2 {
          margin: 0 0 7px;
          font-size: 23px;
          letter-spacing: -.025em;
        }

        .bb-tab-heading p {
          margin: 0;
          color:
            rgba(255,255,255,.38);
          font-size: 10px;
          line-height: 1.6;
        }

        .bb-cost-list {
          padding: 5px 15px;
        }

        .bb-cost-list > div {
          min-height: 46px;
          display: grid;
          grid-template-columns:
            1.5fr 1fr 1fr;
          align-items: center;
          gap: 15px;
          border-bottom:
            1px solid rgba(255,255,255,.045);
        }

        .bb-cost-list > div:last-child {
          border-bottom: 0;
        }

        .bb-cost-list strong,
        .bb-cost-list span,
        .bb-cost-list small {
          font-size: 9px;
        }

        .bb-cost-list strong {
          color:
            rgba(245,247,250,.56);
        }

        .bb-cost-list span {
          color:
            rgba(255,255,255,.34);
        }

        .bb-performance {
          padding: 15px;
        }

        .bb-performance > div {
          min-height: 42px;
          display: grid;
          grid-template-columns:
            70px 1fr 40px;
          align-items: center;
          gap: 10px;
        }

        .bb-performance span,
        .bb-performance strong {
          font-size: 8px;
        }

        .bb-performance span {
          color:
            rgba(255,255,255,.38);
        }

        .bb-progress {
          height: 5px;
          overflow: hidden;
          border-radius: 999px;
          background:
            rgba(255,255,255,.04);
        }

        .bb-progress > div {
          height: 100%;
          border-radius: inherit;
        }

        .bb-workload {
          padding: 15px;
          display: grid;
          grid-template-columns:
            repeat(2,1fr);
          gap: 8px;
        }

        .bb-workload > div {
          min-height: 75px;
          padding: 12px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          border-radius: 9px;
          background:
            rgba(255,255,255,.018);
          border:
            1px solid rgba(255,255,255,.045);
        }

        .bb-workload strong {
          margin-bottom: 4px;
          font-size: 20px;
        }

        .bb-workload span {
          color:
            rgba(255,255,255,.28);
          font-size: 8px;
        }

        .bb-table-wrap {
          overflow-x: auto;
        }

        .bb-table {
          display: grid;
          min-width: 620px;
        }

        .bb-table-heading,
        .bb-table-cell {
          min-height: 42px;
          padding: 0 15px;
          display: flex;
          align-items: center;
          border-bottom:
            1px solid rgba(255,255,255,.04);
        }

        .bb-table-heading {
          background:
            rgba(255,255,255,.015);
          color:
            rgba(255,255,255,.25);
          font-size: 7px;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
        }

        .bb-table-cell {
          color:
            rgba(255,255,255,.40);
          font-size: 9px;
        }

        .bb-table-strong {
          color:
            rgba(245,247,250,.63);
          font-weight: 650;
        }

        .bb-coverage {
          height: 240px;
          padding: 22px 20px 17px;
          display: flex;
          justify-content: space-around;
          align-items: flex-end;
          gap: 10px;
        }

        .bb-coverage > div {
          width: 50px;
          height: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: flex-end;
        }

        .bb-coverage-track {
          width: 13px;
          height: 150px;
          margin-bottom: 8px;
          display: flex;
          align-items: flex-end;
          overflow: hidden;
          border-radius: 999px;
          background:
            rgba(255,255,255,.04);
        }

        .bb-coverage-track span {
          width: 100%;
          display: block;
          border-radius: inherit;
          background:
            linear-gradient(
              180deg,
              #8a4dff,
              #5677ff
            );
        }

        .bb-coverage strong {
          margin-bottom: 3px;
          font-size: 9px;
        }

        .bb-coverage small {
          color:
            rgba(255,255,255,.26);
          font-size: 7px;
        }

        .bb-signals {
          padding: 15px;
          display: grid;
          gap: 8px;
        }

        .bb-signals > div {
          min-height: 58px;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-radius: 8px;
          background:
            rgba(255,255,255,.018);
          border:
            1px solid rgba(255,255,255,.045);
        }

        .bb-signals > div > span {
          width: 7px;
          height: 7px;
          flex-shrink: 0;
          border-radius: 50%;
        }

        .bb-signals strong {
          display: block;
          margin-bottom: 3px;
          color:
            rgba(245,247,250,.59);
          font-size: 9px;
        }

        .bb-signals small {
          display: block;
          color:
            rgba(255,255,255,.29);
          font-size: 8px;
        }

        .bb-report-grid {
          display: grid;
          grid-template-columns:
            repeat(4,minmax(0,1fr));
          gap: 10px;
        }

        .bb-report-card {
          min-height: 245px;
          padding: 19px;
          display: flex;
          flex-direction: column;
          border-radius: 12px;
          border:
            1px solid rgba(255,255,255,.06);
          background:
            rgba(255,255,255,.018);
        }

        .bb-report-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 18px;
        }

        .bb-report-top > span {
          width: 33px;
          height: 33px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          background:
            rgba(138,77,255,.07);
          border:
            1px solid rgba(138,77,255,.14);
          color: #a78bfa;
        }

        .bb-report-top small {
          color:
            rgba(74,222,128,.55);
          font-size: 7px;
          text-transform: uppercase;
        }

        .bb-report-card h3 {
          margin: 0 0 8px;
          font-size: 12px;
        }

        .bb-report-card p {
          margin: 0 0 18px;
          color:
            rgba(255,255,255,.34);
          font-size: 9px;
          line-height: 1.6;
          flex: 1;
        }

        .bb-report-card button {
          min-height: 32px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          border: 0;
          border-top:
            1px solid rgba(255,255,255,.045);
          background: transparent;
          color:
            rgba(167,139,250,.58);
          font-family: ${FONT};
          font-size: 8px;
          cursor: pointer;
        }

        .bb-hlna-dock {
          margin-top: 12px;
          padding: 15px;
          border-radius: 13px;
          border:
            1px solid rgba(138,77,255,.15);
          background:
            linear-gradient(
              120deg,
              rgba(99,102,241,.04),
              rgba(138,77,255,.028),
              rgba(255,255,255,.012)
            );
        }

        .bb-hlna-dock-head {
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .bb-hlna-dock-label {
          margin-bottom: 2px;
          color:
            rgba(167,139,250,.46);
          font-size: 6.5px;
          font-weight: 750;
          letter-spacing: .1em;
          text-transform: uppercase;
        }

        .bb-hlna-dock-title {
          color:
            rgba(245,247,250,.62);
          font-size: 9px;
          font-weight: 650;
        }

        .bb-hlna-dock-head .bb-connected {
          margin-left: auto;
        }

        .bb-hlna-dock-framing {
          margin-bottom: 12px;
          color: rgba(226,232,240,.38);
          font-size: 10px;
          line-height: 1.5;
        }

        .bb-hlna-answer {
          min-height: 72px;
          padding: 13px 14px;
          margin-bottom: 10px;
          border-radius: 9px;
          background:
            rgba(255,255,255,.018);
          border:
            1px solid rgba(255,255,255,.045);
          color:
            rgba(245,247,250,.54);
          font-size: 9.5px;
          line-height: 1.65;
        }

        .bb-thinking {
          min-height: 72px;
          margin-bottom: 10px;
          padding: 13px;
          display: flex;
          align-items: center;
          gap: 5px;
          border-radius: 9px;
          background:
            rgba(255,255,255,.018);
          border:
            1px solid rgba(255,255,255,.045);
        }

        .bb-thinking span {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: #a78bfa;
          animation:
            bbThinking .75s infinite ease-in-out;
        }

        .bb-thinking span:nth-child(2) {
          animation-delay: .12s;
        }

        .bb-thinking span:nth-child(3) {
          animation-delay: .24s;
        }

        .bb-hlna-suggestions {
          margin-bottom: 10px;
        }

        .bb-hlna-form {
          display: flex;
          gap: 7px;
        }

        .bb-hlna-form input {
          min-width: 0;
          min-height: 38px;
          padding: 0 12px;
          flex: 1;
          border-radius: 8px;
          outline: 0;
          border:
            1px solid rgba(255,255,255,.065);
          background:
            rgba(0,0,0,.18);
          color:
            rgba(245,247,250,.72);
          font-family: ${FONT};
          font-size: 9px;
        }

        .bb-hlna-form input:focus {
          border-color:
            rgba(138,77,255,.30);
        }

        .bb-hlna-form button {
          min-height: 38px;
          padding: 0 14px;
          border-radius: 8px;
          border:
            1px solid rgba(138,77,255,.24);
          background:
            rgba(138,77,255,.11);
          color: #c4b5fd;
          font-family: ${FONT};
          font-size: 8px;
          font-weight: 700;
          cursor: pointer;
        }

        .bb-hlna-form button:disabled {
          opacity: .4;
          cursor: default;
        }

        .bb-config-note {
          max-width: 620px;
          margin: 0 auto 56px;
          padding: 0 22px;
          text-align: center;
        }

        .bb-config-note strong {
          display: block;
          margin-bottom: 6px;
          color: #f5f7fa;
          font-size: 13px;
          font-weight: 700;
        }

        .bb-config-note p {
          margin: 0;
          color: rgba(226,232,240,.46);
          font-size: 11.5px;
          line-height: 1.65;
        }

        .bb-tertiary-link {
          display: inline-block;
          margin-top: 14px;
          color: rgba(196,181,253,.62);
          font-size: 11px;
          font-weight: 600;
          text-decoration: none;
        }

        .bb-bottom-cta {
          max-width: 900px;
          margin: 0 auto 100px;
          padding: 0 22px;
          text-align: center;
        }

        .bb-bottom-cta-box {
          padding: 46px 30px;
          border-radius: 18px;
          border:
            1px solid rgba(138,77,255,.14);
          background:
            linear-gradient(
              135deg,
              rgba(138,77,255,.065),
              rgba(255,255,255,.018)
            );
        }

        .bb-bottom-cta h2 {
          margin: 14px 0 10px;
          font-size: 27px;
          line-height: 1.12;
          letter-spacing: -.03em;
        }

        .bb-bottom-cta p {
          max-width: 570px;
          margin: 0 auto 21px;
          color:
            rgba(255,255,255,.40);
          font-size: 11px;
          line-height: 1.65;
        }

        @media (max-width: 1050px) {
          .bb-kpi-five {
            grid-template-columns:
              repeat(3,minmax(0,1fr));
          }

          .bb-kpi-four,
          .bb-report-grid {
            grid-template-columns:
              repeat(2,minmax(0,1fr));
          }

          .bb-status-grid {
            grid-template-columns:
              repeat(3,minmax(0,1fr));
          }

          .bb-primary-grid,
          .bb-secondary-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 700px) {
          .bb-site-header {
            height: 56px;
            padding: 0 16px;
          }

          .bb-logo img {
            height: 21px;
          }

          .bb-back {
            display: none;
          }

          .bb-header-cta {
            padding: 0 10px;
            font-size: 8px;
          }

          .bb-hero {
            padding: 46px 20px 35px;
          }

          .bb-orb-wrap {
            height: 88px;
          }

          .bb-hero h1 {
            font-size:
              clamp(34px,11vw,46px);
          }

          .bb-hero > p {
            font-size: 12.5px;
          }

          .bb-shell {
            padding: 0 10px;
          }

          .bb-workspace {
            border-radius: 13px;
          }

          .bb-workspace-top {
            padding: 0 12px;
          }

          .bb-workspace-right
          .bb-connected {
            display: none;
          }

          .bb-content {
            padding: 9px;
          }

          .bb-kpi-five,
          .bb-kpi-four,
          .bb-status-grid,
          .bb-intel-grid,
          .bb-two-grid,
          .bb-report-grid {
            grid-template-columns:
              repeat(2,minmax(0,1fr));
          }

          .bb-tab-heading {
            flex-direction: column;
            gap: 14px;
          }

          .bb-weather-days {
            grid-template-columns:
              repeat(5,1fr);
          }
        }

        @media (max-width: 470px) {
          .bb-hero-actions {
            flex-direction: column;
          }

          .bb-primary-cta,
          .bb-secondary-cta {
            width: 100%;
          }

          .bb-kpi-five,
          .bb-kpi-four,
          .bb-status-grid,
          .bb-intel-grid,
          .bb-two-grid,
          .bb-report-grid {
            grid-template-columns: 1fr;
          }

          .bb-metric {
            border-right: 0;
          }

          .bb-question-pills {
            display: none;
          }

          .bb-hlna-form {
            flex-direction: column;
          }

          .bb-hlna-form button {
            width: 100%;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          *,
          *::before,
          *::after {
            animation-duration:
              .001ms !important;
            animation-iteration-count:
              1 !important;
            transition-duration:
              .001ms !important;
          }
        }
      `}</style>

      {/* HEADER */}

      <header className="bb-site-header">
        <Link
          href="/"
          className="bb-logo"
        >
          <BrainBaseWordmark
            width={140}
          />
        </Link>

        <div className="bb-header-spacer" />

        <div className="bb-header-actions">
          <Link
            href="/"
            className="bb-back"
          >
            Back to BRΛINBΛSE
          </Link>

          <Link
            href="/request-demo"
            className="bb-header-cta"
          >
            Request a demo
          </Link>
        </div>
      </header>

      {/* HERO */}

      <section className="bb-hero">
        <div className="bb-orb-wrap">
          <HlnaOrb
            size={100}
            state={
              thinking
                ? 'thinking'
                : 'idle'
            }
          />
        </div>

        <DemoBadge />

        <h1>
          See how a{' '}
          <span>connected operation</span> works.
        </h1>

        <p>
          Explore an example BRΛINBΛSE environment
          showing how operational information,
          workflows, dashboards and HLNΛ come together
          in one platform. Everything below is an
          example environment using simulated demo
          data.
        </p>

        <div className="bb-hero-actions">
          <a
            href="#workspace"
            className="bb-primary-cta"
          >
            Explore the platform
            <span>↓</span>
          </a>

          <Link
            href="/pricing"
            className="bb-secondary-cta"
          >
            View pricing
          </Link>
        </div>
      </section>

      {/* PLATFORM WORKSPACE */}

      <section
        id="workspace"
        className="bb-shell"
      >
        <div className="bb-workspace">
          <div className="bb-workspace-top">
            <div className="bb-workspace-brand">
              <div className="bb-workspace-icon">
                ◈
              </div>

              <div>
                <small>
                  BRΛINBΛSE Platform
                </small>

                <strong>
                  Interactive Platform Demo
                </strong>
              </div>
            </div>

            <div className="bb-workspace-right">
              <DemoBadge />

              <div className="bb-connected">
                <span />
                HLNΛ connected
              </div>
            </div>
          </div>

          <div className="bb-connected-context">
            <strong>
              Different views. One connected operation.
            </strong>

            <p>
              Financial, customers, workforce, assets
              and reporting are not separate products —
              they are views into the same connected
              environment. A change in one shows up in
              the others, for example:
            </p>

            <div className="bb-connection-list">
              <span>
                18 requests outside target → Operations
                risk
              </span>

              <span>
                3 uncovered shifts tomorrow → workforce
                risk
              </span>

              <span>
                Fleet Unit 08 maintenance · maintenance
                costs trending up
              </span>
            </div>
          </div>

          <nav className="bb-tabs">
            {TABS.map(tab => (
              <button
                key={tab.id}
                className={
                  activeTab === tab.id
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  setActiveTab(tab.id)
                }
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="bb-content">
            {activeTab ===
              'overview' && (
              <OverviewTab
                askHlna={q => {
                  setQuestion(q)
                  askHlna(q)
                }}
              />
            )}

            {activeTab ===
              'financial' && (
              <FinancialTab />
            )}

            {activeTab ===
              'operations' && (
              <OperationsTab />
            )}

            {activeTab ===
              'customers' && (
              <CustomersTab />
            )}

            {activeTab ===
              'workforce' && (
              <WorkforceTab />
            )}

            {activeTab ===
              'assets' && (
              <AssetsTab />
            )}

            {activeTab ===
              'reporting' && (
              <ReportingTab />
            )}

            {/* HLNΛ DOCK */}

            <section className="bb-hlna-dock">
              <div className="bb-hlna-dock-head">
                <HlnaOrb
                  size={32}
                  state={
                    thinking
                      ? 'thinking'
                      : 'idle'
                  }
                />

                <div>
                  <div className="bb-hlna-dock-label">
                    Intelligence Layer
                  </div>

                  <div className="bb-hlna-dock-title">
                    Ask the operation
                  </div>
                </div>

                <div className="bb-connected">
                  <span />
                  Ready
                </div>
              </div>

              <div className="bb-hlna-dock-framing">
                HLNΛ helps interpret this connected
                operation — it does not replace the
                underlying operational system.
              </div>

              {thinking ? (
                <div className="bb-thinking">
                  <span />
                  <span />
                  <span />
                </div>
              ) : (
                <div className="bb-hlna-answer">
                  {answer}
                </div>
              )}

              <div className="bb-hlna-suggestions">
                {DEMO_QUESTIONS.map(
                  item => (
                    <button
                      key={item.question}
                      onClick={() => {
                        setQuestion(
                          item.question,
                        )

                        askHlna(
                          item.question,
                        )
                      }}
                    >
                      {item.question}
                    </button>
                  ),
                )}
              </div>

              <form
                className="bb-hlna-form"
                onSubmit={event => {
                  event.preventDefault()
                  askHlna()
                }}
              >
                <input
                  value={question}
                  onChange={event =>
                    setQuestion(
                      event.target.value,
                    )
                  }
                  placeholder="Ask HLNΛ about operations, costs, customers or risk…"
                />

                <button
                  type="submit"
                  disabled={
                    !question.trim() ||
                    thinking
                  }
                >
                  {thinking
                    ? 'Thinking…'
                    : 'Ask HLNΛ'}
                </button>
              </form>
            </section>
          </div>
        </div>
      </section>

      {/* CONFIGURABILITY */}

      <section className="bb-config-note">
        <strong>This is one example configuration.</strong>

        <p>
          Same platform. Different operation. Another
          organisation could use a different
          combination of BRΛINBΛSE capabilities,
          configured around how it works.
        </p>
      </section>

      {/* FINAL CTA */}

      <section className="bb-bottom-cta">
        <div className="bb-bottom-cta-box">
          <DemoBadge />

          <h2>
            What would BRΛINBΛSE look like
            <br />
            around your operation?
          </h2>

          <p>
            BRΛINBΛSE can be configured around how
            your organisation already works —
            connecting information, workflows,
            reporting and intelligence without
            forcing the business into another
            disconnected tool.
          </p>

          <div className="bb-hero-actions">
            <Link
              href="/request-demo"
              className="bb-primary-cta"
            >
              Discuss your operation
              <span>→</span>
            </Link>

            <Link
              href="/client-operations"
              className="bb-secondary-cta"
            >
              Explore Client Operations
            </Link>
          </div>

          <Link
            href="/web-systems"
            className="bb-tertiary-link"
          >
            or explore Web Systems →
          </Link>
        </div>
      </section>

      <div
        style={{
          margin: '32px 0 40px',
          textAlign: 'center',
          display: 'flex',
          justifyContent: 'center',
          gap: 14,
          fontSize: 10,
        }}
      >
        <Link
          href="/privacy"
          style={{
            color: 'rgba(255,255,255,.28)',
            textDecoration: 'none',
          }}
        >
          Privacy
        </Link>

        <Link
          href="/terms"
          style={{
            color: 'rgba(255,255,255,.28)',
            textDecoration: 'none',
          }}
        >
          Terms
        </Link>
      </div>
    </main>
  )
}