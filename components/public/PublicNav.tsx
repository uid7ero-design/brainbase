'use client';

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { TOP_NAV_HEIGHT_PX } from '@/lib/layout/headerOffset';
import { BrainbaseLockup } from './BrainbaseLockup';
import { ThemeToggle } from './ThemeToggle';
import { PUBLIC_NAV_LINKS, isActiveLink, isThemedPublicRoute } from './routes';
import styles from './PublicNav.module.css';

/**
 * Header for logged-out visitors (rendered by TopNav when there is no
 * session). Same destinations as before; restyled onto the --bb-* tokens,
 * with a theme toggle and a mobile menu.
 */
export function PublicNav({ pathname }: { pathname: string }) {
  const themed = isThemedPublicRoute(pathname);
  // The mobile menu is open for the pathname it was opened on, so any
  // navigation closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpenOn(null);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const links = PUBLIC_NAV_LINKS.map(link => {
    const active = isActiveLink(link, pathname);
    return (
      <li key={link.href}>
        <Link href={link.href} className={styles.link} aria-current={active ? 'page' : undefined}>
          {link.label}
        </Link>
      </li>
    );
  });

  return (
    <header className={`bb-public ${styles.header} ${themed ? '' : 'bb-scope-dark'}`}>
      <div className={styles.bar} style={{ height: TOP_NAV_HEIGHT_PX }}>
        <Link href="/" className={styles.home} aria-label="BrainBase home">
          <BrainbaseLockup idPrefix="bb-nav-lockup" width={150} title={null} />
        </Link>

        <nav aria-label="Primary" className={styles.desktopNav}>
          <ul className={styles.list}>{links}</ul>
        </nav>

        <div className={styles.actions}>
          <Link
            href="/login"
            className={`${styles.link} ${styles.loginDesktop}`}
            aria-current={pathname === '/login' ? 'page' : undefined}
          >
            Login
          </Link>
          <Link href="/request-demo" className={styles.cta}>
            Get Started
          </Link>
          {themed && <ThemeToggle />}
          <button
            ref={buttonRef}
            type="button"
            className={styles.menuButton}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(!open)}
          >
            <svg
              viewBox="0 0 16 16"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              {open ? <path d="m4 4 8 8M12 4l-8 8" /> : <path d="M2.5 5h11M2.5 11h11" />}
            </svg>
          </button>
        </div>
      </div>

      <nav id={menuId} aria-label="Menu" className={styles.mobileNav} hidden={!open}>
        <ul className={styles.mobileList}>
          {links}
          <li>
            <Link href="/login" className={styles.link} aria-current={pathname === '/login' ? 'page' : undefined}>
              Login
            </Link>
          </li>
        </ul>
      </nav>
    </header>
  );
}
