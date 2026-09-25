'use client'

import { useState, type ReactNode } from 'react'
import { Badge, LiveRegion, StatusDot, type SemanticState } from '@/components/ui/semantic'
import {
  ALERTS,
  ASSET_ROWS,
  COST_DRIVERS,
  CUSTOMER_ROWS,
  DEMO_QUESTIONS,
  FINANCIAL_METRICS,
  REPORTS,
  SCENARIO_STEPS,
  SYSTEM_STATUS,
  type Metric,
  type Tone,
} from './data'
import styles from './demo.module.css'

// The /demo workspace views. Layout, copy and behaviour are carried over
// from the previous app/demo/page.tsx; presentation moved to --bb-* tokens.

const TONE_CLASS: Record<Tone, string> = {
  success: styles.toneSuccess,
  warning: styles.toneWarning,
  error: styles.toneError,
  info: styles.toneInfo,
  active: styles.toneActive,
}

export function tone(t: Tone) {
  return TONE_CLASS[t]
}

const TONE_STATE: Record<Tone, SemanticState> = {
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  active: 'active',
}

export function DemoBadge() {
  return <Badge state="info">Demo data</Badge>
}

function MetricCard({ label, value, note, tone: t }: Metric) {
  return (
    <div className={`${styles.metric} ${tone(t)}`}>
      <div className={styles.metricLabel}>{label}</div>
      <div className={styles.metricBottom}>
        <div>
          <strong>{value}</strong>
          <small>{note}</small>
        </div>
        <div className={styles.spark} aria-hidden="true">
          {[32, 46, 40, 61, 54, 78].map((height, index) => (
            <span
              key={index}
              className={index === 5 ? styles.sparkLast : undefined}
              style={{ height: `${height}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function PanelHeader({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <div className={styles.panelHead}>
      <div>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
      </div>
      {right}
    </div>
  )
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className={styles.tabHeading}>
      <div>
        <small>{eyebrow}</small>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <DemoBadge />
    </div>
  )
}

function DataTable({ caption, headings, rows }: { caption: string; headings: string[]; rows: string[][] }) {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="bb-visually-hidden">{caption}</caption>
        <thead>
          <tr>
            {headings.map(heading => (
              <th key={heading} scope="col">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row[0]}>
              {row.map((cell, cellIndex) =>
                cellIndex === 0 ? (
                  <th key={cellIndex} scope="row">
                    {cell}
                  </th>
                ) : (
                  <td key={cellIndex}>{cell}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function IntelCard({ label, body, tone: t }: { label: string; body: string; tone: Tone }) {
  return (
    <div className={`${styles.intelCard} ${tone(t)}`}>
      <small>{label}</small>
      <p>{body}</p>
    </div>
  )
}

export function OverviewTab({ askHlna }: { askHlna: (question: string) => void }) {
  const [scenarioStep, setScenarioStep] = useState(0)
  const [scenarioLog, setScenarioLog] = useState<string[]>([])

  const openRequests = scenarioStep >= 2 ? 49 : 48

  function runScenario() {
    if (scenarioStep > 0) return

    setScenarioStep(1)
    setScenarioLog([SCENARIO_STEPS[0]])

    window.setTimeout(() => {
      setScenarioLog(log => [...log, SCENARIO_STEPS[1]])
      setScenarioStep(2)

      window.setTimeout(() => {
        setScenarioLog(log => [...log, SCENARIO_STEPS[2]])
        setScenarioStep(3)

        window.setTimeout(() => {
          setScenarioLog(log => [...log, SCENARIO_STEPS[3]])
          setScenarioStep(4)
        }, 700)
      }, 700)
    }, 700)
  }

  function resetScenario() {
    setScenarioStep(0)
    setScenarioLog([])
  }

  // Announce the scenario's start and finish only — not every intermediate
  // log line — so the simulation never floods a screen reader.
  const scenarioAnnouncement =
    scenarioStep === 0 ? '' : scenarioStep < 4 ? 'Scenario started' : 'Scenario complete'

  return (
    <div className={styles.tabPage}>
      <div className={styles.scenarioBar}>
        <div>
          <strong>Try it: run an example scenario</strong>
          <span>See how a new request moves through the connected operation.</span>
        </div>

        <button
          type="button"
          onClick={scenarioStep === 4 ? resetScenario : runScenario}
          disabled={scenarioStep > 0 && scenarioStep < 4}
          className={styles.scenarioButton}
        >
          {scenarioStep === 0 ? 'Run scenario' : scenarioStep < 4 ? 'Running…' : 'Reset scenario'}
        </button>
      </div>

      <LiveRegion message={scenarioAnnouncement} />

      {scenarioLog.length > 0 && (
        <ol className={styles.scenarioLog}>
          {scenarioLog.map((line, index) => (
            <li key={index} className={styles.scenarioLogLine}>
              {line}
            </li>
          ))}
          <li className={styles.scenarioNote}>Example scenario using demo data — reset anytime.</li>
        </ol>
      )}

      <div className={styles.kpiFive}>
        <MetricCard
          label="Open Requests"
          value={String(openRequests)}
          note={scenarioStep >= 2 ? 'Updated by scenario' : '+9% this week'}
          tone="error"
        />
        <MetricCard label="Within Target" value="91%" note="+6 pts" tone="success" />
        <MetricCard label="Active Alerts" value="4" note="1 high priority" tone="warning" />
        <MetricCard label="Customer Score" value="4.6" note="+3.2%" tone="success" />
        <MetricCard label="Asset Availability" value="92%" note="Stable" tone="info" />
      </div>

      <ul className={styles.statusGrid} aria-label="System status">
        {SYSTEM_STATUS.map(item => (
          <li key={item.label} className={styles.statusItem}>
            <strong>{item.label}</strong>
            <StatusDot state={TONE_STATE[item.tone]} label={item.status} />
          </li>
        ))}
      </ul>

      <div className={styles.primaryGrid}>
        <section className={`${styles.panel} ${styles.hlnaPanel}`}>
          <PanelHeader
            eyebrow="Intelligence Layer"
            title="HLNΛ Operational Briefing"
            right={<StatusDot state="success" label="Connected" />}
          />

          <div className={styles.hlnaBody}>
            <div className={styles.currentBriefing}>
              <small>Current briefing</small>
              <p>
                Service performance remains broadly stable, with one customer backlog and tomorrow&apos;s workforce
                coverage requiring attention.
              </p>
            </div>

            <div className={styles.intelGrid}>
              <IntelCard
                label="Situation"
                body="18 customer requests are now outside the target response window."
                tone="info"
              />
              <IntelCard
                label="Context"
                body="Overall request performance remains at 91% within target despite higher demand."
                tone="active"
              />
              <IntelCard
                label="Risk"
                body="Three uncovered shifts tomorrow may increase the existing service backlog."
                tone="warning"
              />
              <IntelCard
                label="Action"
                body="Reallocate available workforce to the highest-risk requests before tomorrow."
                tone="success"
              />
            </div>

            <div className={styles.questionPills}>
              {DEMO_QUESTIONS.slice(0, 3).map(item => (
                <button type="button" key={item.question} onClick={() => askHlna(item.question)}>
                  {item.question}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.panel}>
          <PanelHeader
            eyebrow="Environmental Context"
            title="Operational Conditions"
            right={<span className={styles.muted}>Adelaide</span>}
          />

          <div className={styles.weather}>
            <div className={styles.weatherMain}>
              <div>
                <strong>18°</strong>
                <span>Clear conditions</span>
              </div>
              <div className={styles.weatherIcon} aria-hidden="true">
                ☀
              </div>
            </div>

            <div className={styles.weatherOk}>
              <StatusDot state="success" label="Good operating conditions" />
            </div>

            <ul className={styles.weatherDays} aria-label="Five-day forecast">
              {[
                ['Mon', '18°', '10%'],
                ['Tue', '20°', '5%'],
                ['Wed', '17°', '35%'],
                ['Thu', '16°', '62%'],
                ['Fri', '19°', '18%'],
              ].map(([day, temp, rain]) => (
                <li key={day}>
                  <small>{day}</small>
                  <strong>{temp}</strong>
                  <span>{rain} rain</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>

      <div className={styles.secondaryGrid}>
        <section className={styles.panel}>
          <PanelHeader
            eyebrow="Priority Management"
            title="What Needs Attention"
            right={<span className={`${styles.count} ${tone('error')}`}>3 active</span>}
          />

          <div className={styles.alertList}>
            {ALERTS.map(alert => (
              <div key={alert.title} className={`${styles.alert} ${tone(alert.tone)}`}>
                <div className={styles.alertCopy}>
                  <div>
                    <small>{alert.label}</small>
                    <strong>{alert.value}</strong>
                  </div>
                  <h3>{alert.title}</h3>
                  <p>{alert.description}</p>
                  <span>{alert.detail}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <div className={styles.sideStack}>
          <section className={styles.panel}>
            <PanelHeader eyebrow="Changes" title="Last 24 Hours" />

            <ul className={styles.changeList}>
              {(
                [
                  ['Open requests', '+9%', 'error'],
                  ['Response time', '-14%', 'success'],
                  ['Operating cost', '+4.8%', 'error'],
                  ['Customer score', '+3.2%', 'success'],
                ] as [string, string, Tone][]
              ).map(([label, value, t]) => (
                <li key={label}>
                  <span>{label}</span>
                  <strong className={tone(t)}>{value}</strong>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.panel}>
            <PanelHeader eyebrow="Quick Actions" title="Operational Actions" />

            <div className={styles.actions}>
              <button type="button">
                <span aria-hidden="true">!</span>
                Review priority alerts
                <small aria-hidden="true">→</small>
              </button>
              <button type="button">
                <span aria-hidden="true">↔</span>
                Reallocate workload
                <small aria-hidden="true">→</small>
              </button>
              <button type="button">
                <span aria-hidden="true">+</span>
                Create operational task
                <small aria-hidden="true">→</small>
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

export function FinancialTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Financial Intelligence"
        title="Understand where money is moving."
        description="Bring budgets, actuals, forecasts and cost drivers into the same operational view."
      />

      <div className={styles.kpiFour}>
        {FINANCIAL_METRICS.map(item => (
          <MetricCard key={item.label} {...item} />
        ))}
      </div>

      <section className={styles.panel}>
        <PanelHeader
          eyebrow="Cost Intelligence"
          title="Primary Cost Drivers"
          right={<span className={styles.muted}>Current period</span>}
        />

        <ul className={styles.costList}>
          {COST_DRIVERS.map(([label, value, movement, t]) => (
            <li key={label}>
              <strong>{label}</strong>
              <span>{value}</span>
              <small className={tone(t)}>{movement}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export function OperationsTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Operational Intelligence"
        title="See performance before it becomes a problem."
        description="Monitor workload, service delivery, risk and operational capacity from one workspace."
      />

      <div className={styles.kpiFour}>
        <MetricCard label="Jobs Scheduled" value="326" note="+4.1% this week" tone="info" />
        <MetricCard label="Completed" value="297" note="91.1%" tone="success" />
        <MetricCard label="At Risk" value="18" note="Needs attention" tone="warning" />
        <MetricCard label="Overdue" value="11" note="+3 today" tone="error" />
      </div>

      <div className={styles.twoGrid}>
        <section className={styles.panel}>
          <PanelHeader eyebrow="Service Delivery" title="Operational Performance" />

          <ul className={styles.performance}>
            {(
              [
                ['North', 96, 'success'],
                ['Central', 93, 'success'],
                ['South', 82, 'warning'],
                ['Coastal', 89, 'info'],
                ['Hills', 91, 'success'],
              ] as [string, number, Tone][]
            ).map(([label, value, t]) => (
              <li key={label} className={tone(t)}>
                <span>{label}</span>
                <div className={styles.progress} aria-hidden="true">
                  <div style={{ width: `${value}%` }} />
                </div>
                <strong>{value}%</strong>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <PanelHeader eyebrow="Live Priorities" title="Workload" />

          <ul className={styles.workload}>
            {[
              ['18', 'Outside target'],
              ['11', 'Due today'],
              ['42', 'In progress'],
              ['297', 'Completed'],
            ].map(([value, label]) => (
              <li key={label}>
                <strong>{value}</strong>
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

export function CustomersTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Customer Intelligence"
        title="Connect service activity to customer experience."
        description="Track demand, response performance, escalation and customer outcomes without jumping between systems."
      />

      <div className={styles.kpiFour}>
        <MetricCard label="Requests" value="184" note="+8% this month" tone="info" />
        <MetricCard label="Within Target" value="91%" note="+6 pts" tone="success" />
        <MetricCard label="Escalated" value="4" note="1 urgent" tone="error" />
        <MetricCard label="Satisfaction" value="4.6" note="out of 5" tone="active" />
      </div>

      <section className={styles.panel}>
        <PanelHeader eyebrow="CRM" title="Recent Requests" />
        <DataTable caption="Recent requests" headings={['Request', 'Category', 'Status', 'Age']} rows={CUSTOMER_ROWS} />
      </section>
    </div>
  )
}

function Signal({ tone: t, title, detail }: { tone: Tone; title: string; detail: string }) {
  return (
    <li className={tone(t)}>
      <span aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <small>{detail}</small>
      </div>
    </li>
  )
}

export function WorkforceTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Workforce Intelligence"
        title="Match people and capacity to demand."
        description="Understand workforce availability, coverage and pressure points before they affect service delivery."
      />

      <div className={styles.kpiFour}>
        <MetricCard label="Available Today" value="54" note="94% coverage" tone="success" />
        <MetricCard label="Tomorrow" value="51" note="3 shifts uncovered" tone="warning" />
        <MetricCard label="Overtime" value="126h" note="+8% this period" tone="error" />
        <MetricCard label="Leave" value="6" note="Current absences" tone="info" />
      </div>

      <div className={styles.twoGrid}>
        <section className={styles.panel}>
          <PanelHeader eyebrow="Coverage" title="Next 5 Days" />

          <ul className={styles.coverage}>
            {(
              [
                ['Mon', 96],
                ['Tue', 94],
                ['Wed', 88],
                ['Thu', 91],
                ['Fri', 97],
              ] as [string, number][]
            ).map(([day, coverage]) => (
              <li key={day}>
                <div className={styles.coverageTrack} aria-hidden="true">
                  <span style={{ height: `${coverage}%` }} />
                </div>
                <strong>{coverage}%</strong>
                <small>{day}</small>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.panel}>
          <PanelHeader eyebrow="Resource Planning" title="Capacity Signals" />

          <ul className={styles.signals}>
            <Signal tone="error" title="South operations" detail="Coverage below planned requirement" />
            <Signal tone="warning" title="Field team 03" detail="Overtime trending above average" />
            <Signal tone="success" title="Central operations" detail="Capacity available for reallocation" />
          </ul>
        </section>
      </div>
    </div>
  )
}

export function AssetsTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Asset Intelligence"
        title="Know what is available and what is costing you."
        description="Bring utilisation, availability, maintenance and operational impact into a single asset view."
      />

      <div className={styles.kpiFour}>
        <MetricCard label="Total Assets" value="126" note="Tracked" tone="info" />
        <MetricCard label="Available" value="92%" note="116 operational" tone="success" />
        <MetricCard label="Maintenance" value="7" note="Open work orders" tone="warning" />
        <MetricCard label="Unavailable" value="3" note="Needs action" tone="error" />
      </div>

      <section className={styles.panel}>
        <PanelHeader eyebrow="Asset Register" title="Operational Assets" />
        <DataTable caption="Operational assets" headings={['Asset', 'Type', 'Status', 'Note']} rows={ASSET_ROWS} />
      </section>
    </div>
  )
}

export function ReportingTab() {
  return (
    <div className={styles.tabPage}>
      <PageHeading
        eyebrow="Reporting & Automation"
        title="Turn operational data into decisions."
        description="BRΛINBΛSE can surface trends, prepare reporting and automate recurring information flows around the work your team already performs."
      />

      <ul className={styles.reportGrid}>
        {REPORTS.map(item => (
          <li key={item.title} className={styles.reportCard}>
            <div className={styles.reportTop}>
              <span aria-hidden="true">{item.icon}</span>
              <small>{item.status}</small>
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <button type="button" aria-label={`Preview ${item.title}`}>
              <span>Preview</span>
              <span aria-hidden="true">→</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
