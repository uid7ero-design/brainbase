'use client';

import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

const HIDDEN_ROUTES = ['/admin/founder'];

const navLink: React.CSSProperties = {
  display: 'block',
  padding: '8px 12px',
  color: '#9ca3af',
  fontSize: 14,
  textDecoration: 'none',
  borderRadius: 7,
};

export default function AdminAside({ name }: { name: string }) {
  const pathname = usePathname();
  if (HIDDEN_ROUTES.some(r => pathname.startsWith(r))) return null;

  return (
    <aside style={{ width: 220, borderRight: '1px solid #1a1d24', padding: '32px 0', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 52, height: 'calc(100vh - 52px)' }}>
      <div style={{ padding: '0 20px 28px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Admin Panel</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{name}</div>
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '0 8px' }}>
        <a href="/admin/founder"    style={navLink}>Founder OS</a>
        <a href="/admin/orgs"       style={navLink}>Organisations</a>
        <a href="/admin/users"      style={navLink}>Users</a>
        <a href="/admin/agent-runs" style={navLink}>Agent Runs</a>
        <a href="/admin/agent-test" style={navLink}>Agent Test</a>
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
  );
}
