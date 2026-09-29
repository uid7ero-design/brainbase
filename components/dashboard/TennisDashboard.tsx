import Link from 'next/link'
import HlnaInsightCard from './HlnaInsightCard'
import WeatherPanel from './WeatherPanel'
import LeadsChart from './LeadsChart'
import TennisNewsPanel from './TennisNewsPanel'
import TodaysSchedule, {
  type TodaySessionInstance,
} from './TodaysSchedule'
import { BrokenOrbitMark } from '@/components/brand/BrokenOrbitMark'
import { ModuleAccessCard } from './ModuleAccessCard'
import type { SessionTypeRow } from '@/lib/sessionDisplay'
import { Badge, buttonProps, type SemanticState } from '@/components/ui/app'
import styles from './TennisDashboard.module.css'

// Lead / contact status keep their meaning through the shared semantic
// states (colour + shape + visible text), readable in light and dark.
const LEAD_BADGE: Record<string, { state: SemanticState; label: string }> = {
  new: { state: 'info', label: 'New' },
  contacted: { state: 'warning', label: 'Contacted' },
  booked: { state: 'success', label: 'Booked' },
  closed: { state: 'inactive', label: 'Closed' },
}

const CONTACT_BADGE: Record<string, SemanticState> = {
  lead: 'info',
  contacted: 'warning',
  active: 'success',
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
  /** Real signed-in role — lets "Your tools" offer role-gated modules. */
  role?: string
}

type Tone = 'accent' | 'success' | 'warning' | 'info'

