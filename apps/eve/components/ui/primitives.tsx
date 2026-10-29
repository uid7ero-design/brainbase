import Link from 'next/link';
import type { ReactNode } from 'react';

export function Container({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${className}`}>{children}</div>;
}

type ButtonProps = {
  href: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost';
  className?: string;
};

export function ButtonLink({ href, children, variant = 'primary', className = '' }: ButtonProps) {
  const base = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors';
  const look =
    variant === 'primary'
      ? 'bg-eve-ink text-white hover:bg-eve-ink-soft'
      : variant === 'secondary'
        ? 'bg-eve-accent text-white hover:bg-eve-accent-strong'
        : 'border border-eve-line bg-eve-surface text-eve-ink hover:bg-eve-surface-alt';
  return (
    <Link href={href} className={`${base} ${look} ${className}`}>
      {children}
    </Link>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-accent">{children}</p>;
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-[var(--radius-eve)] border border-eve-line bg-eve-surface p-6 shadow-[var(--shadow-eve)] ${className}`}>{children}</div>;
}

// Every surface whose backend is not yet connected says so plainly. This
// is the only way Phase 1 may represent missing functionality — never a
// sample row, never a placeholder number that looks live.
export function Unavailable({ title, detail, children }: { title: string; detail?: string; children?: ReactNode }) {
  return (
    <section
      role="status"
      aria-live="polite"
      data-eve-unavailable="true"
      className="rounded-[var(--radius-eve)] border border-dashed border-eve-line bg-eve-surface-alt p-6 text-eve-ink"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-eve-muted">Not yet available</p>
      <h2 className="mt-2 text-lg font-semibold">{title}</h2>
      {detail ? <p className="mt-2 max-w-prose text-sm text-eve-muted">{detail}</p> : null}
      {children}
    </section>
  );
}

export function PageIntro({ eyebrow, title, lede }: { eyebrow?: string; title: string; lede?: string }) {
  return (
    <header className="max-w-3xl">
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
      <h1 className="eve-display mt-3 text-4xl sm:text-5xl">{title}</h1>
      {lede ? <p className="mt-4 text-lg text-eve-muted">{lede}</p> : null}
    </header>
  );
}
