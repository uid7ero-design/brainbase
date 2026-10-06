import { NextResponse } from 'next/server';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { activateBudgetVersion, BudgetActivationError } from '@/lib/commercial/budgetActivation';

type Ctx = { params: Promise<{ id: string; versionId: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) return auth.response;

  const { id, versionId } = await params;
  try {
    const version = await activateBudgetVersion({
      organisationId: auth.session.organisationId,
      userId: auth.session.userId,
      budgetId: id,
      budgetVersionId: versionId,
    });
    return NextResponse.json({ version });
  } catch (error) {
    if (error instanceof BudgetActivationError) {
      if (error.code === 'NOT_FOUND') {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 });
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    throw error;
  }
}
