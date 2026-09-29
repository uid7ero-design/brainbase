import 'server-only';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getAssurancePageAccess, type AssuranceViewer } from '@/lib/assurance/authorize';
import { AccessMessage } from './ui';

// Every Assurance page calls this itself. The layout's gate is UX only:
// App Router pages can be rendered/fetched independently of their layout,
// so a page must never rely on its layout for authorization.
export async function resolvePageViewer(): Promise<{ viewer: AssuranceViewer; denied: null } | { viewer: null; denied: ReactNode }> {
  const access = await getAssurancePageAccess();
  if (access.status === 'unauthenticated') redirect('/login');
  if (access.status !== 'ok') return { viewer: null, denied: <AccessMessage status={access.status} /> };
  return { viewer: access.viewer, denied: null };
}
