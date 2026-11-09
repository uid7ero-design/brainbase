import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageHeader } from '@/components/ui/app';
import { requireSession } from '@/lib/org';
import { visibleCapabilities } from '@/lib/organisationUsers/access';
import { resolveSchedulingPage } from '@/app/scheduling/_components/pageAccess';
import { getStaffBookingVisibility } from '@/lib/scheduling/staffBookingVisibility';
import CoachSchedules from './CoachSchedules';
import styles from './workspace.module.css';

export const dynamic = 'force-dynamic';

const tools = [
  { module: 'crm', label: 'Client contacts', href: '/crm/contacts' },
  { module: 'invoicing', label: 'Invoices', href: '/commercial/invoices' },
  { module: 'invoicing', label: 'Unpaid customer invoices', href: '/commercial/invoices/unpaid' },
  { module: 'purchasing', label: 'Receipt expenses', href: '/commercial/purchasing/receipt-expenses' },
];

export default async function CoachPage() {
  const { canManage, denied } = await resolveSchedulingPage();
  if (denied) return denied;
  const session = await requireSession().catch(() => null);
  if (!session) redirect('/login');
  const capabilities = await visibleCapabilities(session.organisationId, session.userId, session.role).catch(() => null);
  const links = tools.filter(tool => capabilities?.some(row => row.key === tool.module));
  return <main className={styles.page}>
    <PageHeader title="Coach" description="Group classes, one-to-one appointments and the business tools for your practice." />
    <nav aria-label="Coach tools" className={styles.controls}>
      <Link href="/coaching/calendar">Weekly class calendar</Link>
      {canManage && <Link href="/coaching/calendar?view=review">Weekly coaching review</Link>}
      {canManage && await getStaffBookingVisibility() && <Link href="/coaching/squads">Teams and squads</Link>}
    </nav>
    <div className={styles.columns}>
      <section className={styles.panel} aria-label="Coaching schedules">
        <CoachSchedules canManage={canManage} />
      </section>
      {capabilities === null ? <p role="alert">Access to client and finance tools could not be checked. Refresh to retry.</p> :
        links.length > 0 && <nav className={styles.panel} aria-label="Client and business tools">
          <h2>Client and business tools</h2>
          <ul>{links.map(link => <li key={link.href}><Link href={link.href}>{link.label}</Link></li>)}</ul>
        </nav>}
    </div>
  </main>;
}