function StatCard({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string
  value: number
  sub: string
  tone: Tone
  icon: React.ReactNode
}) {
  return (
    <div className={styles.statCard}>
      <div className={styles.statTop}>
        <div className={styles.statIcon} data-tone={tone} aria-hidden="true">
          {icon}
        </div>

        <span className={styles.statIndicator}>
          LIVE
        </span>
      </div>

      <span className={styles.statValue}>
        {value}
      </span>

      <span className={styles.statLabel}>{label}</span>

      <span className={styles.statSub}>{sub}</span>
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
    <div className={styles.panelHeader}>
      <div>
        {eyebrow && <div className={styles.panelEyebrow}>{eyebrow}</div>}

        <h2 className={styles.panelTitle}>{title}</h2>
      </div>

      {href && (
        <Link href={href} className={styles.panelLink}>
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
    <div className={styles.emptyState}>
      <div
        className={styles.emptyIcon}
        data-positive={positive ? 'true' : undefined}
        aria-hidden="true"
      >
        {icon}
      </div>

      <div className={styles.emptyTitle}>{title}</div>

      <div className={styles.emptyCopy}>{message}</div>
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

const actionBtn = buttonProps('secondary', 'sm')

export default function TennisDashboard({
  greeting,
  stats,
  recentLeads,
  attentionContacts,
  leadsPerDay,
  todaysSessions,
  sessionTypes,
  enabledCapabilities = [],
  role,
}: Props) {
  const todayLabel = new Date().toLocaleDateString('en-AU', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Australia/Adelaide',
  })

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* Greeting */}
        <header className={styles.greeting}>
          <div>
            <div className={styles.eyebrow}>Today</div>

            <h1 className={styles.greetingTitle}>{greeting}</h1>

            <div className={styles.date}>{todayLabel}</div>
          </div>

          <div className={styles.systemStatus}>
            <span className={styles.systemDot} aria-hidden="true" />

            <div>
              <div className={styles.systemStatusTitle}>
                BrainBase operational
              </div>

              <div className={styles.systemStatusCopy}>
                HLNΛ intelligence connected
              </div>
            </div>
          </div>
        </header>

        {/* HLNΛ */}
        <section className={styles.hlnaHeader}>
          <div className={styles.hlnaMark}>
            <BrokenOrbitMark size={36} context="hlna" />
          </div>

          <div className={styles.hlnaCopy}>
            <div className={styles.hlnaLabel}>
              HLNΛ · LD TENNIS
            </div>

            <h2 className={styles.hlnaTitle}>
              Client Operations Dashboard
            </h2>

            <p className={styles.hlnaDescription}>
              Leads, clients, sessions and follow-up in one operational
              view.
            </p>
          </div>

          <Link
            href="/command"
            {...buttonProps('primary')}
            className={`${buttonProps('primary').className} ${styles.hlnaAction}`}
          >
            Ask HLNΛ
            <span aria-hidden="true">→</span>
          </Link>
        </section>

        {/* Module access — capability-gated entry points (e.g. Events &
            Ticketing). Renders nothing when no module is enabled — see
            ModuleAccessCard's own comment. */}
        <ModuleAccessCard enabledCapabilities={enabledCapabilities} role={role} />

        {/* KPIs */}
        <section className={styles.kpiGrid} aria-label="Key figures">
          <StatCard
            label="Today's Sessions"
            value={stats.todaysSessions}
            sub="Scheduled today"
            tone="accent"
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
            tone="success"
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
            tone="warning"
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
            tone="info"
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
        <section className={styles.twoColumnGrid}>
          <TodaysSchedule
            instances={todaysSessions}
            sessionTypes={sessionTypes}
          />

          <div className={styles.panel}>
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
              <ul className={styles.contactList}>
                {attentionContacts.map((contact) => {
                  const state =
                    CONTACT_BADGE[contact.status] ??
                    CONTACT_BADGE.lead

                  return (
                    <li
                      key={contact.id}
                      className={styles.contactRow}
                    >
                      <div className={styles.contactAvatar} aria-hidden="true">
                        {contact.name
                          .split(' ')
                          .slice(0, 2)
                          .map((part) => part[0])
                          .join('')
                          .toUpperCase()}
                      </div>

                      <div className={styles.contactCopy}>
                        <div className={styles.contactName}>
                          {contact.name}
                        </div>

                        <div className={styles.contactMeta}>
                          {lastContactedLabel(
                            contact.last_contacted_at
                          )}
                        </div>
                      </div>

                      <Badge state={state} className={styles.statusBadge}>
                        {contact.status}
                      </Badge>

                      <div className={styles.contactActions}>
                        {contact.phone && (
                          <a
                            href={`tel:${contact.phone}`}
                            {...actionBtn}
                            aria-label={`Call ${contact.name}`}
                          >
                            Call
                          </a>
                        )}

                        <a
                          href={`mailto:${contact.email}`}
                          {...actionBtn}
                          aria-label={`Email ${contact.name}`}
                        >
                          Email
                        </a>

                        <Link
                          href={`/dashboard/contacts/${contact.id}`}
                          {...actionBtn}
                          aria-label={`View ${contact.name}`}
                        >
                          View
                        </Link>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Lead trend + weather */}
        <section className={styles.twoColumnGrid}>
          <LeadsChart rawData={leadsPerDay} />
          <WeatherPanel />
        </section>

        {/* HLNΛ */}
        <section className={styles.fullPanel}>
          <HlnaInsightCard />
        </section>

        {/* News */}
        <section className={styles.fullPanel}>
          <TennisNewsPanel />
        </section>

        {/* Recent activity */}
        <section className={styles.panel}>
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
            <div className={styles.tableScroll}>
              <table className={styles.activityTable} aria-label="Recent leads">
                <tbody>
                  {recentLeads.map((lead) => {
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
                      <tr key={lead.id}>
                        <td className={styles.activityPrimary}>
                          <Link
                            href={`/dashboard/leads/${lead.id}`}
                            className={styles.leadName}
                          >
                            {lead.name}
                          </Link>

                          <div className={styles.leadEmail}>
                            {lead.email}
                          </div>
                        </td>

                        <td className={styles.activitySession}>
                          {lead.session_type && (
                            <span>{lead.session_type}</span>
                          )}
                        </td>

                        <td className={styles.activityStatus}>
                          <Badge state={badge.state} className={styles.statusBadge}>
                            {badge.label}
                          </Badge>
                        </td>

                        <td className={styles.activityDate}>
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
    </div>
  )
}
