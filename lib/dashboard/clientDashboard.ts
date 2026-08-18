import 'server-only'
import sql from '@/lib/db'

// Which bespoke client-facing dashboard body an organisation should see at
// /dashboard, keyed by the organisation's own stable `slug` column — not a
// hardcoded UUID/env var, and never a user ID. Extend this map when a
// second client dashboard is built; any organisation not listed here
// (including the owner/Brainbase org and any future client not yet added)
// correctly falls through to the generic BrainBase shell in
// app/dashboard/page.tsx, exactly as it does today.
export type DashboardVariant = 'ld-tennis'

const CLIENT_DASHBOARD_SLUGS: Record<string, DashboardVariant> = {
  'ld-tennis': 'ld-tennis',
}

// Pure — takes the slug already looked up, returns which variant (if any)
// applies. Kept separate from the DB call below so it's directly testable
// without mocking sql.
export function dashboardVariantForSlug(slug: string | null | undefined): DashboardVariant | null {
  if (!slug) return null
  return CLIENT_DASHBOARD_SLUGS[slug] ?? null
}

// Server-side only: resolves the caller's organisation_id (already
// re-validated against the DB by the session helper that produced it — see
// lib/org.ts/lib/authSession.ts) to its slug, then to a dashboard variant.
// Never accepts an org identifier from the client/browser.
export async function resolveDashboardVariant(organisationId: string | null | undefined): Promise<DashboardVariant | null> {
  if (!organisationId) return null
  try {
    const rows = await sql`SELECT slug FROM organisations WHERE id = ${organisationId} LIMIT 1`
    return dashboardVariantForSlug(rows[0]?.slug as string | undefined)
  } catch {
    return null
  }
}
