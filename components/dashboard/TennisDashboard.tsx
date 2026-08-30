import Link from 'next/link'
import HlnaInsightCard from './HlnaInsightCard'
import WeatherPanel from './WeatherPanel'
import LeadsChart from './LeadsChart'
import TennisNewsPanel from './TennisNewsPanel'
import TodaysSchedule, {
  type TodaySessionInstance,
} from './TodaysSchedule'
import { HlnaOrb } from '@/components/brand/HlnaOrb'
import { ModuleAccessCard } from './ModuleAccessCard'
import type { SessionTypeRow } from '@/lib/sessionDisplay'

const FONT =
  "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const LEAD_BADGE: Record<
  string,
  { bg: string; color: string; border: string; label: string }
> = {
  new: {
    bg: 'rgba(34,197,94,.10)',
    color: '#4ade80',
    border: 'rgba(34,197,94,.22)',
    label: 'New',
  },
  contacted: {
    bg: 'rgba(59,130,246,.10)',
    color: '#60a5fa',
    border: 'rgba(59,130,246,.22)',
    label: 'Contacted',
  },
  booked: {
    bg: 'rgba(167,139,250,.10)',
    color: '#c4b5fd',
    border: 'rgba(167,139,250,.22)',
    label: 'Booked',
  },
  closed: {
    bg: 'rgba(113,113,122,.10)',
    color: '#a1a1aa',
    border: 'rgba(113,113,122,.22)',
    label: 'Closed',
  },
}

const CONTACT_BADGE: Record<
  string,
  { bg: string; color: string; border: string }
> = {
  lead: {
    bg: 'rgba(34,197,94,.10)',
    color: '#4ade80',
    border: 'rgba(34,197,94,.22)',
  },
  contacted: {
    bg: 'rgba(251,191,36,.10)',
    color: '#fbbf24',
    border: 'rgba(251,191,36,.22)',
  },
  active: {
    bg: 'rgba(59,130,246,.10)',
    color: '#60a5fa',
    border: 'rgba(59,130,246,.22)',
  },
}

type Lead = {
  id: string
  name: string
  email: string
  status: string
  session_type: string | null
  created_at: string
}

type Contact = {
  id: string
  name: string
  email: string
  phone: string | null
  status: string
  last_contacted_at: string | null
}

export type Props = {
  greeting: string
  stats: {
    todaysSessions: number
    newThisWeek: number
    activeLeads: number
    needsFollowup: number
  }
  recentLeads: Lead[]
  attentionContacts: Contact[]
  leadsPerDay: { day: string; leads: number }[]
  todaysSessions: TodaySessionInstance[]
  sessionTypes: SessionTypeRow[]
  enabledCapabilities?: string[]
}

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string
  value: number
  sub: string
  accent: string
  icon: React.ReactNode
}) {
  return (
    <div className="bb-stat-card">
      <div
        className="bb-stat-glow"
        style={{
          background: `radial-gradient(circle, ${accent}16 0%, transparent 68%)`,
        }}
      />

      <div className="bb-stat-top">
        <div
          className="bb-stat-icon"
          style={{
            color: accent,
            borderColor: `${accent}24`,
            background: `${accent}0d`,
          }}
        >
          {icon}
        </div>

        <span
          className="bb-stat-indicator"
          style={{
            color: accent,
          }}
        >
          LIVE
        </span>
      </div>

      <span
        className="bb-stat-value"
        style={{
          color: accent,
        }}
      >
        {value}
      </span>

      <span className="bb-stat-label">{label}</span>

      <span className="bb-stat-sub">{sub}</span>
    </div>
  )
}

function PanelHeader({
  title,
  href,
  linkLabel,
  eyebrow,
}: {
  title: string
  href?: string
  linkLabel?: string
  eyebrow?: string
}) {
  return (
    <div className="bb-panel-header">
      <div>
        {eyebrow && <div className="bb-panel-eyebrow">{eyebrow}</div>}

        <div className="bb-panel-title">{title}</div>
      </div>

      {href && (
        <Link href={href} className="bb-panel-link">
          {linkLabel ?? 'View all →'}
        </Link>
      )}
    </div>
  )
}

function EmptyState({
  title,
  message,
  icon,
  positive = false,
}: {
  title: string
  message: string
  icon: React.ReactNode
  positive?: boolean
}) {
  return (
    <div className="bb-empty-state">
      <div
        className={`bb-empty-icon ${
          positive ? 'bb-empty-icon-positive' : ''
        }`}
      >
        {icon}
      </div>

      <div className="bb-empty-title">{title}</div>

      <div className="bb-empty-copy">{message}</div>
    </div>
  )
}

