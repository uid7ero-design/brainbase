import 'server-only';
import sql from '@/lib/db';
import type { ReconciliationEvidenceScope } from './financeReconciliationEvidenceModel';
import type { ReconciliationHistory,ReconciliationHistoryStatus } from './financeReconciliationHistoryModel';
export async function listReconciliationHistory(organisationId:string,scope:ReconciliationEvidenceScope,status:ReconciliationHistoryStatus,page:number):Promise<ReconciliationHistory>{
  const rows=await sql.query(`WITH scoped AS MATERIALIZED (
    SELECT r.*,p.name AS period_name,y.id AS year_id,y.name AS year_name,
      row_number() OVER(ORDER BY r.prepared_at DESC,r.id DESC)=1 AS latest
    FROM commercial_finance_reconciliations r
    JOIN commercial_financial_periods p ON p.id=r.financial_period_id AND p.organisation_id=r.organisation_id
    JOIN commercial_financial_years y ON y.id=p.financial_year_id AND y.organisation_id=p.organisation_id
    WHERE r.organisation_id=$1 AND y.id=$2::uuid AND p.id=$3::uuid AND r.source_system_id=$4 AND r.currency=$5
  ),filtered AS MATERIALIZED (SELECT * FROM scoped WHERE $6::text='' OR status=$6),
  page_rows AS (SELECT * FROM filtered ORDER BY prepared_at DESC,id DESC LIMIT 25 OFFSET $7)
  SELECT (SELECT COUNT(*)::int FROM filtered) AS count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'yearId',r.year_id,'yearName',r.year_name,'periodId',r.financial_period_id,'periodName',r.period_name,
      'source',r.source_system_id,'currency',r.currency,'status',r.status,'closeId',r.close_id,'snapshotAt',r.snapshot_at,
      'preparedAt',r.prepared_at,'preparedBy',r.prepared_by,'reviewedAt',r.reviewed_at,'reviewedBy',r.reviewed_by,'notes',r.notes,'latest',r.latest,
      'sourceActualCents',r.source_actual_cents::text,'financeAdjustmentCents',r.finance_adjustment_cents::text,'effectiveActualCents',r.brainbase_effective_actual_cents::text,
      'externalGlCents',r.external_gl_total_cents::text,'varianceCents',r.variance_cents::text,'unresolvedCount',r.unresolved_item_count)
      ORDER BY r.prepared_at DESC,r.id DESC) FROM page_rows r),'[]'::jsonb) AS records`,
    [organisationId,scope.yearId,scope.periodId,scope.source,scope.currency,status,(page-1)*25]) as Array<{count:number;records:ReconciliationHistory['records']}>;
  if(!rows[0])throw new Error('Unable to read saved reconciliation history.');
  return {scope,status,page,pageSize:25,totalCount:rows[0].count,records:rows[0].records};
}
