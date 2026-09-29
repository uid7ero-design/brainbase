import 'server-only';
import sql from '@/lib/db';
import type { AssuranceViewer } from './policy';
import { incidentVisibleSql, investigationVisibleSql, findingVisibleSql, actionVisibleSql } from './access';
import type { AssuranceTimestamp } from './sqlHelpers';

// Assurance dashboard — operational questions, answered from real,
// tenant-scoped, restriction-aware queries. No synthetic numbers: an
// empty organisation yields zeros and empty lists, which the page renders
// as empty states.

export type DashboardCounts = {
  open_incidents: number;
  serious_open_incidents: number;
  active_investigations: number;
  overdue_investigations: number;
  inspections_due: number;
  inspections_in_progress: number;
  open_findings: number;
  overdue_findings: number;
  open_actions: number;
  overdue_actions: number;
  awaiting_verification: number;
  awaiting_evidence: number;
  audits_due: number;
  audits_in_progress: number;
  audits_completed_30d: number;
  open_audit_findings: number;
};

export type DashboardWorkItem = {
  kind: 'action' | 'finding' | 'investigation' | 'inspection' | 'audit' | 'incident';
  id: string; reference: string; title: string; status: string;
  due_at: AssuranceTimestamp | null; owner_name: string | null; detail: string | null;
};

export type DashboardData = {
  counts: DashboardCounts;
  attention: DashboardWorkItem[];
  awaitingVerification: DashboardWorkItem[];
  seriousIncidents: DashboardWorkItem[];
  activeInvestigations: DashboardWorkItem[];
  inspectionsDue: DashboardWorkItem[];
  recentIncidents: DashboardWorkItem[];
  findingsByType: { finding_type: string; n: number }[];
  incidentTrend: { week_start: AssuranceTimestamp; n: number }[];
  isEmpty: boolean;
};

