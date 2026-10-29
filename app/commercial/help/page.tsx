import { redirect } from 'next/navigation';
import { authorizeCommercialRequest, COMMERCIAL_MIN_ROLE } from '@/lib/commercial/authorize';
import { checkCapability } from '@/lib/capabilities/requireCapability';
import { roleGte } from '@/lib/session';
import FinanceHelp from './FinanceHelp';

export default async function FinanceHelpPage() {
  const auth = await authorizeCommercialRequest(['purchasing', 'budgeting'], COMMERCIAL_MIN_ROLE.view);
  if (!auth.ok) {
    if (auth.response.status === 401) redirect('/login');
    return <p role="alert">{auth.response.status === 503
      ? 'Unable to verify finance help access. Please try again.'
      : 'Purchasing or Budgeting access is required to view finance help.'}</p>;
  }
  const [purchasing, budgeting] = await Promise.all([
    checkCapability(auth.session.organisationId, 'purchasing'),
    checkCapability(auth.session.organisationId, 'budgeting'),
  ]);
  return <FinanceHelp purchasing={purchasing.allowed} budgeting={budgeting.allowed}
    budgetingAdmin={budgeting.allowed && roleGte(auth.session.role, 'admin')} />;
}
