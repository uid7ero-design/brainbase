import type { Metadata } from 'next';
import { Container, PageIntro, Unavailable } from '@/components/ui/primitives';
import { product } from '@/config/product';

export const metadata: Metadata = { title: 'Sign in' };

// Deliberately no credential form. Sign-in for this product is Phase 2
// work (shared user directory, a session cookie scoped to this product's
// own domain); until then a form would either be fake or insecure.
export default function SignInPage() {
  return (
    <Container className="py-16 sm:py-20">
      <PageIntro eyebrow="Account" title="Sign in" lede="Organiser accounts for this product are not open yet." />
      <div className="mt-10 max-w-xl">
        <Unavailable
          title="Sign-in is not available in early access"
          detail={`Accounts will use the shared organiser directory with a session issued for this product's own domain. If you are an existing organiser and need access now, contact ${product.supportEmail}.`}
        />
      </div>
    </Container>
  );
}
