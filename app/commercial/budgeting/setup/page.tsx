import { redirect } from 'next/navigation';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import FinanceSetup from './FinanceSetup';

export default async function FinanceSetupPage() {
  const auth = await authorizeCommercialRequest('budgeting', COMMERCIAL_MIN_ROLE.administer);
  if (!auth.ok) {
    if (auth.response.status === 401) redirect('/login');
    return <p role="alert">{auth.response.status === 503 ? 'Unable to verify budgeting access. Please try again.' : 'Budgeting administrator access is required to configure finance setup.'}</p>;
  }
  return <FinanceSetup />;
}
