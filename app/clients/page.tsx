import { redirect } from 'next/navigation'
import Link from 'next/link'
import { requireRole } from '@/lib/org'
import sql from '@/lib/db'
import { Badge, PageHeader, StateMessage, StatusDot, buttonProps, type SemanticState } from '@/components/ui/app'
import styles from './Clients.module.css'

export const dynamic = 'force-dynamic'

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
  //
  // Excludes session.homeOrganisationId — the founder's own TRUE
  // organisation, never the org_override-substituted session.organisationId
  // — so "don't list my own workspace" means the founder's real home org,
  // not whatever org they happen to be impersonating via OrgSwitcher at
  // the moment /clients is loaded. Using session.organisationId here was
  // the exact bug: while impersonating org X, this query excluded X
  // instead of the founder's own org, making X (and only X) silently
  // disappear from the chooser regardless of its own status/capabilities.
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
      WHERE o.id != ${session.homeOrganisationId}
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
      ORDER BY organisation_id, (stage <> 'cancelled') DESC, updated_at DESC, id ASC
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
    <div className={styles.page}>
      <PageHeader
        title="Clients"
        description={<>Enter a client&apos;s workspace to manage their dashboard and data.</>}
      />

      {portfolio.length === 0 ? (
        <StateMessage kind="empty" size="page" title="No client organisations yet." />
      ) : (
        <ul className={styles.grid}>
          {portfolio.map(org => (
            <li key={org.id}>
              <ClientCard org={org} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Implementation health, labelled with the same vocabulary as
// app/admin/implementations (never colour alone). An unrecognised health
// value stays neutral rather than reading as on track.
const HEALTH_META: Record<string, { label: string; state: SemanticState }> = {
  on_track: { label: 'On Track', state: 'success' },
  at_risk:  { label: 'At Risk',  state: 'warning' },
  blocked:  { label: 'Blocked',  state: 'error' },
}

// Human-readable presentation of the canonical Organisation status/plan
// enums (prisma/schema.prisma OrgStatus/Plan). No derived/invented state —
// these are the only three status values and four plan values that exist.
const STATUS_LABEL: Record<string, { label: string; state: SemanticState }> = {
  ACTIVE:   { label: 'Active',    state: 'success' },
  SUSPENDED: { label: 'Suspended', state: 'warning' },
  CHURNED:  { label: 'Churned',   state: 'error' },
}
// Neutral fallback for any status value outside the three canonical
// OrgStatus enum values above — deliberately not styled as Active
// (green/success) or any real status, so an unrecognised/future value
// never silently reads as healthy.
const UNKNOWN_STATUS: { label: string; state: SemanticState } = { label: 'Unknown', state: 'inactive' }
const PLAN_LABEL: Record<string, string> = {
  TRIAL: 'Trial', STARTER: 'Starter', PROFESSIONAL: 'Professional', ENTERPRISE: 'Enterprise',
}

function ClientCard({ org }: { org: ClientOrg }) {
  const initials = org.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
  const age = Math.floor((Date.now() - new Date(org.created_at).getTime()) / 86400000)
  const ageLabel = age === 0 ? 'Today' : age === 1 ? '1 day ago' : `${age}d ago`
  const impl = org.primaryImplementation
  const health = impl ? (HEALTH_META[impl.health] ?? { label: impl.health, state: 'inactive' as const }) : null

  return (
    <article className={styles.card} aria-label={org.name}>
      {/* Header */}
      <div className={styles.cardHeader}>
        <div className={styles.initials} aria-hidden="true">
          {initials}
        </div>
        <div className={styles.identity}>
          <h2 className={styles.name}>
            {org.name}
          </h2>
          <div className={styles.added}>
            Added {ageLabel}
          </div>
        </div>
        <div className={styles.statusCol}>
          {(() => {
            const st = STATUS_LABEL[org.status] ?? UNKNOWN_STATUS
            return (
              <Badge state={st.state}>{st.label}</Badge>
            )
          })()}
          <span className={styles.plan}>
            {PLAN_LABEL[org.plan] ?? org.plan}
          </span>
        </div>
      </div>

      {/* Stats */}
      <dl className={styles.stats}>
        <div className={styles.stat}>
          <dd className={styles.statValue}>{org.userCount}</dd>
          <dt className={styles.statLabel}>Users</dt>
        </div>
        <div className={styles.stat}>
          <dd className={styles.statValue}>{org.leadCount}</dd>
          <dt className={styles.statLabel}>Leads</dt>
        </div>
      </dl>

      {/* Platform modules + implementation summary — omitted entirely when
          empty to keep the compact card restrained; the full truthful
          empty state lives in the workspace account overview instead. */}
      {(org.modules.length > 0 || impl) && (
        <div className={styles.portfolio}>
          {org.modules.length > 0 && (
            <ul className={styles.tags} aria-label="Platform modules">
              {org.modules.map(m => (
                <li key={m.key} className={styles.tag}>
                  {m.name}
                </li>
              ))}
            </ul>
          )}
          {impl && health && (
            <div className={styles.impl}>
              <StatusDot state={health.state} label={health.label} />
              <span className={styles.stage}>
                {impl.stage.replace('_', ' ')}
              </span>
              {org.implementationCount > 1 && (
                <span className={styles.muted}>+{org.implementationCount - 1} more</span>
              )}
              {impl.next_action && (
                <span className={styles.nextAction}>
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
        {...buttonProps('secondary')}
        className={`${buttonProps('secondary').className} ${styles.cta}`}
      >
        Enter workspace
        <span aria-hidden="true">→</span>
      </Link>
    </article>
  )
}
