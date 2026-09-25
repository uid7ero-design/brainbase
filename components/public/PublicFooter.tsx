import Link from 'next/link';
import { BrainbaseLockup } from './BrainbaseLockup';
import styles from './PublicFooter.module.css';

// Same links, tagline and copyright as the previous homepage footer, plus a
// deliberately quiet studio line.
const LINKS = [
  { href: '/client-operations', label: 'Client Operations' },
  { href: '/web-systems', label: 'Web Systems' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/demo', label: 'Demo' },
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
];

export function PublicFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.brand}>
          <BrainbaseLockup idPrefix="bb-footer-lockup" width={120} />
          <p className={styles.tagline}>One connected operational platform.</p>
        </div>

        <nav aria-label="Footer">
          <ul className={styles.links}>
            {LINKS.map(link => (
              <li key={link.href}>
                <Link href={link.href} className={styles.link}>
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className={styles.metaWrap}>
        <div className={styles.meta}>
          <span>© 2026 BrainBase</span>
          <span>A product from HLNA Labs</span>
        </div>
      </div>
    </footer>
  );
}