function lastContactedLabel(ts: string | null): string {
  if (!ts) return 'Never contacted'

  const days = Math.floor(
    (Date.now() - new Date(ts).getTime()) / 86400000
  )

  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'

  return `${days}d ago`
}

function actionBtn(
  color: string,
  bg: string,
  border: string
): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    fontSize: 10,
    fontWeight: 600,
    padding: '4px 10px',
    borderRadius: 7,
    background: bg,
    color,
    border: `1px solid ${border}`,
    textDecoration: 'none',
    whiteSpace: 'nowrap',
    letterSpacing: '.02em',
    fontFamily: FONT,
    transition:
      'background .16s ease, border-color .16s ease, transform .16s ease',
  }
}

export default function TennisDashboard({
  greeting,
  stats,
  recentLeads,
  attentionContacts,
  leadsPerDay,
  todaysSessions,
  sessionTypes,
  enabledCapabilities = [],
}: Props) {
  const todayLabel = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Australia/Adelaide',
  })

  return (
    <div className="bb-tennis-page">
      <div className="bb-tennis-ambient bb-tennis-ambient-one" />
      <div className="bb-tennis-ambient bb-tennis-ambient-two" />

      <div className="bb-tennis-shell">
        {/* Greeting */}
        <header className="bb-greeting">
          <div>
            <div className="bb-eyebrow">Today</div>

            <h1 className="bb-greeting-title">{greeting}</h1>

            <div className="bb-date">{todayLabel}</div>
          </div>

          <div className="bb-system-status">
            <span className="bb-system-dot" />

            <div>
              <div className="bb-system-status-title">
                BrainBase operational
              </div>

              <div className="bb-system-status-copy">
                HLNΛ intelligence connected
              </div>
            </div>
          </div>
        </header>

        {/* HLNΛ */}
        <section className="bb-hlna-header">
          <div className="bb-hlna-orb-wrap">
            <HlnaOrb size={72} state="idle" />
          </div>

          <div className="bb-hlna-copy">
            <div className="bb-hlna-label">
              HLNΛ · LD TENNIS
            </div>

            <h2 className="bb-hlna-title">
              Client Operations Dashboard
            </h2>

            <p className="bb-hlna-description">
              Leads, clients, sessions and follow-up in one operational
              view.
            </p>
          </div>

          <Link href="/command" className="bb-hlna-action">
            Ask HLNΛ
            <span>→</span>
          </Link>
        </section>

        {/* Module access — capability-gated entry points (e.g. Events &
            Ticketing). Renders nothing when no module is enabled — see
            ModuleAccessCard's own comment. */}
        <ModuleAccessCard enabledCapabilities={enabledCapabilities} />

        {/* KPIs */}
        <section className="bb-kpi-grid">
          <StatCard
            label="Today's Sessions"
            value={stats.todaysSessions}
            sub="Scheduled today"
            accent="#818cf8"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <rect x="3" y="5" width="18" height="16" rx="2" />
                <path d="M16 3v4M8 3v4M3 10h18" />
              </svg>
            }
          />

          <StatCard
            label="New Leads"
            value={stats.newThisWeek}
            sub="Last 7 days"
            accent="#4ade80"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="M12 5v14M5 12h14" />
                <circle cx="12" cy="12" r="9" />
              </svg>
            }
          />

          <StatCard
            label="Follow-ups"
            value={stats.needsFollowup}
            sub="Awaiting response"
            accent="#fbbf24"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            }
          />

          <StatCard
            label="Open Leads"
            value={stats.activeLeads}
            sub="New or contacted"
            accent="#60a5fa"
            icon={
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M19 8v6M16 11h6" />
              </svg>
            }
          />
        </section>

        {/* Schedule + attention */}
        <section className="bb-two-column-grid">
          <TodaysSchedule
            instances={todaysSessions}
            sessionTypes={sessionTypes}
          />

          <div className="bb-panel">
            <PanelHeader
              title="Needs Attention"
              eyebrow="Follow-up"
              href="/dashboard/contacts"
              linkLabel="All contacts →"
            />

            {attentionContacts.length === 0 ? (
              <EmptyState
                title="You're all caught up"
                message="No client follow-ups currently need your attention."
                positive
                icon={
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                }
              />
            ) : (
              <div className="bb-contact-list">
                {attentionContacts.map((contact, index) => {
                  const badge =
                    CONTACT_BADGE[contact.status] ??
                    CONTACT_BADGE.lead

                  return (
                    <div
                      key={contact.id}
                      className={`bb-contact-row ${
                        index === attentionContacts.length - 1
                          ? 'bb-contact-row-last'
                          : ''
                      }`}
                    >
                      <div className="bb-contact-avatar">
                        {contact.name
                          .split(' ')
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')
                          .toUpperCase()}
                      </div>

                      <div className="bb-contact-copy">
                        <div className="bb-contact-name">
                          {contact.name}
                        </div>

                        <div className="bb-contact-meta">
                          {lastContactedLabel(
                            contact.last_contacted_at
                          )}
                        </div>
                      </div>

                      <span
                        className="bb-contact-badge"
                        style={{
                          background: badge.bg,
                          color: badge.color,
                          borderColor: badge.border,
                        }}
                      >
                        {contact.status}
                      </span>

                      <div className="bb-contact-actions">
                        {contact.phone && (
                          <a
                            href={`tel:${contact.phone}`}
                            style={actionBtn(
                              '#4ade80',
                              'rgba(34,197,94,.08)',
                              'rgba(34,197,94,.18)'
                            )}
                          >
                            Call
                          </a>
                        )}

                        <a
                          href={`mailto:${contact.email}`}
                          style={actionBtn(
                            '#60a5fa',
                            'rgba(59,130,246,.08)',
                            'rgba(59,130,246,.18)'
                          )}
                        >
                          Email
                        </a>

                        <Link
                          href={`/dashboard/contacts/${contact.id}`}
                          style={actionBtn(
                            'rgba(255,255,255,.58)',
                            'rgba(255,255,255,.045)',
                            'rgba(255,255,255,.09)'
                          )}
                        >
                          View
                        </Link>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Lead trend + weather */}
        <section className="bb-two-column-grid">
          <LeadsChart rawData={leadsPerDay} />
          <WeatherPanel />
        </section>

        {/* HLNΛ */}
        <section className="bb-full-panel">
          <HlnaInsightCard />
        </section>

        {/* News */}
        <section className="bb-full-panel">
          <TennisNewsPanel />
        </section>

        {/* Recent activity */}
        <section className="bb-panel">
          <PanelHeader
            title="Recent Activity"
            eyebrow="Leads"
            href="/dashboard/leads"
            linkLabel="All leads →"
          />

          {recentLeads.length === 0 ? (
            <EmptyState
              title="No recent leads"
              message="New enquiries and lead activity will appear here."
              icon={
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                >
                  <path d="M12 5v14M5 12h14" />
                </svg>
              }
            />
          ) : (
            <div className="bb-table-scroll">
              <table className="bb-activity-table">
                <tbody>
                  {recentLeads.map((lead, index) => {
                    const badge =
                      LEAD_BADGE[lead.status] ??
                      LEAD_BADGE.new

                    const date = new Date(
                      lead.created_at
                    ).toLocaleDateString('en-AU', {
                      day: 'numeric',
                      month: 'short',
                    })

                    return (
                      <tr
                        key={lead.id}
                        className={
                          index === recentLeads.length - 1
                            ? 'bb-activity-row-last'
                            : ''
                        }
                      >
                        <td className="bb-activity-primary">
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className="bb-lead-name"
                          >
                            {lead.name}
                          </Link>

                          <div className="bb-lead-email">
                            {lead.email}
                          </div>
                        </td>

                        <td className="bb-activity-session">
                          {lead.session_type && (
                            <span>{lead.session_type}</span>
                          )}
                        </td>

                        <td className="bb-activity-status">
                          <span
                            className="bb-lead-badge"
                            style={{
                              background: badge.bg,
                              color: badge.color,
                              borderColor: badge.border,
                            }}
                          >
                            {badge.label}
                          </span>
                        </td>

                        <td className="bb-activity-date">
                          {date}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <style>{`
        @keyframes bbPageIn {
          from {
            opacity: 0;
            transform: translateY(5px);
          }

          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes bbStatusPulse {
          0%, 100% {
            opacity: .7;
            box-shadow: 0 0 0 0 rgba(34,197,94,.2);
          }

          50% {
            opacity: 1;
            box-shadow: 0 0 0 5px rgba(34,197,94,0);
          }
        }

        .bb-tennis-page {
          min-height: 100vh;
          position: relative;
          overflow: hidden;
          background: #08090c;
          color: #f5f7fa;
          font-family: ${FONT};
        }

        .bb-tennis-ambient {
          position: fixed;
          pointer-events: none;
          border-radius: 999px;
          filter: blur(12px);
          z-index: 0;
        }

        .bb-tennis-ambient-one {
          width: 760px;
          height: 480px;
          left: 50%;
          top: -320px;
          transform: translateX(-50%);
          background:
            radial-gradient(
              ellipse,
              rgba(139,92,246,.14),
              rgba(139,92,246,.035) 45%,
              transparent 72%
            );
        }

        .bb-tennis-ambient-two {
          width: 520px;
          height: 520px;
          right: -280px;
          top: 38%;
          background:
            radial-gradient(
              circle,
              rgba(69,92,246,.045),
              transparent 70%
            );
        }

        .bb-tennis-shell {
          width: 100%;
          max-width: 1152px;
          margin: 0 auto;
          padding: 28px 24px 64px;
          position: relative;
          z-index: 1;
          animation: bbPageIn .38s ease both;
        }

        .bb-greeting {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 24px;
          margin-bottom: 22px;
        }

        .bb-eyebrow {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: .14em;
          text-transform: uppercase;
          color: rgba(167,139,250,.64);
          margin-bottom: 6px;
        }

        .bb-greeting-title {
          font-size: 25px;
          line-height: 1.2;
          font-weight: 720;
          color: #f5f7fa;
          letter-spacing: -.027em;
          margin: 0 0 5px;
        }

        .bb-date {
          font-size: 12px;
          color: rgba(255,255,255,.32);
        }

        .bb-system-status {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 13px;
          border: 1px solid rgba(255,255,255,.065);
          background: rgba(255,255,255,.025);
          border-radius: 11px;
        }

        .bb-system-dot {
          width: 7px;
          height: 7px;
          border-radius: 999px;
          background: #22c55e;
          box-shadow: 0 0 11px rgba(34,197,94,.4);
          animation: bbStatusPulse 2.4s ease-in-out infinite;
        }

        .bb-system-status-title {
          font-size: 10px;
          font-weight: 650;
          color: rgba(245,247,250,.78);
        }

        .bb-system-status-copy {
          margin-top: 2px;
          font-size: 9px;
          color: rgba(230,237,243,.28);
        }

        .bb-hlna-header {
          position: relative;
          overflow: hidden;
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 21px 23px;
          margin-bottom: 15px;
          border-radius: 16px;
          border: 1px solid rgba(139,92,246,.17);
          background:
            linear-gradient(
              115deg,
              rgba(99,102,241,.065),
              rgba(139,92,246,.025) 58%,
              rgba(255,255,255,.018)
            );
        }

        .bb-hlna-header::after {
          content: '';
          position: absolute;
          width: 250px;
          height: 250px;
          right: -110px;
          top: -130px;
          border-radius: 999px;
          background:
            radial-gradient(
              circle,
              rgba(139,92,246,.12),
              transparent 70%
            );
          pointer-events: none;
        }

        .bb-hlna-orb-wrap {
          flex-shrink: 0;
        }

        .bb-hlna-copy {
          flex: 1;
          min-width: 0;
          position: relative;
          z-index: 1;
        }

        .bb-hlna-label {
          font-size: 9px;
          line-height: 1.2;
          font-weight: 750;
          letter-spacing: .135em;
          color: rgba(167,139,250,.67);
          margin-bottom: 6px;
        }

        .bb-hlna-title {
          font-size: 21px;
          line-height: 1.25;
          font-weight: 700;
          color: #f5f7fa;
          letter-spacing: -.022em;
          margin: 0 0 5px;
        }

        .bb-hlna-description {
          margin: 0;
          font-size: 11.5px;
          line-height: 1.5;
          color: rgba(255,255,255,.3);
        }

        .bb-hlna-action {
          min-height: 38px;
          flex-shrink: 0;
          position: relative;
          z-index: 1;
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 0 15px;
          border-radius: 9px;
          border: 1px solid rgba(139,92,246,.34);
          background: rgba(139,92,246,.15);
          color: rgba(245,247,250,.86);
          font-size: 11px;
          font-weight: 650;
          text-decoration: none;
          transition:
            background .16s ease,
            border-color .16s ease,
            transform .16s ease;
        }

        .bb-hlna-action:hover {
          transform: translateY(-1px);
          background: rgba(139,92,246,.23);
          border-color: rgba(167,139,250,.48);
        }

        .bb-kpi-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 14px;
          margin-bottom: 14px;
        }

        .bb-stat-card {
          position: relative;
          overflow: hidden;
          min-height: 154px;
          display: flex;
          flex-direction: column;
          padding: 18px 20px;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.028);
          transition:
            transform .18s ease,
            border-color .18s ease,
            background .18s ease;
        }

        .bb-stat-card:hover {
          transform: translateY(-2px);
          border-color: rgba(255,255,255,.12);
          background: rgba(255,255,255,.042);
        }

        .bb-stat-glow {
          position: absolute;
          width: 150px;
          height: 150px;
          left: -70px;
          top: -80px;
          border-radius: 999px;
          pointer-events: none;
        }

        .bb-stat-top {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 15px;
        }

        .bb-stat-icon {
          width: 33px;
          height: 33px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: 1px solid;
          border-radius: 9px;
        }

        .bb-stat-indicator {
          font-size: 7px;
          font-weight: 800;
          letter-spacing: .09em;
          opacity: .56;
        }

        .bb-stat-value {
          position: relative;
          font-size: 34px;
          line-height: 1;
          font-weight: 720;
          letter-spacing: -.035em;
          margin-bottom: 7px;
        }

        .bb-stat-label {
          position: relative;
          font-size: 10px;
          line-height: 1.3;
          font-weight: 700;
          letter-spacing: .08em;
          text-transform: uppercase;
          color: rgba(255,255,255,.42);
          margin-bottom: 4px;
        }

        .bb-stat-sub {
          position: relative;
          font-size: 10px;
          line-height: 1.4;
          color: rgba(255,255,255,.25);
        }

        .bb-two-column-grid {
          display: grid;
          grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
          gap: 14px;
          margin-bottom: 14px;
        }

        .bb-full-panel {
          margin-bottom: 14px;
        }

        .bb-panel {
          overflow: hidden;
          border-radius: 14px;
          border: 1px solid rgba(255,255,255,.07);
          background: rgba(255,255,255,.028);
        }

        .bb-panel-header {
          min-height: 54px;
          padding: 12px 20px;
          border-bottom: 1px solid rgba(255,255,255,.06);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }

        .bb-panel-eyebrow {
          font-size: 7px;
          font-weight: 750;
          letter-spacing: .12em;
          color: rgba(167,139,250,.52);
          text-transform: uppercase;
          margin-bottom: 3px;
        }

        .bb-panel-title {
          font-size: 10px;
          font-weight: 700;
          letter-spacing: .09em;
          text-transform: uppercase;
          color: rgba(255,255,255,.48);
        }

        .bb-panel-link {
          flex-shrink: 0;
          font-size: 10px;
          color: rgba(167,139,250,.62);
          text-decoration: none;
          font-weight: 600;
          transition: color .16s ease;
        }

        .bb-panel-link:hover {
          color: #c4b5fd;
        }

        .bb-empty-state {
          min-height: 177px;
          padding: 30px 22px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          text-align: center;
        }

        .bb-empty-icon {
          width: 39px;
          height: 39px;
          display: flex;
          align-items: center;
          justify-content: center;
          margin-bottom: 12px;
          border-radius: 11px;
          border: 1px solid rgba(139,92,246,.17);
          background: rgba(139,92,246,.075);
          color: rgba(167,139,250,.72);
        }

        .bb-empty-icon-positive {
          border-color: rgba(34,197,94,.15);
          background: rgba(34,197,94,.065);
          color: rgba(74,222,128,.68);
        }

        .bb-empty-title {
          margin-bottom: 5px;
          font-size: 12px;
          font-weight: 650;
          color: rgba(245,247,250,.72);
        }

        .bb-empty-copy {
          max-width: 280px;
          font-size: 10.5px;
          line-height: 1.55;
          color: rgba(255,255,255,.27);
        }

        .bb-contact-list {
          display: flex;
          flex-direction: column;
        }

        .bb-contact-row {
          min-height: 64px;
          padding: 11px 20px;
          display: flex;
          align-items: center;
          gap: 10px;
          border-bottom: 1px solid rgba(255,255,255,.045);
          transition: background .15s ease;
        }

        .bb-contact-row:hover {
          background: rgba(255,255,255,.025);
        }

        .bb-contact-row-last {
          border-bottom: 0;
        }

        .bb-contact-avatar {
          width: 32px;
          height: 32px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 9px;
          border: 1px solid rgba(139,92,246,.13);
          background: rgba(139,92,246,.06);
          color: rgba(196,181,253,.72);
          font-size: 9px;
          font-weight: 750;
          letter-spacing: .03em;
        }

        .bb-contact-copy {
          flex: 1;
          min-width: 0;
        }

        .bb-contact-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 12px;
          font-weight: 550;
          color: rgba(245,247,250,.88);
        }

        .bb-contact-meta {
          margin-top: 3px;
          font-size: 9px;
          color: rgba(255,255,255,.27);
        }

        .bb-contact-badge,
        .bb-lead-badge {
          flex-shrink: 0;
          padding: 3px 8px;
          border: 1px solid;
          border-radius: 999px;
          white-space: nowrap;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: .035em;
          text-transform: capitalize;
        }

        .bb-contact-actions {
          display: flex;
          gap: 5px;
        }

        .bb-contact-actions a:hover {
          transform: translateY(-1px);
          filter: brightness(1.12);
        }

        .bb-table-scroll {
          width: 100%;
          overflow-x: auto;
          scrollbar-width: thin;
          scrollbar-color:
            rgba(139,92,246,.25)
            rgba(255,255,255,.02);
        }

        .bb-activity-table {
          width: 100%;
          min-width: 620px;
          border-collapse: collapse;
        }

        .bb-activity-table tr {
          border-bottom: 1px solid rgba(255,255,255,.045);
          transition: background .15s ease;
        }

        .bb-activity-table tr:hover {
          background: rgba(255,255,255,.022);
        }

        .bb-activity-table .bb-activity-row-last {
          border-bottom: none;
        }

        .bb-activity-primary {
          padding: 13px 20px;
        }

        .bb-lead-name {
          font-size: 12px;
          font-weight: 550;
          color: rgba(245,247,250,.9);
          text-decoration: none;
          transition: color .15s ease;
        }

        .bb-lead-name:hover {
          color: #c4b5fd;
        }

        .bb-lead-email {
          margin-top: 3px;
          font-size: 9.5px;
          color: rgba(255,255,255,.27);
        }

        .bb-activity-session {
          padding: 13px 14px;
          vertical-align: middle;
          color: rgba(255,255,255,.32);
          font-size: 10px;
        }

        .bb-activity-status {
          padding: 13px 14px;
          vertical-align: middle;
        }

        .bb-activity-date {
          padding: 13px 20px;
          text-align: right;
          vertical-align: middle;
          font-size: 9.5px;
          color: rgba(255,255,255,.25);
        }

        @media (max-width: 900px) {
          .bb-kpi-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .bb-two-column-grid {
            grid-template-columns: 1fr;
          }
        }

        @media (max-width: 680px) {
          .bb-tennis-shell {
            padding: 24px 18px 56px;
          }

          .bb-greeting {
            align-items: flex-start;
            flex-direction: column;
            gap: 14px;
          }

          .bb-hlna-header {
            align-items: flex-start;
            flex-wrap: wrap;
          }

          .bb-hlna-action {
            margin-left: 96px;
          }

          .bb-contact-row {
            flex-wrap: wrap;
          }

          .bb-contact-actions {
            width: 100%;
            padding-left: 42px;
          }
        }

        @media (max-width: 480px) {
          .bb-tennis-shell {
            padding: 21px 14px 48px;
          }

          .bb-system-status {
            display: none;
          }

          .bb-greeting-title {
            font-size: 23px;
          }

          .bb-hlna-header {
            gap: 16px;
            padding: 18px;
          }

          .bb-hlna-orb-wrap {
            transform: scale(.88);
            transform-origin: top left;
            width: 64px;
          }

          .bb-hlna-title {
            font-size: 18px;
          }

          .bb-hlna-action {
            width: 100%;
            margin-left: 0;
            justify-content: center;
          }

          .bb-kpi-grid {
            gap: 9px;
          }

          .bb-stat-card {
            min-height: 142px;
            padding: 15px;
          }

          .bb-stat-value {
            font-size: 30px;
          }

          .bb-two-column-grid {
            gap: 9px;
            margin-bottom: 9px;
          }

          .bb-full-panel {
            margin-bottom: 9px;
          }

          .bb-contact-row {
            padding: 12px 15px;
          }

          .bb-contact-badge {
            margin-left: auto;
          }

          .bb-contact-actions {
            padding-left: 42px;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .bb-tennis-shell,
          .bb-system-dot {
            animation: none !important;
          }

          .bb-stat-card,
          .bb-hlna-action,
          .bb-contact-row,
          .bb-activity-table tr {
            transition: none !important;
          }
        }
      `}</style>
    </div>
  )
}