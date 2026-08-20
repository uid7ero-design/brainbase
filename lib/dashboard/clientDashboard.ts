import 'server-only'
import sql from '@/lib/db'

// Which bespoke dashboard body an organisation (and, for the owner org
// only, role) should see at /dashboard — keyed by the organisation's own
// stable `slug` column, never a hardcoded UUID/env var, and never a user
// ID. Extend CLIENT_DASHBOARD_SLUGS when a second client dashboard is
// built; any organisation not listed here (and, for Brainbase, any role
// below super_admin) correctly falls through to the generic BrainBase
// shell in app/dashboard/page.tsx, exactly as it does today.
export type DashboardVariant = 'ld-tennis' | 'brainbase-hq'

const CLIENT_DASHBOARD_SLUGS: Record<string, DashboardVariant> = {
  'ld-tennis': 'ld-tennis',
}

// Brainbase's own organisation slug — confirmed against the live
// organisations table (id 1732569e-..., slug 'brainbase', name
// "Brainbase") during this round's route trace. Kept as a slug, not a
// UUID, for the same reason LD Tennis is keyed by slug.
const BRAINBASE_SLUG = 'brainbase'

// Pure — takes the slug and role already looked up, returns which variant
// (if any) applies. Kept separate from the DB call below so it's directly
// testable without mocking sql.
//
// Brainbase HQ (Founder OS) additionally requires role === 'super_admin':
// Founder OS's own APIs (founder-state/founder-clients/founder-intelligence)
// and its /admin/founder route already independently enforce that same
// boundary, so this mirrors an existing rule rather than inventing a new
// one. A Brainbase-org user below super_admin falls through to BrainBase,
// same as before this feature existed.
export function dashboardVariantForSlug(slug: string | null | undefined, role: string | null | undefined): DashboardVariant | null {
  if (!slug) return null
  if (slug === BRAINBASE_SLUG) {
    return role === 'super_admin' ? 'brainbase-hq' : null
  }
  return CLIENT_DASHBOARD_SLUGS[slug] ?? null
}

// Server-side only: resolves the caller's organisation_id (already
// re-validated against the DB by the session helper that produced it — see
// lib/org.ts/lib/authSession.ts) to its slug, then to a dashboard variant.
// Never accepts an org identifier from the client/browser.
export async function resolveDashboardVariant(organisationId: string | null | undefined, role: string | null | undefined): Promise<DashboardVariant | null> {
  if (!organisationId) return null
  try {
    const rows = await sql`SELECT slug FROM organisations WHERE id = ${organisationId} LIMIT 1`
    return dashboardVariantForSlug(rows[0]?.slug as string | undefined, role)
  } catch {
    return null
  }
}
