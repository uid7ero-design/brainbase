import 'server-only';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { getSchedulingPageAccess } from '@/lib/scheduling/pageAccess';
import { AccessMessage } from './AccessMessage';

// Every Scheduling page calls this itself. The layout's gate is UX only: App Router pages can be rendered or fetched independently
// of their layout, so a page must never rely on its layout for access. (The data on a page still comes from /api/scheduling/**,
// which authorises every request on its own.)
export async function resolveSchedulingPage(): Promise<{ canManage: boolean; denied: null; timezone: string | null } | { canManage: false; denied: ReactNode; timezone: null }> {
  const access = await getSchedulingPageAccess();
  if (access.status === 'unauthenticated') redirect('/login');
  if (access.status !== 'ok') return { canManage: false, denied: <AccessMessage status={access.status} />, timezone: null };
  return { canManage: access.canManage, denied: null, timezone: access.timezone };
}
