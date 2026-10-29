import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { getLegalConfig } from '@/config/legal';
import { PRIVACY } from '@/content/legal';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Not indexed until the text is final.
  return { title: 'Privacy', robots: getLegalConfig().isFinal ? undefined : { index: false, follow: false } };
}

export default function Page() {
  return <LegalDocument doc={PRIVACY} />;
}
