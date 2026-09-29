import { redirect } from 'next/navigation';
import { getAssurancePageAccess } from '@/lib/assurance/authorize';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import AssuranceSidebar from './_components/AssuranceSidebar';
import { AccessMessage } from './_components/ui';
import styles from './_components/assurance.module.css';

// BrainBase Assurance shell — same shape as app/commercial/layout.tsx
// (shared ModuleSidebar beside the page; the sidebar becomes a strip
// above the page on narrow screens). This gate is UX (shell vs. "not
// enabled" message). Each page re-checks access itself (see
// _components/pageAccess.tsx) and every API route uses
// authorizeAssuranceRequest(); neither relies on this layout.
export default async function AssuranceLayout({ children }: { children: React.ReactNode }) {
  const access = await getAssurancePageAccess();
  if (access.status === 'unauthenticated') redirect('/login');

  const shellHeight = { ['--shell-min-height' as string]: APP_HEADER_OFFSET_VH_CALC };

  if (access.status !== 'ok') {
    return (
      <div className={`${styles.shell} ${styles.centered}`} style={shellHeight}>
        <AccessMessage status={access.status} />
      </div>
    );
  }

  return (
    <div className={styles.shell} style={shellHeight}>
      <AssuranceSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
