import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AdminAside from '@/components/admin/AdminAside';
import styles from './AdminLayout.module.css';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  return (
    <div className={styles.shell}>
      <AdminAside name={session.name} />
      <main className={styles.main}>
        {children}
      </main>
    </div>
  );
}
