import { NextResponse } from 'next/server';
import { authorizeCommercialRequest,COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { listFinanceAdjustmentReview,getFinanceAdjustmentEvidence } from '@/lib/commercial/financeAdjustmentReview';
import type { AdjustmentScope,AdjustmentStatus } from '@/lib/commercial/financeAdjustmentReviewModel';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function GET(req:Request){
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);if(!auth.ok)return auth.response;
  const query=new URL(req.url).searchParams;
  const periodId=query.get('periodId')??'',currency=(query.get('currency')??'').trim().toUpperCase(),status=query.get('status')??'',id=query.get('id');
  const rawPage=query.get('page')??'1',page=Number(rawPage);
  if(!uuid.test(periodId)||!/^[A-Z]{3}$/.test(currency)||!['','DRAFT','POSTED','REVERSED'].includes(status)||!/^[1-9]\d*$/.test(rawPage)||!Number.isSafeInteger(page)||page>100000||(id!==null&&!uuid.test(id)))return NextResponse.json({error:'Choose a valid period, currency, status, page and adjustment.'},{status:400});
  const scope:AdjustmentScope={periodId,currency,status:status as ''|AdjustmentStatus};
  if(id!==null){const evidence=await getFinanceAdjustmentEvidence(auth.session.organisationId,scope,id);return evidence?NextResponse.json({evidence},{headers:{'Cache-Control':'no-store'}}):NextResponse.json({error:'Adjustment not found in this scope.'},{status:404,headers:{'Cache-Control':'no-store'}});}
  const report=await listFinanceAdjustmentReview(auth.session.organisationId,scope,page);return NextResponse.json({report},{headers:{'Cache-Control':'no-store'}});
}
