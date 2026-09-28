import { redirect } from 'next/navigation';
import { getAssurancePageAccess } from '@/lib/assurance/authorize';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import AssuranceSidebar from './_components/AssuranceSidebar';
import { AccessMessage } from './_components/ui';

// BrainBase Assurance shell — same shape as app/commercial/layout.tsx.
// This gate is UX (shell vs. "not enabled" message). Each page re-checks
// access itself (see _components/pageAccess.tsx) and every API route uses
// authorizeAssuranceRequest(); neither relies on this layout.
export default async function AssuranceLayout({ children }: { children: React.ReactNode }) {
  const access = await getAssurancePageAccess();
  if (access.status === 'unauthenticated') redirect('/login');

  const shell = {
    minHeight: APP_HEADER_OFFSET_VH_CALC,
    background: 'var(--bg-base)',
    fontFamily: 'var(--font-inter), Inter, sans-serif',
    color: 'var(--text-primary)',
  } as const;

  if (access.status !== 'ok') {
    return <div style={shell}><AccessMessage status={access.status} /></div>;
  }

  return (
    <div style={{ ...shell, display: 'flex' }}>
      <AssuranceSidebar />
      <main style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: '32px 36px' }}>{children}</main>
    </div>
  );
}
