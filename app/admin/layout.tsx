import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';
import { logout } from '@/app/actions/auth';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') redirect('/');

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#07080B', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb' }}>
      <aside style={{ width: 220, borderRight: '1px solid #1a1d24', padding: '32px 0', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 0, height: '100vh' }}>
        <div style={{ padding: '0 20px 28px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Admin Panel</div>
          <div style={{ fontSize: 13, color: '#6b7280' }}>{session.name}</div>
        </div>

        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          <a href="/admin/orgs" style={navLink}>Organisations</a>
          <a href="/admin/users" style={navLink}>Users</a>
        </nav>

        <div style={{ padding: '24px 20px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="/" style={{ color: '#6b7280', fontSize: 13, textDecoration: 'none' }}>← Back to app</a>
          <form action={logout}>
            <button type="submit" style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: 13, cursor: 'pointer', padding: 0, textAlign: 'left' }}>
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main style={{ flex: 1, padding: '40px 40px', overflow: 'auto' }}>
        {children}
      </main>
    </div>
  );
}

const navLink: React.CSSProperties = {
  display: 'block',
  padding: '8px 12px',
  color: '#9ca3af',
  fontSize: 14,
  textDecoration: 'none',
  borderRadius: 7,
};
