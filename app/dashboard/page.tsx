import { getAuthSession } from '@/lib/authSession'
import sql from '@/lib/db'
import BrainBase from '@/components/BrainBase'
import TennisDashboard from '@/components/dashboard/TennisDashboard'
import { resolveDashboardVariant } from '@/lib/dashboard/clientDashboard'
import { greetingLine, currentAdelaideHour } from '@/lib/dashboard/greeting'

export default async function DashboardPage() {
  // getAuthSession() re-validates against the DB (cross-org-reassignment
  // safe) rather than trusting the JWT alone — see lib/authSession.ts. Any
  // failure here (no session, stale/invalid session) falls through to the
  // generic owner shell exactly as before; middleware.ts already guarantees
  // an authenticated request reaches this far for any non-public route, so
  // this catch is a defensive fallback, not the primary path.
  let session
  try { session = await getAuthSession() } catch { return <BrainBase /> }

  // Server-side only, organisation-scoped, slug-driven — never a user ID,
  // never hostname, never a value the browser can influence. See
  // lib/dashboard/clientDashboard.ts for the resolver and why a slug map
  // was chosen over another one-off env var.
  const variant = await resolveDashboardVariant(session.organisationId)

  if (variant === 'ld-tennis') {
    const oid = session.organisationId

    const [statsRows, recentLeads, attentionContacts, leadsPerDay, todaysInstances, sessionTypes] = await Promise.all([
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
      // "Today" is the Adelaide calendar day, computed in SQL — not
      // Postgres's own CURRENT_DATE (server/session timezone, effectively
      // UTC on Neon), which would show tomorrow's sessions as "today"
      // during Adelaide's evening (UTC+9:30/+10:30 means Adelaide's date
      // rolls over well before UTC's). status = 'scheduled' matches the
      // same "active, non-cancelled" semantics used by the Sessions
      // calendar (see app/api/dashboard/sessions/instances/route.ts).
      sql`
        SELECT
          si.id, si.session_id, to_char(si.date, 'YYYY-MM-DD') AS date, si.start_time, si.duration_minutes,
          si.max_capacity, si.status,
          s.name AS session_name, s.session_type, s.resource_id, s.session_colour_key,
          COALESCE(ec.cnt, 0) AS enrolled_count
        FROM session_instances si
        JOIN sessions s ON s.id = si.session_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS cnt FROM bookings b
          WHERE b.session_instance_id = si.id AND b.status != 'cancelled'
        ) ec ON true
        WHERE s.organisation_id = ${oid}
          AND si.date = (NOW() AT TIME ZONE 'Australia/Adelaide')::date
          AND si.status = 'scheduled'
        ORDER BY si.start_time ASC
      `.catch(() => []),
      sql`
        SELECT id, name, slug, colour_key, active, sort_order
        FROM session_types
        WHERE organisation_id = ${oid}
      `.catch(() => []),
    ])

    const s = (statsRows[0] ?? {}) as { new_this_week: number; active_leads: number; needs_followup: number }

    return (
      <TennisDashboard
        greeting={greetingLine(currentAdelaideHour(), session.name)}
        stats={{
          todaysSessions: todaysInstances.length,
          newThisWeek:    s.new_this_week  ?? 0,
          activeLeads:    s.active_leads   ?? 0,
          needsFollowup:  s.needs_followup ?? 0,
        }}
        recentLeads={recentLeads as Parameters<typeof TennisDashboard>[0]['recentLeads']}
        attentionContacts={attentionContacts as Parameters<typeof TennisDashboard>[0]['attentionContacts']}
        leadsPerDay={leadsPerDay as Parameters<typeof TennisDashboard>[0]['leadsPerDay']}
        todaysSessions={todaysInstances as Parameters<typeof TennisDashboard>[0]['todaysSessions']}
        sessionTypes={sessionTypes as Parameters<typeof TennisDashboard>[0]['sessionTypes']}
      />
    )
  }

  return <BrainBase />
}
