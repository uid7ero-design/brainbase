import { getSession } from '@/lib/session'
import sql from '@/lib/db'
import BrainBase from '@/components/BrainBase'
import TennisDashboard from '@/components/dashboard/TennisDashboard'

const LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID ?? ''

export default async function DashboardPage() {
  const session = await getSession()

  if (session && LD_TENNIS_ORG_ID && session.organisationId === LD_TENNIS_ORG_ID) {
    const oid = session.organisationId

    const [statsRows, recentLeads, attentionContacts, leadsPerDay] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_this_week,
          COUNT(*) FILTER (WHERE status IN ('new', 'contacted'))::int          AS active_leads,
          COUNT(*) FILTER (WHERE status = 'new')::int                          AS needs_followup
        FROM tennis_leads
        WHERE organisation_id = ${oid}
      `.catch(() => [{ new_this_week: 0, active_leads: 0, needs_followup: 0 }]),
      sql`
        SELECT id, name, email, status, session_type, created_at
        FROM tennis_leads
        WHERE organisation_id = ${oid}
        ORDER BY created_at DESC
        LIMIT 6
      `.catch(() => []),
      sql`
        SELECT id, name, email, phone, status, last_contacted_at
        FROM contacts
        WHERE organisation_id = ${oid}
          AND status != 'inactive'
          AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '7 days')
        ORDER BY last_contacted_at ASC NULLS FIRST
        LIMIT 6
      `.catch(() => []),
      sql`
        SELECT
          DATE(created_at AT TIME ZONE 'Australia/Adelaide')::text AS day,
          COUNT(*)::int AS leads
        FROM tennis_leads
        WHERE organisation_id = ${oid}
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY day
        ORDER BY day ASC
      `.catch(() => []),
    ])

    const s = (statsRows[0] ?? {}) as { new_this_week: number; active_leads: number; needs_followup: number }

    return (
      <TennisDashboard
        stats={{
          newThisWeek:   s.new_this_week  ?? 0,
          activeLeads:   s.active_leads   ?? 0,
          needsFollowup: s.needs_followup ?? 0,
        }}
        recentLeads={recentLeads as Parameters<typeof TennisDashboard>[0]['recentLeads']}
        attentionContacts={attentionContacts as Parameters<typeof TennisDashboard>[0]['attentionContacts']}
        leadsPerDay={leadsPerDay as Parameters<typeof TennisDashboard>[0]['leadsPerDay']}
      />
    )
  }

  return <BrainBase />
}
