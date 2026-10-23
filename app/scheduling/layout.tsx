import { redirect } from 'next/navigation';
import { getSchedulingPageAccess } from '@/lib/scheduling/pageAccess';
import { APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import SchedulingSidebar from './_components/SchedulingSidebar';
import { AccessMessage } from './_components/AccessMessage';
import styles from './_components/scheduling.module.css';

// BrainBase Scheduling shell: the same shape as Assurance and Commercial (the shared module sidebar beside the page, which becomes
// a strip above it on narrow screens). This gate is UX only (dashboard shell vs a "not enabled" message). Each page re-checks access
// itself, and every number and control on a page comes from /api/scheduling/**, which authorises every request on its own.
export default async function SchedulingLayout({ children }: { children: React.ReactNode }) {
  const access = await getSchedulingPageAccess();
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
      <SchedulingSidebar />
      <main className={styles.main}>{children}</main>
    </div>
  );
}
