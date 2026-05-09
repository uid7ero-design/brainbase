import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import TennisDashboard from '@/components/dashboard/TennisDashboard'

export const dynamic = 'force-dynamic'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const LD_TENNIS_ORG_ID = process.env.LD_TENNIS_ORG_ID ?? ''

export default async function ClientSpacePage({ params }: { params: Promise<{ id: string }> }) {
  try { await requireRole('super_admin') } catch { redirect('/dashboard') }

  const { id: oid } = await params

  const orgs = await sql`SELECT id, name FROM organisations WHERE id = ${oid} LIMIT 1`
  if (!orgs[0]) notFound()

  const org = orgs[0] as { id: string; name: string }

  // LD Tennis workspace
  if (oid === LD_TENNIS_ORG_ID) {
    const [statsRows, recentLeads, attentionContacts, leadsPerDay] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS new_this_week,
          COUNT(*) FILTER (WHERE status IN ('new', 'contacted'))::int          AS active_leads,
          COUNT(*) FILTER (WHERE status = 'new')::int                          AS needs_followup
        FROM tennis_leads WHERE organisation_id = ${oid}
      `.catch(() => [{ new_this_week: 0, active_leads: 0, needs_followup: 0 }]),
      sql`
        SELECT id, name, email, status, session_type, created_at
        FROM tennis_leads WHERE organisation_id = ${oid}
        ORDER BY created_at DESC LIMIT 6
      `.catch(() => []),
      sql`
        SELECT id, name, email, phone, status, last_contacted_at
        FROM contacts
        WHERE organisation_id = ${oid}
          AND status != 'inactive'
          AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '7 days')
        ORDER BY last_contacted_at ASC NULLS FIRST LIMIT 6
      `.catch(() => []),
      sql`
        SELECT
          DATE(created_at AT TIME ZONE 'Australia/Adelaide')::text AS day,
          COUNT(*)::int AS leads
        FROM tennis_leads
        WHERE organisation_id = ${oid}
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY day ORDER BY day ASC
      `.catch(() => []),
    ])

    const s = (statsRows[0] ?? {}) as { new_this_week: number; active_leads: number; needs_followup: number }

    return (
      <>
        <ClientBanner orgName={org.name} orgId={oid} />
        <TennisDashboard
          stats={{ newThisWeek: s.new_this_week ?? 0, activeLeads: s.active_leads ?? 0, needsFollowup: s.needs_followup ?? 0 }}
          recentLeads={recentLeads as Parameters<typeof TennisDashboard>[0]['recentLeads']}
          attentionContacts={attentionContacts as Parameters<typeof TennisDashboard>[0]['attentionContacts']}
          leadsPerDay={leadsPerDay as Parameters<typeof TennisDashboard>[0]['leadsPerDay']}
        />
      </>
    )
  }

  // Generic client — no specific dashboard yet
  return (
    <>
      <ClientBanner orgName={org.name} orgId={oid} />
      <div style={{ maxWidth: 640, margin: '60px auto', padding: '0 24px', fontFamily: FONT, textAlign: 'center' }}>
        <p style={{ fontSize: 14, color: 'rgba(255,255,255,.35)' }}>
          No dashboard configured for this client yet.
        </p>
      </div>
    </>
  )
}

function ClientBanner({ orgName, orgId }: { orgName: string; orgId: string }) {
  void orgId
  return (
    <div style={{
      position: 'sticky', top: 52, zIndex: 90,
      background: 'rgba(99,102,241,.10)',
      borderBottom: '1px solid rgba(99,102,241,.20)',
      backdropFilter: 'blur(12px)',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 24px', fontFamily: FONT,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 6, height: 6, borderRadius: '50%',
          background: '#818cf8',
          boxShadow: '0 0 8px rgba(129,140,248,.70)',
        }} />
        <span style={{ fontSize: 12, color: 'rgba(255,255,255,.55)', letterSpacing: '.01em' }}>
          Viewing
        </span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#c4b5fd' }}>
          {orgName}
        </span>
      </div>
      <Link
        href="/clients"
        style={{
          fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.38)',
          textDecoration: 'none', letterSpacing: '.04em',
          padding: '3px 10px', borderRadius: 6,
          border: '1px solid rgba(255,255,255,.10)',
          transition: 'color .14s, border-color .14s',
        }}
      >
        ← Exit to clients
      </Link>
    </div>
  )
}
