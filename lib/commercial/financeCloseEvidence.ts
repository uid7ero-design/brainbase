import 'server-only';
import sql from '@/lib/db';
import type { CloseEvidence,CloseEvidenceScope } from './financeCloseEvidenceModel';

export async function getCloseEvidence(organisationId:string,scope:CloseEvidenceScope,id:string):Promise<CloseEvidence|null>{
  // Only fixed identifiers are selected here; every user/session value is bound.
  const period=scope.kind==='period';
  const table=period?'commercial_financial_period_closes':'commercial_financial_year_closes';
  const parent=period?'p':'y';
  const parentId=period?'financial_period_id':'financial_year_id';
  const joins=period?`JOIN commercial_financial_periods p ON p.id=c.financial_period_id AND p.organisation_id=c.organisation_id
    JOIN commercial_financial_years y ON y.id=p.financial_year_id AND y.organisation_id=p.organisation_id`
    :`JOIN commercial_financial_years y ON y.id=c.financial_year_id AND y.organisation_id=c.organisation_id`;
  const later=`EXISTS(SELECT 1 FROM ${table} newer WHERE newer.organisation_id=c.organisation_id AND newer.${parentId}=c.${parentId} AND newer.close_sequence>c.close_sequence)`;
  const rows=await sql.query(`SELECT jsonb_build_object('id',c.id,'kind',$5::text,'yearId',y.id,'yearName',y.name,
    'periodId',${period?'p.id':'NULL'},'periodName',${period?'p.name':'NULL'},'calendarStatus',${parent}.status,
    'startsOn',${parent}.starts_on::text,'endsOn',${parent}.ends_on::text,'sequence',c.close_sequence,'status',c.status,
    'closedBy',c.closed_by,'closedAt',c.closed_at,'closeReason',c.close_reason,'invalidatedBy',c.invalidated_by,
    'invalidatedAt',c.invalidated_at,'invalidationReason',c.invalidation_reason,'controlTotals',c.control_totals,
    'reconciliationStatus',${period?'c.reconciliation_status':'NULL'},'laterCloseExists',${later},
    'current',(c.status='CLOSED' AND ${parent}.status='CLOSED' AND NOT ${later}),
    'linkedReconciliations',${period?`COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'source',r.source_system_id,'currency',r.currency,'status',r.status) ORDER BY r.source_system_id,r.currency,r.id)
      FROM commercial_finance_reconciliations r WHERE r.close_id=c.id AND r.organisation_id=c.organisation_id AND r.financial_period_id=p.id),'[]'::jsonb)`:`'[]'::jsonb`}) AS evidence
    FROM ${table} c ${joins} WHERE c.organisation_id=$1 AND c.id=$2::uuid AND y.id=$3::uuid
      AND ${period?'p.id=$4::uuid':'$4::uuid IS NULL'}`,[organisationId,id,scope.yearId,scope.periodId,scope.kind]) as Array<{evidence:CloseEvidence}>;
  return rows[0]?.evidence??null;
}
