import 'server-only';
import sql from '@/lib/db';
import type { AssuranceViewer } from './policy';

// BrainBase Assurance — restricted-record visibility, as composable SQL
// predicates (Neon HTTP template queries are composable: a sql`` fragment
// interpolated into another sql`` keeps its own bound parameters).
//
// Policy (single source of truth — every list, detail, count and link
// query uses these predicates, never client-side filtering):
//
//   Restricted Incident      visible to: admin+ ; owner ; reporter ; creator
//   Restricted Investigation visible to: admin+ ; lead ; creator
//   Finding   hidden if linked (through the explicit link tables) to a
//             restricted Incident or Investigation the viewer cannot see
//   Action    hidden if linked to a hidden Finding
//   Evidence  hidden if linked (active OR removed link) to a hidden
//             Incident, Investigation, Finding or Action
//
// A hidden record behaves exactly like a record that does not exist
// (404 on detail, absent from lists and counts). Restriction is
// inherited DOWNWARD only; an unrestricted Incident linked to a
// restricted Investigation stays visible, with the Investigation shown
// only as a redacted "restricted" placeholder.
//
// NULL SAFETY: owner/lead/reporter/creator columns are nullable, so a bare
// OR-chain can evaluate to NULL (not false) for a restricted row. That is
// harmless in a positive WHERE, but NOT(NULL) is also NULL, which would let
// a restricted parent slip through every "NOT <visible>" exclusion below
// (a real leak caught by the integration proof). Both base predicates are
// therefore wrapped in COALESCE(..., false) and are strictly two-valued.
//
// Aliases are a fixed allow-list interpolated via sql.unsafe(); no
// caller-supplied text is ever passed to sql.unsafe().

const ALLOWED_ALIASES = new Set([
  'inc', 'inv', 'f', 'a', 'e', 'x_inc', 'x_inv', 'x_f', 'x_a', 'fa', 'lf', 'la',
]);

function alias(name: string) {
  if (!ALLOWED_ALIASES.has(name)) throw new Error(`assurance access: alias "${name}" is not allow-listed`);
  return sql.unsafe(name);
}

export function incidentVisibleSql(viewer: AssuranceViewer, as = 'inc') {
  const t = alias(as);
  return sql`COALESCE((
    ${t}.restricted = false
    OR ${viewer.canViewAllRestricted}::boolean
    OR ${t}.owner_user_id = ${viewer.userId}
    OR ${t}.reported_by_user_id = ${viewer.userId}
    OR ${t}.created_by = ${viewer.userId}
  ), false)`;
}

export function investigationVisibleSql(viewer: AssuranceViewer, as = 'inv') {
  const t = alias(as);
  return sql`COALESCE((
    ${t}.restricted = false
    OR ${viewer.canViewAllRestricted}::boolean
    OR ${t}.lead_user_id = ${viewer.userId}
    OR ${t}.created_by = ${viewer.userId}
  ), false)`;
}

/** Finding row aliased `as` is visible. */
export function findingVisibleSql(viewer: AssuranceViewer, as = 'f') {
  const t = alias(as);
  return sql`(
    ${viewer.canViewAllRestricted}::boolean
    OR (
      NOT EXISTS (
        SELECT 1
        FROM assurance_incident_findings lif
        JOIN assurance_incidents x_inc
          ON x_inc.organisation_id = lif.organisation_id AND x_inc.id = lif.incident_id
        WHERE lif.organisation_id = ${t}.organisation_id
          AND lif.finding_id = ${t}.id
          AND NOT ${incidentVisibleSql(viewer, 'x_inc')}
      )
      AND NOT EXISTS (
        SELECT 1
        FROM assurance_investigation_findings lvf
        JOIN assurance_investigations x_inv
          ON x_inv.organisation_id = lvf.organisation_id AND x_inv.id = lvf.investigation_id
        WHERE lvf.organisation_id = ${t}.organisation_id
          AND lvf.finding_id = ${t}.id
          AND NOT ${investigationVisibleSql(viewer, 'x_inv')}
      )
    )
  )`;
}

/** Action row aliased `as` is visible. */
export function actionVisibleSql(viewer: AssuranceViewer, as = 'a') {
  const t = alias(as);
  return sql`(
    ${viewer.canViewAllRestricted}::boolean
    OR NOT EXISTS (
      SELECT 1
      FROM assurance_action_findings laf
      JOIN assurance_findings x_f
        ON x_f.organisation_id = laf.organisation_id AND x_f.id = laf.finding_id
      WHERE laf.organisation_id = ${t}.organisation_id
        AND laf.action_id = ${t}.id
        AND NOT ${findingVisibleSql(viewer, 'x_f')}
    )
  )`;
}

/** Evidence row aliased `as` is visible. Link history (removed links) counts too. */
export function evidenceVisibleSql(viewer: AssuranceViewer, as = 'e') {
  const t = alias(as);
  return sql`(
    ${viewer.canViewAllRestricted}::boolean
    OR (
      NOT EXISTS (
        SELECT 1 FROM assurance_evidence_incidents lei
        JOIN assurance_incidents x_inc
          ON x_inc.organisation_id = lei.organisation_id AND x_inc.id = lei.incident_id
        WHERE lei.organisation_id = ${t}.organisation_id AND lei.evidence_id = ${t}.id
          AND NOT ${incidentVisibleSql(viewer, 'x_inc')}
      )
      AND NOT EXISTS (
        SELECT 1 FROM assurance_evidence_investigations lev
        JOIN assurance_investigations x_inv
          ON x_inv.organisation_id = lev.organisation_id AND x_inv.id = lev.investigation_id
        WHERE lev.organisation_id = ${t}.organisation_id AND lev.evidence_id = ${t}.id
          AND NOT ${investigationVisibleSql(viewer, 'x_inv')}
      )
      AND NOT EXISTS (
        SELECT 1 FROM assurance_evidence_findings lef
        JOIN assurance_findings x_f
          ON x_f.organisation_id = lef.organisation_id AND x_f.id = lef.finding_id
        WHERE lef.organisation_id = ${t}.organisation_id AND lef.evidence_id = ${t}.id
          AND NOT ${findingVisibleSql(viewer, 'x_f')}
      )
      AND NOT EXISTS (
        SELECT 1 FROM assurance_evidence_actions lea
        JOIN assurance_actions x_a
          ON x_a.organisation_id = lea.organisation_id AND x_a.id = lea.action_id
        WHERE lea.organisation_id = ${t}.organisation_id AND lea.evidence_id = ${t}.id
          AND NOT ${actionVisibleSql(viewer, 'x_a')}
      )
      AND NOT EXISTS (
        SELECT 1 FROM assurance_evidence_verifications levr
        JOIN assurance_verifications x_vr
          ON x_vr.organisation_id = levr.organisation_id AND x_vr.id = levr.verification_id
        JOIN assurance_actions x_a
          ON x_a.organisation_id = x_vr.organisation_id AND x_a.id = x_vr.action_id
        WHERE levr.organisation_id = ${t}.organisation_id AND levr.evidence_id = ${t}.id
          AND NOT ${actionVisibleSql(viewer, 'x_a')}
      )
    )
  )`;
}
