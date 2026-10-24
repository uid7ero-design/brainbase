import 'server-only';
import sql from '@/lib/db';
import type { ReconciliationEvidence, ReconciliationEvidenceScope, ReconciliationEvidenceFilter } from './financeReconciliationEvidenceModel';

/** One statement keeps saved header, all-item checks, selected page and events together. */
export async function getReconciliationEvidence(organisationId: string, scope: ReconciliationEvidenceScope, id: string, filter: ReconciliationEvidenceFilter, page: number): Promise<ReconciliationEvidence|null> {
  const rows = await sql.query(`WITH selected AS MATERIALIZED (
    SELECT r.*,p.name AS period_name,y.id AS year_id,y.name AS year_name,
      NOT EXISTS(SELECT 1 FROM commercial_finance_reconciliations newer WHERE newer.organisation_id=r.organisation_id
        AND newer.financial_period_id=r.financial_period_id AND newer.source_system_id=r.source_system_id AND newer.currency=r.currency
        AND (newer.prepared_at,newer.id)>(r.prepared_at,r.id)) AS latest
    FROM commercial_finance_reconciliations r
    JOIN commercial_financial_periods p ON p.id=r.financial_period_id AND p.organisation_id=r.organisation_id
    JOIN commercial_financial_years y ON y.id=p.financial_year_id AND y.organisation_id=p.organisation_id
    WHERE r.organisation_id=$1 AND r.id=$2::uuid AND y.id=$3::uuid AND p.id=$4::uuid AND r.source_system_id=$5 AND r.currency=$6
  ), all_items AS MATERIALIZED (
    SELECT i.*,ba.code AS account_code,cc.code AS centre_code FROM commercial_finance_reconciliation_items i
    JOIN selected r ON r.id=i.reconciliation_id AND r.organisation_id=i.organisation_id
    LEFT JOIN commercial_budget_accounts ba ON ba.id=i.budget_account_id AND ba.organisation_id=i.organisation_id
    LEFT JOIN commercial_cost_centres cc ON cc.id=i.cost_centre_id AND cc.organisation_id=i.organisation_id
  ), filtered AS MATERIALIZED (
    SELECT * FROM all_items WHERE $7::text='' OR ($7='UNRESOLVED' AND outcome<>'RECONCILED') OR outcome=$7
  ), page_items AS (SELECT * FROM filtered ORDER BY outcome,id LIMIT 25 OFFSET $8)
  SELECT jsonb_build_object('id',r.id,'yearId',r.year_id,'yearName',r.year_name,'periodId',r.financial_period_id,'periodName',r.period_name,
    'source',r.source_system_id,'currency',r.currency,'status',r.status,'closeId',r.close_id,'snapshotAt',r.snapshot_at,
    'preparedAt',r.prepared_at,'preparedBy',r.prepared_by,'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'notes',r.notes,'latest',r.latest,
    'sourceActualCents',r.source_actual_cents::text,'financeAdjustmentCents',r.finance_adjustment_cents::text,
    'effectiveActualCents',r.brainbase_effective_actual_cents::text,'externalGlCents',r.external_gl_total_cents::text,'varianceCents',r.variance_cents::text,
    'unresolvedCount',r.unresolved_item_count) AS header,
    (SELECT COUNT(*)::int FROM all_items) AS "totalCount",(SELECT COUNT(*)::int FROM filtered) AS "filteredCount",
    (SELECT COUNT(*)::int FROM all_items WHERE outcome<>'RECONCILED') AS "unresolvedCount",
    (SELECT jsonb_build_object('sourceActualCents',COALESCE(SUM(source_actual_cents),0)::text,
      'financeAdjustmentCents',COALESCE(SUM(finance_adjustment_cents),0)::text,'effectiveActualCents',COALESCE(SUM(brainbase_effective_actual_cents),0)::text,
      'externalGlCents',COALESCE(SUM(external_gl_cents),0)::text,'varianceCents',COALESCE(SUM(variance_cents),0)::text) FROM all_items) AS totals,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',i.id,'currency',i.currency,'accountId',i.budget_account_id,'accountCode',i.account_code,
      'centreId',i.cost_centre_id,'centreCode',i.centre_code,'accountMappingId',i.external_gl_account_mapping_id,'centreMappingId',i.external_cost_centre_mapping_id,
      'externalAccountCode',i.external_gl_account_code,'externalCentreCode',i.external_cost_centre_code,
      'sourceActualCents',i.source_actual_cents::text,'financeAdjustmentCents',i.finance_adjustment_cents::text,'effectiveActualCents',i.brainbase_effective_actual_cents::text,
      'externalGlCents',i.external_gl_cents::text,'varianceCents',i.variance_cents::text,'sourceCount',i.source_actual_count,'externalCount',i.external_entry_count,'outcome',i.outcome)
      ORDER BY i.outcome,i.id) FROM page_items i),'[]'::jsonb) AS items,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'actor',e.actor_user_id,'at',e.event_at,'details',e.details)
      ORDER BY e.event_at,CASE e.event_type WHEN 'PREPARED' THEN 0 WHEN 'REVIEWED' THEN 1 WHEN 'SIGNED_OFF' THEN 2 ELSE 3 END,e.id)
      FROM commercial_finance_reconciliation_events e WHERE e.reconciliation_id=r.id AND e.organisation_id=r.organisation_id),'[]'::jsonb) AS events
  FROM selected r`, [organisationId,id,scope.yearId,scope.periodId,scope.source,scope.currency,filter,(page-1)*25]) as Array<Omit<ReconciliationEvidence,'scope'|'filter'|'page'|'pageSize'>>;
  return rows[0] ? { ...rows[0], scope, filter, page, pageSize:25 } : null;
}
