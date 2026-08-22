'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';

const HIDDEN_ROUTES = ['/admin/founder'];

export default function AdminAside({ name }: { name: string }) {
  const pathname = usePathname();
  if (HIDDEN_ROUTES.some(r => pathname.startsWith(r))) return null;

  const link = (href: string): React.CSSProperties => ({
    display: 'block',
    padding: '8px 12px',
    color: pathname.startsWith(href) ? '#e5e7eb' : '#9ca3af',
    fontSize: 14,
    textDecoration: 'none',
    borderRadius: 7,
    background: pathname.startsWith(href) ? 'rgba(255,255,255,0.06)' : 'transparent',
    fontWeight: pathname.startsWith(href) ? 600 : 400,
  });

  const section: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    color: '#374151',
    textTransform: 'uppercase',
    letterSpacing: '0.1em',
    padding: '16px 12px 4px',
  };

  return (
    <aside style={{ width: 220, borderRight: '1px solid #1a1d24', padding: '32px 0', display: 'flex', flexDirection: 'column', flexShrink: 0, position: 'sticky', top: 52, height: 'calc(100vh - 52px)' }}>
      <div style={{ padding: '0 20px 28px' }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#4b5563', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>Admin Panel</div>
        <div style={{ fontSize: 13, color: '#6b7280' }}>{name}</div>
      </div>

      <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1, padding: '0 8px', overflowY: 'auto' }}>
        <a href="/admin/founder"       style={link('/admin/founder')}>Founder OS</a>

        <div style={section}>Web Systems</div>
        <a href="/admin/web-services"  style={link('/admin/web-services')}>Lead Pipeline</a>
        <a href="/admin/deployments"   style={link('/admin/deployments')}>Deployments</a>

        <div style={section}>Operations</div>
        <a href="/admin/pipeline"      style={link('/admin/pipeline')}>Pipeline</a>
        <a href="/admin/sessions"      style={link('/admin/sessions')}>Planner</a>
        <Link href="/admin/implementations" style={link('/admin/implementations')}>Client Implementations</Link>

        <div style={section}>Platform</div>
        <a href="/admin/orgs"          style={link('/admin/orgs')}>Organisations</a>
        <a href="/admin/users"         style={link('/admin/users')}>Users</a>
        <a href="/admin/agent-runs"    style={link('/admin/agent-runs')}>Agent Runs</a>
        <a href="/admin/agent-test"    style={link('/admin/agent-test')}>Agent Test</a>
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
