import 'server-only';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId } from '@/lib/founder/tasksBoard';

// Founder OS Phase E.3 — real, 30-day Product Usage aggregates.
//
// Scoped EXACTLY to the four sources the Phase E.2 audit confirmed are
// authoritative, org-scoped, and free of known contamination once two
// specific exclusions are applied: uploaded_files, organiser_item_updates,
// social_insights, saved_briefings. integrations/sync_jobs/agent_runs do
// not exist in Production; users.last_seen_at does not exist; users.
// last_login_at is unpopulated — none of those are queried here or
// anywhere in this file. organiser_items (not organiser_item_updates) is
// deliberately NOT queried: E.2 found bulk CSV import can create many
// organiser_items from one user action with no distinguishing marker.
//
// BrainBase's own organisation is excluded from every metric via
// resolveBrainbaseOrgId() (lib/founder/tasksBoard.ts's established,
// impersonation-proof resolver) — never from the caller's own session,
// which a super_admin could be viewing under an org_override
// impersonation cookie. If BrainBase's org can't be resolved, the
// exclusion is a safe no-op (matches the same defensive
// `(${id}::text IS NULL OR ...)` idiom already used in
// app/api/admin/agent-runs/route.ts) rather than failing the whole query.
//
// organisations.id is TEXT (its values are UUID-shaped strings, e.g.
// gen_random_uuid()::text — the same convention already established for
// organiser_boards/implementations/uploaded_files/organiser_items).
// social_insights.organisation_id and saved_briefings.organisation_id are
// genuinely typed UUID (a schema-drift wrinkle from when those two tables
// were added) — comparing them against the TEXT org id requires an
// explicit ::uuid cast. This is not a guess: it is the exact, already-
// live cast pattern app/api/briefings/route.ts and
// app/api/social/analyse/route.ts themselves already use
// (`${session.organisationId}::uuid`) to write to these same two tables
// successfully in Production today — reused here verbatim, not invented.
//
// No auth check happens in this file, matching the established
// lib/founder/tasksBoard.ts / lib/founder/systemSignals.ts convention:
// the calling route (app/api/founder/usage/route.ts) enforces the
// super_admin gate once, before this function is ever called.

const WINDOW_DAYS = 30;

export type ProductUsageAggregate = {
  windowDays: number;
  uploads: number;
  organiserUpdates: number;
  socialAnalyses: number;
  briefingsGenerated: number;
};

export async function getProductUsage(): Promise<ProductUsageAggregate> {
  const brainbaseOrgId = await resolveBrainbaseOrgId();

  const [uploadsRows, organiserRows, socialRows, briefingsRows] = await Promise.all([
    // uploaded_files.organisation_id is TEXT — direct comparison, no cast.
    // The demo-seed exclusion is mandatory: app/api/admin/seed-demo/
    // route.ts can insert a real row named exactly 'demo-seed.csv'.
    sql`
      SELECT COUNT(*)::int AS count FROM uploaded_files
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND file_name <> 'demo-seed.csv'
        AND (${brainbaseOrgId}::text IS NULL OR organisation_id <> ${brainbaseOrgId})
    `,
    // organiser_item_updates.organisation_id is TEXT — direct comparison.
    // Deliberately NOT organiser_items (see file header).
    sql`
      SELECT COUNT(*)::int AS count FROM organiser_item_updates
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND (${brainbaseOrgId}::text IS NULL OR organisation_id <> ${brainbaseOrgId})
    `,
    // social_insights.organisation_id is UUID — explicit cast (see file
    // header for why this is a proven-safe, already-live pattern).
    sql`
      SELECT COUNT(*)::int AS count FROM social_insights
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND (${brainbaseOrgId}::text IS NULL OR organisation_id <> ${brainbaseOrgId}::uuid)
    `,
    // saved_briefings.organisation_id is UUID — same cast pattern.
    sql`
      SELECT COUNT(*)::int AS count FROM saved_briefings
      WHERE created_at > NOW() - INTERVAL '30 days'
        AND (${brainbaseOrgId}::text IS NULL OR organisation_id <> ${brainbaseOrgId}::uuid)
    `,
  ]);

  return {
    windowDays: WINDOW_DAYS,
    uploads: (uploadsRows[0]?.count as number) ?? 0,
    organiserUpdates: (organiserRows[0]?.count as number) ?? 0,
    socialAnalyses: (socialRows[0]?.count as number) ?? 0,
    briefingsGenerated: (briefingsRows[0]?.count as number) ?? 0,
  };
}
