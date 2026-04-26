import { getSession } from '@/lib/session';
import { redirect } from 'next/navigation';

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect('/login');

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 52px)', background: '#07080B', fontFamily: 'var(--font-inter), Inter, sans-serif', color: '#f9fafb' }}>
      <aside style={{ width: 200, borderRight: '1px solid #1a1d24', padding: '28px 0', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 52, height: 'calc(100vh - 52px)' }}>
        <div style={{ padding: '0 20px 20px', fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          CRM
        </div>
        <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
          <a href="/crm"            style={navLink}>Dashboard</a>
          <a href="/crm/companies"  style={navLink}>Companies</a>
          <a href="/crm/contacts"   style={navLink}>Contacts</a>
          <a href="/crm/deals"      style={navLink}>Pipeline</a>
          <a href="/crm/activities" style={navLink}>Activities</a>
        </nav>
      </aside>
      <main style={{ flex: 1, overflow: 'auto', padding: '36px 40px' }}>
        {children}
      </main>
    </div>
  );
}

const navLink: React.CSSProperties = {
  display: 'block', padding: '8px 12px', color: '#9ca3af',
  fontSize: 14, textDecoration: 'none', borderRadius: 7,
};
