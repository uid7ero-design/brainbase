import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { budgetSetupFailure,changeSetupBudget } from '@/lib/commercial/budgetSetup';
export async function POST(req:Request,context:{params:Promise<{id:string;versionId:string}>}) {
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);
  if(!auth.ok)return auth.response;
  const {id,versionId}=await context.params;
  try { const record=await changeSetupBudget(auth.session.organisationId,auth.session.userId,id,versionId,await req.json().catch(()=>null));return NextResponse.json({record}); }
  catch(error){const failure=budgetSetupFailure(error);if(failure)return NextResponse.json({error:failure.message},{status:failure.status});throw error;}
}
