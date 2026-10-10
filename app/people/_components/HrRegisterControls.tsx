import Link from 'next/link';
import { buttonProps } from '@/components/ui/app';

export const HR_PAGE_SIZE = 25;

export function HrOperationsNav({ current }: { current: string }) {
  return <nav aria-label="HR operational views" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
    {[
      ['/people', 'People'], ['/people/lifecycle', 'Lifecycle overview'],
      ['/people/lifecycle/tasks', 'Task queue'], ['/people/documents', 'Document assurance'],
    ].map(([href, label]) => <Link key={href} href={href} aria-current={href === current ? 'page' : undefined} {...buttonProps('secondary')}>{label}</Link>)}
  </nav>;
}

export function HrRegisterSearch({ value, onChange, label = 'Search people' }: { value: string; onChange: (value: string) => void; label?: string }) {
  return <label>{label}{' '}<input type="search" value={value} onChange={event => onChange(event.target.value)} /></label>;
}

export function HrRegisterPagination({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / HR_PAGE_SIZE));
  return <nav aria-label="Register pages" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
    <button type="button" {...buttonProps('secondary')} disabled={page <= 1} onClick={() => onChange(page - 1)}>Previous</button>
    <span role="status">Page {page} of {pages} · {total} matching rows</span>
    <button type="button" {...buttonProps('secondary')} disabled={page >= pages} onClick={() => onChange(page + 1)}>Next</button>
  </nav>;
}
