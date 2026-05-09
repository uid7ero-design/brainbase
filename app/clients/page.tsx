import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type ClientOrg = {
  id: string
  name: string
  slug: string | null
  created_at: string
  userCount: number
  leadCount: number
}

export default async function ClientsPage() {
  let session
  try { session = await requireRole('super_admin') } catch { redirect('/dashboard') }

  const orgs = (await sql`
    SELECT
      o.id,
      o.name,
      o.slug,
      o.created_at,
      COUNT(DISTINCT u.id)::int  AS "userCount",
      COUNT(DISTINCT tl.id)::int AS "leadCount"
    FROM organisations o
    LEFT JOIN users u ON u.organisation_id = o.id
    LEFT JOIN tennis_leads tl ON tl.organisation_id = o.id
    WHERE o.id != ${session.organisationId}
    GROUP BY o.id
    ORDER BY o.name ASC
  `.catch(() => [])) as ClientOrg[]

  return (
    <div style={{ width: '100%', maxWidth: 960, margin: '0 auto', padding: '40px 24px 80px', fontFamily: FONT }}>
      <div style={{ marginBottom: 36 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, color: '#F5F7FA', letterSpacing: '-.02em', margin: '0 0 4px' }}>
          Clients
        </h1>
        <p style={{ fontSize: 13, color: 'rgba(255,255,255,.32)', margin: 0 }}>
          Enter a client&apos;s workspace to manage their dashboard and data.
        </p>
      </div>

      {orgs.length === 0 ? (
        <div style={{
          background: 'rgba(255,255,255,.03)',
          border: '1px solid rgba(255,255,255,.07)',
          borderRadius: 14, padding: '48px 24px', textAlign: 'center',
        }}>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,.25)', margin: 0 }}>
            No client organisations yet.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
          {orgs.map(org => (
            <ClientCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  )
}

function ClientCard({ org }: { org: ClientOrg }) {
  const initials = org.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const age = Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000)
  const ageLabel = age === 0 ? 'Today' : age === 1 ? '1 day ago' : `${age}d ago`

  return (
    <div style={{
      background: 'rgba(255,255,255,.03)',
      border: '1px solid rgba(255,255,255,.08)',
      borderRadius: 14, padding: '22px 22px 18px',
      display: 'flex', flexDirection: 'column', gap: 18,
      transition: 'border-color .15s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 10, flexShrink: 0,
          background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: '.04em',
        }}>
          {initials}
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F5F7FA', letterSpacing: '-.01em' }}>
            {org.name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>
            Added {ageLabel}
          </div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'flex', gap: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#60a5fa', lineHeight: 1 }}>{org.userCount}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '.08em' }}>Users</div>
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#4ade80', lineHeight: 1 }}>{org.leadCount}</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', marginTop: 3, textTransform: 'uppercase', letterSpacing: '.08em' }}>Leads</div>
        </div>
      </div>

      {/* CTA */}
      <Link
        href={`/clients/${org.id}`}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '9px 16px', borderRadius: 8, textDecoration: 'none',
          background: 'rgba(99,102,241,.14)',
          border: '1px solid rgba(99,102,241,.28)',
          fontSize: 13, fontWeight: 600, color: '#a5b4fc',
          letterSpacing: '.01em', transition: 'background .15s, border-color .15s',
        }}
      >
        Enter workspace
        <span style={{ fontSize: 12, opacity: 0.6 }}>→</span>
      </Link>
    </div>
  )
}
