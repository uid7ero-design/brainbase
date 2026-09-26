import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './public.module.css';

function cx(...names: (string | false | null | undefined)[]) {
  return names.filter(Boolean).join(' ');
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx(styles.container, className)}>{children}</div>;
}

/** A page section: consistent vertical rhythm, optional anchor id. */
export function Section({
  id,
  labelledBy,
  children,
  className,
}: {
  id?: string;
  labelledBy?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cx(styles.section, className)}>
      <Container>{children}</Container>
    </section>
  );
}

/** Mono eyebrow (with optional "01" index), heading and supporting lede. */
export function SectionHeading({
  id,
  index,
  eyebrow,
  title,
  children,
}: {
  /** id for the heading, so a <Section labelledBy> can reference it. */
  id?: string;
  index?: string;
  eyebrow: string;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <p className={cx('bb-eyebrow', styles.eyebrowRow)}>
        {index && <span className={styles.eyebrowIndex}>{index}</span>}
        {index && <span className={styles.eyebrowRule} aria-hidden="true" />}
        <span>{eyebrow}</span>
      </p>
      <h2 id={id} className={styles.title}>
        {title}
      </h2>
      {children && <p className={styles.lede}>{children}</p>}
    </div>
  );
}

export function ArrowIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function ButtonLink({
  href,
  children,
  variant = 'primary',
  arrow = variant === 'primary',
}: {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
  arrow?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cx(styles.button, variant === 'primary' ? styles.buttonPrimary : styles.buttonSecondary)}
    >
      {children}
      {arrow && <ArrowIcon className={styles.buttonArrow} />}
    </Link>
  );
}

/** Understated underlined text link with an accent arrow. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={styles.textLink}>
      <span className={styles.textLinkLabel}>{children}</span>
      <ArrowIcon className={styles.buttonArrow} />
    </Link>
  );
}

/**
 * Bordered surface. With `title`, gets a browser/terminal-like header bar
 * (mono title, optional right-hand metadata).
 */
export function Panel({
  title,
  meta,
  children,
  className,
  bodyClassName,
  as: Tag = 'div',
}: {
  title?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  as?: 'div' | 'figure' | 'article';
}) {
  return (
    <Tag className={cx(styles.panel, className)}>
      {title && (
        <div className={styles.panelHeader}>
          <p className={styles.panelTitle}>
            <span className={styles.panelTicks} aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span>{title}</span>
          </p>
          {meta}
        </div>
      )}
      <div className={cx(styles.panelBody, bodyClassName)}>{children}</div>
    </Tag>
  );
}

export function Chip({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'accent' | 'signal' | 'ghost';
}) {
  return (
    <span
      className={cx(
        styles.chip,
        tone === 'accent' && styles.chipAccent,
        tone === 'signal' && styles.chipSignal,
        tone === 'ghost' && styles.chipGhost,
      )}
    >
      {children}
    </span>
  );
}
