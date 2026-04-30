import { redirect } from 'next/navigation';
import { getSession } from '@/lib/session';
import OnboardingWizard from './_components/OnboardingWizard';

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <OnboardingWizard
      organisationId={session.organisationId}
      userId={session.userId}
    />
  );
}
