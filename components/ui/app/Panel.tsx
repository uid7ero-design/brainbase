'use client';

import { useId, type ReactNode } from 'react';
import styles from './Panel.module.css';

// Authenticated-app surface (Phase A foundation): one bordered surface
// with an optional heading row. No shadow, no gradient, no glass — the
// hairline border defines the edge. With a title, the panel is a labelled
// section so it reads as a region in the page outline. The heading level
// is the caller's choice so the page keeps a correct hierarchy.

export type PanelProps = {
  title?: ReactNode;
  /** Heading level for the title (default h2). */
  titleAs?: 'h2' | 'h3' | 'h4';
  /** Right-aligned header content, e.g. a Button or a status Badge. */
  actions?: ReactNode;
  /** Body padding: 'md' (default) or 'none' for edge-to-edge tables. */
  padding?: 'md' | 'none';
  children: ReactNode;
  className?: string;
};

export function Panel({ title, titleAs: Heading = 'h2', actions, padding = 'md', children, className }: PanelProps) {
  const headingId = useId();
  const Tag = title ? 'section' : 'div';
  return (
    <Tag
      className={[styles.panel, className ?? ''].join(' ').trim()}
      aria-labelledby={title ? headingId : undefined}
    >
      {(title || actions) && (
        <div className={styles.header}>
          {title && (
            <Heading id={headingId} className={styles.title}>
              {title}
            </Heading>
          )}
          {actions && <div className={styles.actions}>{actions}</div>}
        </div>
      )}
      <div className={styles.body} data-padding={padding}>
        {children}
      </div>
    </Tag>
  );
}
