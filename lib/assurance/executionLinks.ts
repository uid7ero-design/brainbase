import 'server-only';
import sql from '@/lib/db';
import { actionVisibleSql, findingVisibleSql } from './access';
import type { AssuranceViewer } from './policy';

// READ-ONLY view of the corrective work hanging off an Inspection / Audit:
// Actions are reached THROUGH the record's Findings (source → Finding →
// Action). There is no Inspection/Audit → Action link and nothing here
// writes; the Inspection and Audit services stay free of Action tables.
// Every hop uses the shared visibility predicates, so a restricted Finding or
// Action is neither listed nor counted.

export type LinkedActionRow = {
  id: string; action_reference: string; title: string; status: string; owner_name: string | null;
  finding_id: string; finding_reference: string;
};

/**
 * Correlated count of OPEN Actions (not closed/cancelled) for the register
 * row aliased `i` (inspection) or `au` (audit).
 */
export function openActionCountSql(viewer: AssuranceViewer, kind: 'inspection' | 'audit') {
  return kind === 'inspection'
    ? sql`(SELECT count(DISTINCT a.id) FROM assurance_inspection_findings xf
        JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
        JOIN assurance_action_findings laf ON laf.organisation_id = f.organisation_id AND laf.finding_id = f.id
        JOIN assurance_actions a ON a.organisation_id = laf.organisation_id AND a.id = laf.action_id
        WHERE xf.organisation_id = i.organisation_id AND xf.inspection_id = i.id AND ${findingVisibleSql(viewer)}
          AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)})::int`
    : sql`(SELECT count(DISTINCT a.id) FROM assurance_audit_findings xf
        JOIN assurance_findings f ON f.organisation_id = xf.organisation_id AND f.id = xf.finding_id
        JOIN assurance_action_findings laf ON laf.organisation_id = f.organisation_id AND laf.finding_id = f.id
        JOIN assurance_actions a ON a.organisation_id = laf.organisation_id AND a.id = laf.action_id
        WHERE xf.organisation_id = au.organisation_id AND xf.audit_id = au.id AND ${findingVisibleSql(viewer)}
          AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)})::int`;
}

/** Visible Actions raised from the record's visible Findings, by reference. */
export async function listActionsViaFindings(viewer: AssuranceViewer, kind: 'inspection' | 'audit', id: string): Promise<LinkedActionRow[]> {
  const org = viewer.organisationId;
  const rows = (kind === 'inspection'
    ? await sql`
      SELECT DISTINCT ON (a.id) a.id, a.action_reference, a.title, a.status, ou.name AS owner_name,
             f.id AS finding_id, f.finding_reference
      FROM assurance_inspection_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      JOIN assurance_action_findings laf ON laf.organisation_id = f.organisation_id AND laf.finding_id = f.id
      JOIN assurance_actions a ON a.organisation_id = laf.organisation_id AND a.id = laf.action_id
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE lx.organisation_id = ${org} AND lx.inspection_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)} AND ${actionVisibleSql(viewer)}
      ORDER BY a.id, f.identified_at
    `
    : await sql`
      SELECT DISTINCT ON (a.id) a.id, a.action_reference, a.title, a.status, ou.name AS owner_name,
             f.id AS finding_id, f.finding_reference
      FROM assurance_audit_findings lx
      JOIN assurance_findings f ON f.organisation_id = lx.organisation_id AND f.id = lx.finding_id
      JOIN assurance_action_findings laf ON laf.organisation_id = f.organisation_id AND laf.finding_id = f.id
      JOIN assurance_actions a ON a.organisation_id = laf.organisation_id AND a.id = laf.action_id
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE lx.organisation_id = ${org} AND lx.audit_id = ${id}::uuid
        AND ${findingVisibleSql(viewer)} AND ${actionVisibleSql(viewer)}
      ORDER BY a.id, f.identified_at
    `) as LinkedActionRow[];
  return rows.sort((x, y) => x.action_reference.localeCompare(y.action_reference));
}
