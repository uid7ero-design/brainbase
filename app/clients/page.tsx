import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'

export const dynamic = 'force-dynamic'

const FONT = "var(--font-inter), -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"

type PortfolioModule = { key: string; name: string }
type PrimaryImplementation = {
  id: string; name: string; stage: string; health: string; next_action: string | null
}

type ClientOrg = {
  id: string
  name: string
  slug: string | null
  created_at: string
  status: string
  plan: string
  userCount: number
  leadCount: number
  modules: PortfolioModule[]
  implementationCount: number
  primaryImplementation: PrimaryImplementation | null
}

export default async function ClientsPage() {
  let session
  try { session = await requireRole('super_admin') } catch { redirect('/dashboard') }

  // Three independent, non-multiplying queries (Clients 2.0 B2). Portfolio
  // context (modules/implementations) is fetched separately from the org/
  // users/tennis_leads aggregate below and merged in JS by organisation_id
  // — joining any of these directly into that aggregate would multiply
  // userCount/leadCount by however many module or implementation rows an
  // org has, silently corrupting both counts.
  const [orgs, moduleRows, primaryImplRows, implCountRows] = await Promise.all([
    sql`
      SELECT
        o.id,
        o.name,
        o.slug,
        o.created_at,
        o.status,
        o.plan,
        COUNT(DISTINCT u.id)::int  AS "userCount",
        COUNT(DISTINCT tl.id)::int AS "leadCount"
      FROM organisations o
      LEFT JOIN users u ON u.organisation_id = o.id
      LEFT JOIN tennis_leads tl ON tl.organisation_id = o.id
      WHERE o.id != ${session.organisationId}
      GROUP BY o.id
      ORDER BY o.name ASC
    `.catch(() => []) as Promise<Omit<ClientOrg, 'modules' | 'implementationCount' | 'primaryImplementation'>[]>,
    sql`
      SELECT om.organisation_id, m.key, m.name
      FROM organisation_modules om
      JOIN modules m ON m.key = om.module_key
      WHERE om.enabled = true AND m.active = true
      ORDER BY m.name ASC
    `.catch(() => []) as Promise<{ organisation_id: string; key: string; name: string }[]>,
    // DISTINCT ON picks exactly one deterministic "primary" implementation
    // per organisation: the most recently updated non-cancelled
    // implementation, falling back to the most recently updated cancelled
    // one if that org has no non-cancelled implementations. This never
    // silently hides the existence of multiple implementations — the
    // separate implementationCount below carries the true total.
    sql`
      SELECT DISTINCT ON (organisation_id)
        organisation_id, id, name, stage, health, next_action
      FROM implementations
      ORDER BY organisation_id, (stage <> 'cancelled') DESC, updated_at DESC
    `.catch(() => []) as Promise<(PrimaryImplementation & { organisation_id: string })[]>,
    sql`
      SELECT organisation_id, COUNT(*)::int AS count
      FROM implementations
      GROUP BY organisation_id
    `.catch(() => []) as Promise<{ organisation_id: string; count: number }[]>,
  ])

  const modulesByOrg = new Map<string, PortfolioModule[]>()
  for (const row of moduleRows) {
    const list = modulesByOrg.get(row.organisation_id) ?? []
    list.push({ key: row.key, name: row.name })
    modulesByOrg.set(row.organisation_id, list)
  }

  const primaryImplByOrg = new Map<string, PrimaryImplementation>()
  for (const row of primaryImplRows) {
    primaryImplByOrg.set(row.organisation_id, {
      id: row.id, name: row.name, stage: row.stage, health: row.health, next_action: row.next_action,
    })
  }

  const implCountByOrg = new Map<string, number>()
  for (const row of implCountRows) implCountByOrg.set(row.organisation_id, row.count)

  const portfolio: ClientOrg[] = orgs.map(org => ({
    ...org,
    modules: modulesByOrg.get(org.id) ?? [],
    implementationCount: implCountByOrg.get(org.id) ?? 0,
    primaryImplementation: primaryImplByOrg.get(org.id) ?? null,
  }))

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

      {portfolio.length === 0 ? (
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
          {portfolio.map(org => (
            <ClientCard key={org.id} org={org} />
          ))}
        </div>
      )}
    </div>
  )
}

const HEALTH_COLOR: Record<string, string> = {
  on_track: '#4ade80', at_risk: '#fbbf24', blocked: '#f87171',
}

// Human-readable presentation of the canonical Organisation status/plan
// enums (prisma/schema.prisma OrgStatus/Plan). No derived/invented state —
// these are the only three status values and four plan values that exist.
const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  ACTIVE:   { label: 'Active',    color: '#4ade80' },
  SUSPENDED: { label: 'Suspended', color: '#fbbf24' },
  CHURNED:  { label: 'Churned',   color: '#f87171' },
}
const PLAN_LABEL: Record<string, string> = {
  TRIAL: 'Trial', STARTER: 'Starter', PROFESSIONAL: 'Professional', ENTERPRISE: 'Enterprise',
}

function ClientCard({ org }: { org: ClientOrg }) {
  const initials = org.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const age = Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000)
  const ageLabel = age === 0 ? 'Today' : age === 1 ? '1 day ago' : `${age}d ago`
  const impl = org.primaryImplementation
  const healthColor = impl ? (HEALTH_COLOR[impl.health] ?? '#a1a1aa') : '#a1a1aa'

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
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#F5F7FA', letterSpacing: '-.01em' }}>
            {org.name}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.28)', marginTop: 2 }}>
            Added {ageLabel}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
          {(() => {
            const st = STATUS_LABEL[org.status] ?? STATUS_LABEL.ACTIVE
            return (
              <span style={{
                fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                background: `${st.color}1A`, color: st.color, border: `1px solid ${st.color}38`,
                letterSpacing: '.02em', whiteSpace: 'nowrap',
              }}>
                {st.label}
              </span>
            )
          })()}
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.28)', letterSpacing: '.02em' }}>
            {PLAN_LABEL[org.plan] ?? org.plan}
          </span>
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

      {/* Platform modules + implementation summary — omitted entirely when
          empty to keep the compact card restrained; the full truthful
          empty state lives in the workspace account overview instead. */}
      {(org.modules.length > 0 || impl) && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {org.modules.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {org.modules.map(m => (
                <span key={m.key} style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20,
                  background: 'rgba(99,102,241,.10)', color: '#a5b4fc',
                  border: '1px solid rgba(99,102,241,.22)', letterSpacing: '.02em',
                }}>
                  {m.name}
                </span>
              ))}
            </div>
          )}
          {impl && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: healthColor, flexShrink: 0 }} />
              <span style={{ color: 'rgba(255,255,255,.45)', textTransform: 'capitalize' }}>
                {impl.stage.replace('_', ' ')}
              </span>
              {org.implementationCount > 1 && (
                <span style={{ color: 'rgba(255,255,255,.22)' }}>+{org.implementationCount - 1} more</span>
              )}
              {impl.next_action && (
                <span style={{
                  color: 'rgba(251,191,36,.70)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  → {impl.next_action}
                </span>
              )}
            </div>
          )}
        </div>
      )}

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
