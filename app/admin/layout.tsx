import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import AdminAside from '@/components/admin/AdminAside';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#07080B', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb' }}>
      <AdminAside name={session.name} />
      <main style={{ flex: 1, padding: '40px 40px', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}
