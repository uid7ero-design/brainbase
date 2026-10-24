import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getReconciliationEvidence } from '@/lib/commercial/financeReconciliationEvidence';
import { RECONCILIATION_OUTCOMES, type ReconciliationEvidenceFilter } from '@/lib/commercial/financeReconciliationEvidenceModel';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request: Request) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;
  const query = new URL(request.url).searchParams;
  const id=query.get('id')??'',yearId=query.get('yearId')??'',periodId=query.get('periodId')??'';
  const source=(query.get('source')??'').trim(),currency=(query.get('currency')??'').trim().toUpperCase();
  const filter=query.get('filter')??'',rawPage=query.get('page')??'1',page=Number(rawPage);
  if (![id,yearId,periodId].every(value=>uuid.test(value)) || !source || source.length>300 || !/^[A-Z]{3}$/.test(currency)
    || !['','UNRESOLVED',...RECONCILIATION_OUTCOMES].includes(filter) || !/^[1-9]\d*$/.test(rawPage) || !Number.isSafeInteger(page) || page>100000) {
    return NextResponse.json({error:'Choose valid reconciliation evidence, scope, outcome and page.'},{status:400,headers:{'Cache-Control':'no-store'}});
  }
  const evidence=await getReconciliationEvidence(auth.session.organisationId,{yearId,periodId,source,currency},id,filter as ReconciliationEvidenceFilter,page);
  return evidence ? NextResponse.json({evidence},{headers:{'Cache-Control':'no-store'}})
    : NextResponse.json({error:'Reconciliation evidence was not found in this scope.'},{status:404,headers:{'Cache-Control':'no-store'}});
}
