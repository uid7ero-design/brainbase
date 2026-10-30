import type { ReactNode } from 'react';
import Link from 'next/link';
import { BrainbaseLockup } from '@/components/public/BrainbaseLockup';
import styles from './AuthShell.module.css';

type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className={`bb-public ${styles.page}`}>
      <section className={styles.shell} aria-label="BrainBase account access">
        <header className={styles.brand}>
          <BrainbaseLockup idPrefix="bb-auth-lockup" width={340} className={styles.lockup} title="BrainBase" />
          <p className={styles.poweredBy}>Powered by <strong>HLNA Labs</strong></p>
        </header>

        {children}
      </section>
    </main>
  );
}

export function AuthFooter({ prompt, href, linkText }: { prompt: string; href: string; linkText: string }) {
  return (
    <>
      <p className={styles.below}>
        {prompt}{' '}
        <Link href={href} className={styles.link}>{linkText}</Link>
      </p>
      <footer className={styles.legal}>
        <Link href="/terms">Terms</Link>
        <Link href="/privacy">Privacy</Link>
      </footer>
    </>
  );
}

export { styles as authStyles };
