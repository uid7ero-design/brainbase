import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { budgetSetupFailure,createSetupBudget,listSetupBudgets } from '@/lib/commercial/budgetSetup';
export async function GET() {
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);
  if(!auth.ok)return auth.response;
  return NextResponse.json({ versions:await listSetupBudgets(auth.session.organisationId) },{headers:{'Cache-Control':'no-store'}});
}
export async function POST(req:Request) {
  const auth=await authorizeCommercialRequest('budgeting',COMMERCIAL_MIN_ROLE.administer);
  if(!auth.ok)return auth.response;
  try { return NextResponse.json(await createSetupBudget(auth.session.organisationId,auth.session.userId,await req.json().catch(()=>null)),{status:201}); }
  catch(error){const failure=budgetSetupFailure(error);if(failure)return NextResponse.json({error:failure.message},{status:failure.status});throw error;}
}
