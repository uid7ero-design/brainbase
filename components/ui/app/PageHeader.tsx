import type { ReactNode } from 'react';
import styles from './PageHeader.module.css';

// Authenticated-app page header (Phase C). Typography and spacing only —
// no card, no border, no background — so a page reads as one surface with
// a clear title rather than a stack of boxes. It owns no behaviour: every
// slot is caller-rendered, and actions keep their own handlers and gating.
//
//   <PageHeader
//     title="Companies"
//     description="42 total"
//     actions={<Button variant="primary" onClick={…}>Add company</Button>}
//   />
//
// Slots:
//   eyebrow     — context above the title (e.g. a back link or module name)
//   title       — the page's single h1 (level adjustable for nested views)
//   meta        — inline status/metadata beside the title (e.g. a Badge)
//   description — one line of supporting copy or a count
//   actions     — primary/secondary actions; wraps below the title on
//                 narrow screens instead of overflowing

export type PageHeaderProps = {
  title: ReactNode;
  eyebrow?: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Heading level for the title (default h1). */
  titleAs?: 'h1' | 'h2';
  className?: string;
};

export function PageHeader({ title, eyebrow, description, meta, actions, titleAs: Heading = 'h1', className }: PageHeaderProps) {
  return (
    <header className={[styles.header, className ?? ''].join(' ').trim()}>
      <div className={styles.text}>
        {eyebrow && <div className={styles.eyebrow}>{eyebrow}</div>}
        <div className={styles.titleRow}>
          <Heading className={styles.title}>{title}</Heading>
          {meta && <div className={styles.meta}>{meta}</div>}
        </div>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </header>
  );
}
