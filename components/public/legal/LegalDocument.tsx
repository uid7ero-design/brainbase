import Link from 'next/link';
import type { ReactNode } from 'react';
import { PublicFooter } from '@/components/public/PublicFooter';
import publicStyles from '@/components/public/public.module.css';
import styles from './legal.module.css';

// Long-form legal document shell for /privacy and /terms: calm reading
// measure, mono metadata, an in-page contents list built from the
// document's existing numbered section headings. Copy lives in the pages.

/** Stable anchor id for a numbered section title, e.g. "1. About this policy" → "about-this-policy". */
export function legalSectionId(title: string): string {
  return title
    .replace(/^\d+\.\s*/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function Contents({ sections }: { sections: string[] }) {
  return (
    <ol className={styles.tocList}>
      {sections.map(title => (
        <li key={title}>
          <a href={`#${legalSectionId(title)}`} className={styles.tocLink}>
            {title}
          </a>
        </li>
      ))}
    </ol>
  );
}

export function LegalDocument({
  title,
  lastUpdated,
  sections,
  children,
}: {
  title: string;
  /** Rendered as "Last updated: {lastUpdated}". */
  lastUpdated: string;
  /** The document's section titles, in order — drives the contents list. */
  sections: string[];
  children: ReactNode;
}) {
  return (
    <main className={`bb-public ${publicStyles.page}`}>
      <div className={styles.shell}>
        <Link href="/" className={styles.back}>
          ← Back to BrainBase
        </Link>

        <header className={styles.header}>
          <h1 className={styles.title}>{title}</h1>
          <p className={styles.updated}>Last updated: {lastUpdated}</p>
        </header>

        <div className={styles.layout}>
          <aside className={styles.aside}>
            <nav aria-label="On this page" className={styles.tocDesktop}>
              <p className={`bb-eyebrow ${styles.tocHeading}`}>On this page</p>
              <Contents sections={sections} />
            </nav>
          </aside>

          <div className={styles.body}>
            <details className={styles.tocMobile}>
              <summary className={styles.tocSummary}>On this page</summary>
              <Contents sections={sections} />
            </details>

            <article className={styles.article}>{children}</article>
          </div>
        </div>
      </div>

      <PublicFooter />
    </main>
  );
}

export function LegalSection({ title, children }: { title: string; children: ReactNode }) {
  const id = legalSectionId(title);
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className={styles.section}>
      <h2 id={`${id}-heading`} className={styles.sectionTitle}>
        {title}
      </h2>
      <div className={styles.prose}>{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className={styles.list}>
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}

/** In-prose link (internal or mailto) styled from the accent token. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className={styles.link}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={styles.link}>
      {children}
    </a>
  );
}
