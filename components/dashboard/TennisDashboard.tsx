import Link from 'next/link'
import HlnaInsightCard from './HlnaInsightCard'
import WeatherPanel    from './WeatherPanel'
import LeadsChart      from './LeadsChart'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

const LEAD_BADGE: Record<string, { bg: string; color: string; border: string; label: string }> = {
  new:       { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)',   label: 'New' },
  contacted: { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)',  label: 'Contacted' },
  booked:    { bg: 'rgba(167,139,250,.10)', color: '#c4b5fd', border: 'rgba(167,139,250,.22)', label: 'Booked' },
  closed:    { bg: 'rgba(113,113,122,.10)', color: '#a1a1aa', border: 'rgba(113,113,122,.22)', label: 'Closed' },
}

const CONTACT_BADGE: Record<string, { bg: string; color: string; border: string }> = {
  lead:      { bg: 'rgba(34,197,94,.10)',   color: '#4ade80', border: 'rgba(34,197,94,.22)' },
  contacted: { bg: 'rgba(251,191,36,.10)',  color: '#fbbf24', border: 'rgba(251,191,36,.22)' },
  active:    { bg: 'rgba(59,130,246,.10)',  color: '#60a5fa', border: 'rgba(59,130,246,.22)' },
}

type Lead = {
  id: string; name: string; email: string
  status: string; session_type: string | null; created_at: string
}

type Contact = {
  id: string; name: string; email: string; phone: string | null
  status: string; last_contacted_at: string | null
}

export type Props = {
  stats:             { newThisWeek: number; activeLeads: number; needsFollowup: number }
  recentLeads:       Lead[]
  attentionContacts: Contact[]
  leadsPerDay:       { day: string; leads: number }[]
}

// ─── Primitives ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }: { label: string; value: number; sub: string; accent: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 14, padding: '22px 24px',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.28)' }}>
        {label}
      </span>
      <span style={{ fontSize: 40, fontWeight: 700, color: accent, lineHeight: 1, letterSpacing: '-.03em' }}>
        {value}
      </span>
      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', lineHeight: 1.4 }}>
        {sub}
      </span>
    </div>
  )
}

function PanelHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div style={{
      padding: '14px 22px',
      borderBottom: '1px solid rgba(255,255,255,.07)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.10em', textTransform: 'uppercase', color: 'rgba(255,255,255,.40)' }}>
        {title}
      </span>
      {href && (
        <Link href={href} style={{ fontSize: 11, color: 'rgba(129,140,248,.65)', textDecoration: 'none', fontWeight: 600 }}>
          {linkLabel ?? 'View all →'}
        </Link>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '32px 22px', textAlign: 'center', color: 'rgba(255,255,255,.18)', fontSize: 12, lineHeight: 1.7 }}>
      {message}
    </div>
  )
}

