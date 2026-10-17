import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'Organiser', robots: { index: false, follow: false } };

export default function OrganiserLayout({ children }: { children: ReactNode }) {
  return children;
}
