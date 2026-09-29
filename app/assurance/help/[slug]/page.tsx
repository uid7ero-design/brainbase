import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Panel, buttonProps } from '@/components/ui/app';
import { HELP_ENTRIES, helpHref } from '@/lib/assurance/help/registry';
import { loadHelpDoc } from '@/lib/assurance/help/content';
import { resolvePageViewer } from '../../_components/pageAccess';
import { Breadcrumbs, PageHeader, assuranceStyles as styles } from '../../_components/ui';
import { HelpMarkdown } from '../_components/HelpMarkdown';

export const dynamic = 'force-dynamic';

// The slug is only ever used as a key into the Help registry allow-list
// (lib/assurance/help/registry.ts). It is never turned into a file path.
export default async function AssuranceHelpDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const { slug } = await params;
  const loaded = loadHelpDoc(slug);
  if (!loaded) notFound();
  const { entry, doc } = loaded;

  const toc = doc.headings.filter(h => h.level === 2);
  const siblings = HELP_ENTRIES.filter(e => e.group === entry.group);
  const idx = siblings.findIndex(e => e.slug === entry.slug);
  const prev = entry.group === 'work-instruction' && idx > 0 ? siblings[idx - 1] : null;
  const next = entry.group === 'work-instruction' && idx < siblings.length - 1 ? siblings[idx + 1] : null;

  return (
    <div className={styles.page} style={{ maxWidth: 960 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { href: '/assurance/help', label: 'Help' }, { label: entry.label }]} />
      <PageHeader
        title={doc.title ?? entry.label}
        subtitle={entry.group === 'work-instruction' ? 'Work instruction' : entry.audience ? `For ${entry.audience.toLowerCase()}` : undefined}
        actions={<Link href="/assurance/help" {...buttonProps('ghost', 'sm')}>All help</Link>}
      />

      {toc.length >= 4 && (
        <nav aria-label="On this page" className={styles.helpToc}>
          <div className={styles.helpTocTitle}>On this page</div>
          <ul>
            {toc.map(h => <li key={h.id}><a href={`#${h.id}`}>{h.text}</a></li>)}
          </ul>
        </nav>
      )}

      <Panel>
        <HelpMarkdown blocks={doc.blocks} />
      </Panel>

      {(prev || next) && (
        <nav aria-label="Work instructions" className={styles.helpPager}>
          {prev ? <Link href={helpHref(prev.slug)} {...buttonProps('secondary', 'sm')}>← {prev.label}</Link> : <span />}
          {next ? <Link href={helpHref(next.slug)} {...buttonProps('secondary', 'sm')}>{next.label} →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
