import 'server-only';
import sql from '@/lib/db';
import { resolveBrainbaseOrgId } from '@/lib/founder/tasksBoard';

// Founder OS Phase E.3 — real, 30-day Product Usage aggregates.
//
// Pre-merge correction: a read-only Neon introspection query proved
// social_insights and saved_briefings do NOT exist in the real deployed
// database (their CREATE TABLE statements in app/api/admin/migrate/
// route.ts declare organisation_id as UUID referencing organisations(id),
// but organisations.id is genuinely TEXT there — a UUID column cannot
// have a foreign key to a TEXT column, so those two CREATE TABLE
// statements never succeeded). Querying them in the original E.3
// implementation caused getProductUsage()'s Promise.all to reject on
// every request, which is why the deployed preview showed "Not
// connected". They are permanently removed from this file, not
// replaced with a speculative alternative.
//
// Scoped to the two sources confirmed by that same introspection to
// exist with organisation_id genuinely typed TEXT: uploaded_files,
// organiser_item_updates. integrations/sync_jobs/agent_runs do not
// exist in Production; users.last_seen_at does not exist; users.
// last_login_at is unpopulated — none of those are queried here or
// anywhere in this file. organiser_items (not organiser_item_updates) is
// deliberately NOT queried: the Phase E.2 audit found bulk CSV import
// can create many organiser_items from one user action with no
// distinguishing marker.
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
// Both organisation_id columns queried here are confirmed TEXT — direct
// comparison against resolveBrainbaseOrgId()'s TEXT return value, no
// cast needed (the ::uuid cast this file previously carried was only
// ever needed for the now-removed social_insights/saved_briefings
// queries).
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
};

export async function getProductUsage(): Promise<ProductUsageAggregate> {
  const brainbaseOrgId = await resolveBrainbaseOrgId();

  const [uploadsRows, organiserRows] = await Promise.all([
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
  ]);

  return {
    windowDays: WINDOW_DAYS,
    uploads: (uploadsRows[0]?.count as number) ?? 0,
    organiserUpdates: (organiserRows[0]?.count as number) ?? 0,
  };
}