export async function getDashboardData(viewer: AssuranceViewer): Promise<DashboardData> {
  const org = viewer.organisationId;

  // "Serious" = the incident's risk level is one of the organisation's two
  // highest-ranked ACTIVE risk levels. Organisations define their own risk
  // matrices (assurance_risk_levels), so no fixed code is assumed.
  const seriousRankFloor = sql`(
    SELECT min(rank) FROM (
      SELECT rank FROM assurance_risk_levels
      WHERE organisation_id = ${org} AND is_active = true
      ORDER BY rank DESC LIMIT 2
    ) top_levels
  )`;

  const [countsRows, overdueActions, overdueFindings, awaiting, serious, investigations, due, recent, byType, trend] = await Promise.all([
    sql`
      SELECT
        (SELECT count(*) FROM assurance_incidents inc
          WHERE inc.organisation_id = ${org} AND inc.status NOT IN ('CLOSED', 'CANCELLED') AND ${incidentVisibleSql(viewer)})::int AS open_incidents,
        (SELECT count(*) FROM assurance_incidents inc
           JOIN assurance_risk_levels rl ON rl.organisation_id = inc.organisation_id AND rl.id = inc.risk_level_id
          WHERE inc.organisation_id = ${org} AND inc.status NOT IN ('CLOSED', 'CANCELLED')
            AND rl.rank >= ${seriousRankFloor} AND ${incidentVisibleSql(viewer)})::int AS serious_open_incidents,
        (SELECT count(*) FROM assurance_investigations inv
          WHERE inv.organisation_id = ${org} AND inv.status NOT IN ('COMPLETED', 'CANCELLED') AND ${investigationVisibleSql(viewer)})::int AS active_investigations,
        (SELECT count(*) FROM assurance_investigations inv
          WHERE inv.organisation_id = ${org} AND inv.status NOT IN ('COMPLETED', 'CANCELLED')
            AND inv.target_completion_at < now() AND ${investigationVisibleSql(viewer)})::int AS overdue_investigations,
        (SELECT count(*) FROM assurance_inspections i
          WHERE i.organisation_id = ${org} AND i.status = 'PLANNED'
            AND i.scheduled_at IS NOT NULL AND i.scheduled_at < now() + interval '7 days')::int AS inspections_due,
        (SELECT count(*) FROM assurance_inspections i
          WHERE i.organisation_id = ${org} AND i.status = 'IN_PROGRESS')::int AS inspections_in_progress,
        (SELECT count(*) FROM assurance_findings f
          WHERE f.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)})::int AS open_findings,
        (SELECT count(*) FROM assurance_findings f
          WHERE f.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)}
            AND EXISTS (SELECT 1 FROM assurance_timeframes t WHERE t.organisation_id = f.organisation_id AND t.finding_id = f.id
                        AND t.status IN ('ACTIVE', 'OVERDUE') AND t.current_due_at < now()))::int AS overdue_findings,
        (SELECT count(*) FROM assurance_actions a
          WHERE a.organisation_id = ${org} AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)})::int AS open_actions,
        (SELECT count(*) FROM assurance_actions a
          WHERE a.organisation_id = ${org} AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)}
            AND EXISTS (SELECT 1 FROM assurance_timeframes t WHERE t.organisation_id = a.organisation_id AND t.action_id = a.id
                        AND t.status IN ('ACTIVE', 'OVERDUE') AND t.current_due_at < now()))::int AS overdue_actions,
        (SELECT count(*) FROM assurance_actions a
          WHERE a.organisation_id = ${org} AND a.status = 'AWAITING_VERIFICATION' AND ${actionVisibleSql(viewer)})::int AS awaiting_verification,
        (SELECT count(*) FROM assurance_actions a
          WHERE a.organisation_id = ${org} AND a.status = 'AWAITING_EVIDENCE' AND ${actionVisibleSql(viewer)})::int AS awaiting_evidence,
        (SELECT count(*) FROM assurance_audits au
          WHERE au.organisation_id = ${org} AND au.status = 'PLANNED'
            AND au.scheduled_at IS NOT NULL AND au.scheduled_at < now() + interval '14 days')::int AS audits_due,
        (SELECT count(*) FROM assurance_audits au
          WHERE au.organisation_id = ${org} AND au.status = 'IN_PROGRESS')::int AS audits_in_progress,
        (SELECT count(*) FROM assurance_audits au
          WHERE au.organisation_id = ${org} AND au.status = 'COMPLETED' AND au.completed_at > now() - interval '30 days')::int AS audits_completed_30d,
        (SELECT count(DISTINCT f.id) FROM assurance_audit_findings af
           JOIN assurance_findings f ON f.organisation_id = af.organisation_id AND f.id = af.finding_id
          WHERE af.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)})::int AS open_audit_findings
    `,
    sql`
      SELECT 'action' AS kind, a.id, a.action_reference AS reference, a.title, a.status, t.current_due_at AS due_at,
             ou.name AS owner_name, a.priority AS detail
      FROM assurance_actions a
      JOIN LATERAL (
        SELECT current_due_at FROM assurance_timeframes t
        WHERE t.organisation_id = a.organisation_id AND t.action_id = a.id AND t.status IN ('ACTIVE', 'OVERDUE')
        ORDER BY current_due_at ASC LIMIT 1
      ) t ON true
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE a.organisation_id = ${org} AND a.status NOT IN ('CLOSED', 'CANCELLED') AND ${actionVisibleSql(viewer)}
        AND t.current_due_at < now() + interval '3 days'
      ORDER BY t.current_due_at ASC
      LIMIT 8
    `,
    sql`
      SELECT 'finding' AS kind, f.id, f.finding_reference AS reference, f.title, f.status, t.current_due_at AS due_at,
             ru.name AS owner_name, f.finding_type AS detail
      FROM assurance_findings f
      JOIN LATERAL (
        SELECT current_due_at FROM assurance_timeframes t
        WHERE t.organisation_id = f.organisation_id AND t.finding_id = f.id AND t.status IN ('ACTIVE', 'OVERDUE')
        ORDER BY current_due_at ASC LIMIT 1
      ) t ON true
      LEFT JOIN users ru ON ru.id = f.responsible_user_id AND ru.organisation_id = f.organisation_id
      WHERE f.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)}
        AND t.current_due_at < now() + interval '3 days'
      ORDER BY t.current_due_at ASC
      LIMIT 8
    `,
    sql`
      SELECT 'action' AS kind, a.id, a.action_reference AS reference, a.title, a.status, a.work_completed_at AS due_at,
             ou.name AS owner_name, a.priority AS detail
      FROM assurance_actions a
      LEFT JOIN users ou ON ou.id = a.owner_user_id AND ou.organisation_id = a.organisation_id
      WHERE a.organisation_id = ${org} AND a.status = 'AWAITING_VERIFICATION' AND ${actionVisibleSql(viewer)}
      ORDER BY a.work_completed_at ASC NULLS LAST
      LIMIT 6
    `,
    sql`
      SELECT 'incident' AS kind, inc.id, inc.incident_reference AS reference, inc.title, inc.status, inc.occurred_at AS due_at,
             ou.name AS owner_name, rl.name AS detail
      FROM assurance_incidents inc
      JOIN assurance_risk_levels rl ON rl.organisation_id = inc.organisation_id AND rl.id = inc.risk_level_id
      LEFT JOIN users ou ON ou.id = inc.owner_user_id AND ou.organisation_id = inc.organisation_id
      WHERE inc.organisation_id = ${org} AND inc.status NOT IN ('CLOSED', 'CANCELLED')
        AND rl.rank >= ${seriousRankFloor} AND ${incidentVisibleSql(viewer)}
      ORDER BY rl.rank DESC, inc.occurred_at DESC
      LIMIT 6
    `,
    sql`
      SELECT 'investigation' AS kind, inv.id, inv.investigation_reference AS reference, inv.title, inv.status,
             inv.target_completion_at AS due_at, lu.name AS owner_name, NULL::text AS detail
      FROM assurance_investigations inv
      LEFT JOIN users lu ON lu.id = inv.lead_user_id AND lu.organisation_id = inv.organisation_id
      WHERE inv.organisation_id = ${org} AND inv.status NOT IN ('COMPLETED', 'CANCELLED') AND ${investigationVisibleSql(viewer)}
      ORDER BY inv.target_completion_at ASC NULLS LAST
      LIMIT 6
    `,
    sql`
      SELECT 'inspection' AS kind, i.id, i.inspection_reference AS reference, i.title, i.status, i.scheduled_at AS due_at,
             iu.name AS owner_name, loc.name AS detail
      FROM assurance_inspections i
      LEFT JOIN users iu ON iu.id = i.inspector_user_id AND iu.organisation_id = i.organisation_id
      LEFT JOIN locations loc ON loc.organisation_id = i.organisation_id AND loc.id = i.location_id
      WHERE i.organisation_id = ${org}
        AND (i.status = 'IN_PROGRESS' OR (i.status = 'PLANNED' AND i.scheduled_at IS NOT NULL AND i.scheduled_at < now() + interval '7 days'))
      UNION ALL
      SELECT 'audit' AS kind, au.id, au.audit_reference AS reference, au.title, au.status, au.scheduled_at AS due_at,
             uu.name AS owner_name, COALESCE(au.standard_reference, loc.name) AS detail
      FROM assurance_audits au
      LEFT JOIN users uu ON uu.id = au.auditor_user_id AND uu.organisation_id = au.organisation_id
      LEFT JOIN locations loc ON loc.organisation_id = au.organisation_id AND loc.id = au.location_id
      WHERE au.organisation_id = ${org}
        AND (au.status = 'IN_PROGRESS' OR (au.status = 'PLANNED' AND au.scheduled_at IS NOT NULL AND au.scheduled_at < now() + interval '14 days'))
      ORDER BY 5 ASC, 6 ASC NULLS LAST -- status: IN_PROGRESS sorts before PLANNED
      LIMIT 8
    `,
    sql`
      SELECT 'incident' AS kind, inc.id, inc.incident_reference AS reference, inc.title, inc.status, inc.occurred_at AS due_at,
             ou.name AS owner_name, inc.category AS detail
      FROM assurance_incidents inc
      LEFT JOIN users ou ON ou.id = inc.owner_user_id AND ou.organisation_id = inc.organisation_id
      WHERE inc.organisation_id = ${org} AND ${incidentVisibleSql(viewer)}
      ORDER BY inc.occurred_at DESC
      LIMIT 6
    `,
    sql`
      SELECT f.finding_type, count(*)::int AS n
      FROM assurance_findings f
      WHERE f.organisation_id = ${org} AND f.status NOT IN ('CLOSED', 'CANCELLED') AND ${findingVisibleSql(viewer)}
      GROUP BY f.finding_type
      ORDER BY n DESC
    `,
    sql`
      SELECT w.week_start, COALESCE(c.n, 0)::int AS n
      FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') AS w(week_start)
      LEFT JOIN (
        SELECT date_trunc('week', inc.occurred_at) AS wk, count(*) AS n
        FROM assurance_incidents inc
        WHERE inc.organisation_id = ${org} AND inc.occurred_at >= date_trunc('week', now()) - interval '7 weeks'
          AND ${incidentVisibleSql(viewer)}
        GROUP BY 1
      ) c ON c.wk = w.week_start
      ORDER BY w.week_start ASC
    `,
  ]);

  const counts = (countsRows as DashboardCounts[])[0];
  const attention = [...(overdueActions as DashboardWorkItem[]), ...(overdueFindings as DashboardWorkItem[])]
    .sort((a, b) => new Date(a.due_at ?? 0).getTime() - new Date(b.due_at ?? 0).getTime())
    .slice(0, 10);
  const isEmpty = counts.open_incidents === 0 && counts.active_investigations === 0 && counts.open_findings === 0
    && counts.open_actions === 0 && counts.inspections_due === 0 && counts.inspections_in_progress === 0
    && counts.audits_due === 0 && counts.audits_in_progress === 0
    && (recent as unknown[]).length === 0;

  return {
    counts,
    attention,
    awaitingVerification: awaiting as DashboardWorkItem[],
    seriousIncidents: serious as DashboardWorkItem[],
    activeInvestigations: investigations as DashboardWorkItem[],
    inspectionsDue: due as DashboardWorkItem[],
    recentIncidents: recent as DashboardWorkItem[],
    findingsByType: byType as { finding_type: string; n: number }[],
    incidentTrend: trend as { week_start: AssuranceTimestamp; n: number }[],
    isEmpty,
  };
}