function lastContactedLabel(ts: string | null): string {
  if (!ts) return 'Never contacted'
  const days = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

function actionBtn(color: string, bg: string, border: string): React.CSSProperties {
  return {
    display: 'inline-block',
    fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 6,
    background: bg, color, border: `1px solid ${border}`,
    textDecoration: 'none', whiteSpace: 'nowrap', letterSpacing: '.02em',
    fontFamily: FONT,
  }
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TennisDashboard({ stats, recentLeads, attentionContacts, leadsPerDay }: Props) {
  return (
    <div style={{ width: '100%', maxWidth: 1152, margin: '0 auto', padding: '28px 24px 64px', fontFamily: FONT }}>

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 3px' }}>
          LD Tennis
        </h1>
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.25)' }}>Coaching dashboard</span>
      </div>

      {/* ── Row 1: KPI cards ───────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 14 }}>
        <StatCard label="New leads"      value={stats.newThisWeek}   sub="Last 7 days"            accent="#4ade80" />
        <StatCard label="Active clients" value={stats.activeLeads}   sub="New or contacted"       accent="#60a5fa" />
        <StatCard label="Follow-up"      value={stats.needsFollowup} sub="Awaiting your response" accent="#fbbf24" />
      </div>

      {/* ── Row 2: Needs Attention | Leads Chart ───────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>

        {/* Needs Attention — PRIMARY */}
        <div style={{
          background: 'rgba(255,255,255,.04)',
          border: '1px solid rgba(255,255,255,.14)',
          borderRadius: 14, overflow: 'hidden',
        }}>
          <PanelHeader title="Needs Attention" href="/dashboard/contacts" linkLabel="All contacts →" />
          {attentionContacts.length === 0 ? (
            <EmptyState message="All contacts are up to date." />
          ) : (
            <div>
              {attentionContacts.map((c, i) => {
                const badge  = CONTACT_BADGE[c.status] ?? CONTACT_BADGE.lead
                const isLast = i === attentionContacts.length - 1
                return (
                  <div
                    key={c.id}
                    style={{
                      padding: '14px 22px',
                      borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.06)',
                      display: 'flex', alignItems: 'center', gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 500, color: '#F5F7FA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.30)', marginTop: 3 }}>
                        {lastContactedLabel(c.last_contacted_at)}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20, whiteSpace: 'nowrap',
                      background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                      letterSpacing: '.04em', textTransform: 'capitalize',
                    }}>
                      {c.status}
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.phone && (
                        <a href={`tel:${c.phone}`} style={actionBtn('#4ade80', 'rgba(34,197,94,.10)', 'rgba(34,197,94,.20)')}>Call</a>
                      )}
                      <a href={`mailto:${c.email}`} style={actionBtn('#60a5fa', 'rgba(59,130,246,.10)', 'rgba(59,130,246,.20)')}>Email</a>
                      <Link href={`/dashboard/contacts/${c.id}`} style={actionBtn('rgba(255,255,255,.55)', 'rgba(255,255,255,.06)', 'rgba(255,255,255,.12)')}>View</Link>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Leads Chart — top right */}
        <LeadsChart rawData={leadsPerDay} />

      </div>

      {/* ── Row 3: HLNA | Weather ───────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
        <HlnaInsightCard />
        <WeatherPanel />
      </div>

      {/* ── Row 4: Recent Activity (full width) ────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,.025)',
        border: '1px solid rgba(255,255,255,.07)',
        borderRadius: 14, overflow: 'hidden',
      }}>
        <PanelHeader title="Recent Activity" href="/dashboard/leads" linkLabel="All leads →" />
        {recentLeads.length === 0 ? (
          <EmptyState message={"No leads yet. They'll appear here when someone submits the form."} />
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {recentLeads.map((lead, i) => {
                const badge  = LEAD_BADGE[lead.status] ?? LEAD_BADGE.new
                const date   = new Date(lead.created_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                const isLast = i === recentLeads.length - 1
                return (
                  <tr key={lead.id} style={{ borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,.05)' }}>
                    <td style={{ padding: '13px 22px' }}>
                      <Link href={`/dashboard/leads/${lead.id}`} style={{ fontSize: 13, fontWeight: 500, color: '#F5F7FA', textDecoration: 'none' }}>
                        {lead.name}
                      </Link>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,.32)', marginTop: 2 }}>{lead.email}</div>
                    </td>
                    <td style={{ padding: '13px 14px', verticalAlign: 'middle' }}>
                      {lead.session_type && (
                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,.35)' }}>{lead.session_type}</span>
                      )}
                    </td>
                    <td style={{ padding: '13px 14px', verticalAlign: 'middle' }}>
                      <span style={{
                        fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
                        background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`,
                        letterSpacing: '.04em', textTransform: 'capitalize',
                      }}>
                        {badge.label}
                      </span>
                    </td>
                    <td style={{ padding: '13px 22px', textAlign: 'right', verticalAlign: 'middle' }}>
                      <span style={{ fontSize: 11, color: 'rgba(255,255,255,.28)' }}>{date}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

    </div>
  )
}
