import type { Metadata } from 'next';
import { LegalDocument } from '@/components/legal/LegalDocument';
import { getLegalConfig } from '@/config/legal';
import { refundsDoc } from '@/content/legal';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  return { title: 'Refunds & cancellations', robots: getLegalConfig().isFinal ? undefined : { index: false, follow: false } };
}

export default function Page() {
  return <LegalDocument doc={refundsDoc()} />;
}
