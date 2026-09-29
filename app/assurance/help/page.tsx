import Link from 'next/link';
import { Panel, StateMessage } from '@/components/ui/app';
import { HELP_ENTRIES, helpHref, type HelpGroup } from '@/lib/assurance/help/registry';
import { helpQueryTerms, MAX_QUERY_LENGTH } from '@/lib/assurance/help/search';
import { helpSummary, loadAllHelpDocs, searchAssuranceHelp } from '@/lib/assurance/help/content';
import { resolvePageViewer } from '../_components/pageAccess';
import { Breadcrumbs, FilterBar, PageHeader, Section, assuranceStyles as styles } from '../_components/ui';

export const dynamic = 'force-dynamic';

const GROUPS: { group: HelpGroup; title: string; id: string }[] = [
  { group: 'guide', title: 'Guides', id: 'guides' },
  { group: 'work-instruction', title: 'Work instructions', id: 'work-instructions' },
  { group: 'reference', title: 'Reference', id: 'reference' },
];

function firstParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

export default async function AssuranceHelpPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { viewer, denied } = await resolvePageViewer();
  if (!viewer) return denied;
  const q = firstParam((await searchParams).q).slice(0, MAX_QUERY_LENGTH);
  const searching = helpQueryTerms(q).length > 0;
  const results = searching ? searchAssuranceHelp(q) : [];
  const docs = loadAllHelpDocs();
  const bySlug = new Map(docs.map(d => [d.entry.slug, d]));

  return (
    <div className={styles.page} style={{ maxWidth: 960 }}>
      <Breadcrumbs items={[{ href: '/assurance', label: 'Assurance' }, { label: 'Help' }]} />
      <PageHeader
        title="Help"
        subtitle="How Assurance works, and step-by-step work instructions for each task. This help describes what is implemented today."
      />

      <FilterBar
        resetHref="/assurance/help"
        count={searching ? `${results.length} result${results.length === 1 ? '' : 's'}` : undefined}
        fields={[{ kind: 'search', name: 'q', placeholder: 'Search help', value: q }]}
      />

      {q && !searching && (
        <div style={{ marginBottom: 20 }}>
          <Panel><StateMessage kind="empty" title="Enter at least one word of two or more letters to search." /></Panel>
        </div>
      )}

      {searching && (
        <Section title="Search results" count={results.length} id="results">
          {results.length === 0 ? (
            <Panel><StateMessage kind="empty" title={`No help matches “${q}”.`}>Try a different word, or browse the guides below.</StateMessage></Panel>
          ) : (
            <Panel padding="none">
              <ul className={styles.workList}>
                {results.map(r => (
                  <li key={`${r.slug}-${r.anchor ?? 'top'}`}>
                    <Link href={helpHref(r.slug, r.anchor ?? undefined)} className={styles.workLink}>
                      <div className={styles.workMain}>
                        <div className={styles.workTitle} style={{ whiteSpace: 'normal' }}>
                          {r.docTitle}{r.heading ? ` › ${r.heading}` : ''}
                        </div>
                        <div className={styles.helpSnippet}>{r.snippet}</div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </Section>
      )}

      {GROUPS.map(g => {
        const entries = HELP_ENTRIES.filter(e => e.group === g.group && bySlug.has(e.slug));
        if (entries.length === 0) return null;
        return (
          <Section key={g.id} title={g.title} id={g.id}>
            <Panel padding="none">
              <ul className={styles.workList}>
                {entries.map(e => {
                  const d = bySlug.get(e.slug)!;
                  const summary = helpSummary(d);
                  return (
                    <li key={e.slug}>
                      <Link href={helpHref(e.slug)} className={styles.workLink}>
                        <div className={styles.workMain}>
                          <div className={styles.workTitle} style={{ whiteSpace: 'normal' }}>{d.doc.title ?? e.label}</div>
                          {summary && <div className={styles.helpSnippet}>{summary}</div>}
                          {e.audience && <div className={styles.workSub}>For {e.audience.toLowerCase()}</div>}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </Section>
        );
      })}
    </div>
  );
}
