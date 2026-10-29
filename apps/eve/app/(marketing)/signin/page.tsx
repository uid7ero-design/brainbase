import type { Metadata } from 'next';
import { Container, PageIntro } from '@/components/ui/primitives';
import { SignInForm } from '@/components/auth/SignInForm';

export const metadata: Metadata = { title: 'Sign in' };

type Props = { searchParams: Promise<{ reason?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { reason } = await searchParams;
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Account" title="Sign in" lede="Organiser sign-in for events you manage." />
      <div className="mt-10">
        <SignInForm sessionEnded={reason === 'session'} />
      </div>
    </Container>
  );
}
