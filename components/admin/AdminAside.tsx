'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '@/app/actions/auth';
import { APP_HEADER_OFFSET_VAR, APP_HEADER_OFFSET_VH_CALC } from '@/lib/layout/headerOffset';
import {
  ModuleNavSection,
  ModuleSidebar,
  moduleNavFooterItemClassName,
  moduleNavItemProps,
} from '@/components/ui/app';

const HIDDEN_ROUTES = ['/admin/founder'];

// Phase D1 — the shared module-nav contract (components/ui/app/ModuleNav):
// same active language as the global chrome, tokens only, aria-current on
// the current destination. Items, their order, their hrefs (plain <a> vs
// <Link>) and the startsWith active rule are unchanged.
export default function AdminAside({ name }: { name: string }) {
  const pathname = usePathname();
  if (HIDDEN_ROUTES.some(r => pathname.startsWith(r))) return null;

  const link = (href: string) => moduleNavItemProps(pathname.startsWith(href));

  return (
    <ModuleSidebar
      title="Admin Panel"
      subtitle={name}
      label="Admin sections"
      style={{ width: 220, position: 'sticky', top: APP_HEADER_OFFSET_VAR, height: APP_HEADER_OFFSET_VH_CALC }}
      footer={
        <>
          <a href="/" className={moduleNavFooterItemClassName}>← Back to app</a>
          <form action={logout}>
            <button type="submit" className={moduleNavFooterItemClassName} style={{ width: '100%' }}>
              Sign out
            </button>
          </form>
        </>
      }
    >
      <a href="/admin/founder"       {...link('/admin/founder')}>Founder OS</a>

      <ModuleNavSection>Web Systems</ModuleNavSection>
      <a href="/admin/web-services"  {...link('/admin/web-services')}>Lead Pipeline</a>
      <a href="/admin/deployments"   {...link('/admin/deployments')}>Deployments</a>

      <ModuleNavSection>Operations</ModuleNavSection>
      <a href="/admin/pipeline"      {...link('/admin/pipeline')}>Pipeline</a>
      <a href="/admin/sessions"      {...link('/admin/sessions')}>Planner</a>
      <Link href="/admin/implementations" {...link('/admin/implementations')}>Client Implementations</Link>

      <ModuleNavSection>Platform</ModuleNavSection>
      <a href="/admin/orgs"          {...link('/admin/orgs')}>Organisations</a>
      <a href="/admin/users"         {...link('/admin/users')}>Users</a>
      <Link href="/admin/client-events" {...link('/admin/client-events')}>Client Events</Link>
      <a href="/admin/agent-runs"    {...link('/admin/agent-runs')}>Agent Runs</a>
      <a href="/admin/agent-test"    {...link('/admin/agent-test')}>Agent Test</a>
    </ModuleSidebar>
  );
}
