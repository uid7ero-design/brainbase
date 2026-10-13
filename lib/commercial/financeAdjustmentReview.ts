import 'server-only';
import sql from '@/lib/db';
import type { AdjustmentScope,AdjustmentRegister,AdjustmentEvidence } from './financeAdjustmentReviewModel';

// Explicit projections retain exact numbers and tenant joins; no journal fact is changed.
const headerProjection = `jsonb_build_object('id',a.id,'number',a.adjustment_number::text,'status',a.status,'type',a.adjustment_type,
  'periodId',a.effective_financial_period_id,'periodName',p.name,'referencePeriodId',a.reference_financial_period_id,'currency',a.currency,
  'description',a.description,'reason',a.reason_code,'sourceType',a.source_type,'sourceId',a.source_id,'reversalOf',a.reversal_of_adjustment_id,
  'createdBy',a.created_by,'createdAt',a.created_at,'postedBy',a.posted_by,'postedAt',a.posted_at,'reversedBy',a.reversed_by,'reversedAt',a.reversed_at)`;

export async function listFinanceAdjustmentReview(organisationId:string,scope:AdjustmentScope,page:number):Promise<AdjustmentRegister>{
  const rows=await sql.query(`WITH filtered AS MATERIALIZED (
    SELECT ${headerProjection} AS header,a.created_at,a.id
    FROM commercial_finance_adjustments a JOIN commercial_financial_periods p ON p.id=a.effective_financial_period_id AND p.organisation_id=a.organisation_id
    WHERE a.organisation_id=$1 AND a.effective_financial_period_id=$2::uuid AND a.currency=$3 AND ($4::text='' OR a.status=$4)
  ), page_rows AS (SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT 25 OFFSET $5)
  SELECT (SELECT COUNT(*)::int FROM filtered) AS count,
    COALESCE((SELECT jsonb_agg(header ORDER BY created_at DESC,id DESC) FROM page_rows),'[]'::jsonb) AS adjustments`,[organisationId,scope.periodId,scope.currency,scope.status,(page-1)*25]) as Array<{count:number;adjustments:AdjustmentRegister['adjustments']}>;
  if(!rows[0])throw new Error('Unable to read adjustment register.');
  return {scope,page,pageSize:25,totalCount:rows[0].count,adjustments:rows[0].adjustments};
}

export async function getFinanceAdjustmentEvidence(organisationId:string,scope:AdjustmentScope,id:string):Promise<AdjustmentEvidence|null>{
  const rows=await sql.query(`SELECT ${headerProjection} AS adjustment,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',l.id,'position',l.position,'accountId',l.budget_account_id,'accountCode',ba.code,'accountName',ba.name,
      'centreId',l.cost_centre_id,'centreCode',cc.code,'centreName',cc.name,'exclusiveCents',l.amount_exclusive_cents::text,'taxCents',l.tax_cents::text,
      'inclusiveCents',l.amount_inclusive_cents::text,'resolvedBudgetId',l.resolved_budget_id,'resolvedVersionId',l.resolved_budget_version_id,
      'resolvedLineId',l.resolved_budget_line_id,'resolvedBasis',l.resolved_tax_basis,'budgetCents',l.budget_basis_cents::text,'sourceBillLineId',l.source_supplier_bill_line_id,'narrative',l.narrative) ORDER BY l.position)
      FROM commercial_finance_adjustment_lines l JOIN commercial_budget_accounts ba ON ba.id=l.budget_account_id AND ba.organisation_id=l.organisation_id
      JOIN commercial_cost_centres cc ON cc.id=l.cost_centre_id AND cc.organisation_id=l.organisation_id
      WHERE l.adjustment_id=a.id AND l.organisation_id=a.organisation_id),'[]'::jsonb) AS lines,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('id',e.id,'type',e.event_type,'actor',e.actor_user_id,'at',e.event_at,'details',e.details) ORDER BY e.event_at,CASE e.event_type WHEN 'CREATED' THEN 0 WHEN 'POSTED' THEN 1 ELSE 2 END,e.id)
      FROM commercial_finance_adjustment_events e WHERE e.adjustment_id=a.id AND e.organisation_id=a.organisation_id),'[]'::jsonb) AS events
    FROM commercial_finance_adjustments a JOIN commercial_financial_periods p ON p.id=a.effective_financial_period_id AND p.organisation_id=a.organisation_id
    WHERE a.id=$5::uuid AND a.organisation_id=$1 AND a.effective_financial_period_id=$2::uuid AND a.currency=$3 AND ($4::text='' OR a.status=$4)`,[organisationId,scope.periodId,scope.currency,scope.status,id]) as AdjustmentEvidence[];
  return rows[0]??null;
}
