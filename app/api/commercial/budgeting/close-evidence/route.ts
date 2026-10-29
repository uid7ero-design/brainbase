import { NextResponse } from 'next/server';
import { authorizeCommercialRequest,COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { getCloseEvidence } from '@/lib/commercial/financeCloseEvidence';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(request:Request){
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);if(!auth.ok)return auth.response;
  const query=new URL(request.url).searchParams,kind=query.get('kind'),id=query.get('id')??'',yearId=query.get('yearId')??'',periodId=query.get('periodId');
  if(!['year','period'].includes(kind??'')||!uuid.test(id)||!uuid.test(yearId)||(kind==='period'?!periodId||!uuid.test(periodId):periodId!==null))return NextResponse.json({error:'Choose a valid close record and calendar scope.'},{status:400,headers:{'Cache-Control':'no-store'}});
  const evidence=await getCloseEvidence(auth.session.organisationId,{kind:kind as 'year'|'period',yearId,periodId},id);
  return evidence?NextResponse.json({evidence},{headers:{'Cache-Control':'no-store'}}):NextResponse.json({error:'Close evidence was not found in this calendar scope.'},{status:404,headers:{'Cache-Control':'no-store'}});
}
