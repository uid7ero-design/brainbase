'use client';

import { useTheme } from '@/components/theme/ThemeProvider';
import styles from './public.module.css';

/**
 * Light/dark toggle for the public site. Uses the existing ThemeProvider
 * (bb-theme in localStorage, applied before paint by the layout's init
 * script), so persistence and no-flash behaviour are unchanged. The icon
 * is chosen by CSS from <html data-theme>, so it is correct on first paint
 * even before ThemeProvider has read storage.
 */
export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={styles.iconButton}
      onClick={toggleTheme}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {/* Moon — shown in dark theme */}
      <svg
        className={styles.onlyDark}
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M13.2 9.6A5.6 5.6 0 0 1 6.4 2.8a5.6 5.6 0 1 0 6.8 6.8Z" />
      </svg>
      {/* Sun — shown in light theme */}
      <svg
        className={styles.onlyLight}
        viewBox="0 0 16 16"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.3M8 13.2v1.3M1.5 8h1.3M13.2 8h1.3M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9" />
      </svg>
    </button>
  );
}
