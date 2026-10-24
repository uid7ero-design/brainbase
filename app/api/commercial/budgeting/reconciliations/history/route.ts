import { NextResponse } from 'next/server';
import { authorizeCommercialRequest,COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listReconciliationHistory } from '@/lib/commercial/financeReconciliationHistory';
import { RECONCILIATION_HISTORY_STATUSES,type ReconciliationHistoryStatus } from '@/lib/commercial/financeReconciliationHistoryModel';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);if(!auth.ok)return auth.response;
  const query=new URL(request.url).searchParams,yearId=query.get('yearId')??'',periodId=query.get('periodId')??'';
  const source=(query.get('source')??'').trim(),currency=(query.get('currency')??'').trim().toUpperCase(),status=query.get('status')??'',rawPage=query.get('page')??'1',page=Number(rawPage);
  if(!uuid.test(yearId)||!uuid.test(periodId)||!source||source.length>300||!/^[A-Z]{3}$/.test(currency)||!['',...RECONCILIATION_HISTORY_STATUSES].includes(status)
    ||!/^[1-9]\d*$/.test(rawPage)||!Number.isSafeInteger(page)||page>100000)return NextResponse.json({error:'Choose a valid year, period, source, currency, status and history page.'},{status:400,headers:{'Cache-Control':'no-store'}});
  const history=await listReconciliationHistory(auth.session.organisationId,{yearId,periodId,source,currency},status as ReconciliationHistoryStatus,page);
  return NextResponse.json({history},{headers:{'Cache-Control':'no-store'}});
}
