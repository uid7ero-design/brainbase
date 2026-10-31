import type { Metadata } from 'next';
import { Container, PageIntro } from '@/components/ui/primitives';
import { SignInForm } from '@/components/auth/SignInForm';
import { EVE_NOT_ENABLED_MESSAGE } from '@/lib/organiserAuth';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ reason?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { reason } = await searchParams;
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Account" title="Sign in" lede="Organiser sign-in for events you manage." />
      <div className="mt-10">
        {reason === 'not-enabled' ? (
          <p role="status" className="mb-4 max-w-md rounded-lg bg-eve-surface-alt p-3 text-sm">{EVE_NOT_ENABLED_MESSAGE}</p>
        ) : null}
        <SignInForm sessionEnded={reason === 'session'} />
      </div>
    </Container>
  );
}
