import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { getLegalConfig } from '@/config/legal';
import { TERMS } from '@/content/legal';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  // Not indexed until the text is final.
  return { title: 'Terms', robots: getLegalConfig().isFinal ? undefined : { index: false, follow: false } };
}

export default function Page() {
  return <LegalDocument doc={TERMS} />;
}
