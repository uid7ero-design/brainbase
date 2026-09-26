import type { ReactNode } from 'react';
import type { SemanticState } from './types';
import styles from './semantic.module.css';

// One distinct outline shape per state, so a state is identifiable without
// colour. Always decorative: the visible text beside it names the state,
// so the icon is hidden from assistive technology.

const PATHS: Record<SemanticState, ReactNode> = {
  success: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M5.25 8.25 7.1 10l3.65-4" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.1 14.4 13.4H1.6Z" />
      <path d="M8 6.4v3.1" />
      <path d="M8 11.5h.01" />
    </>
  ),
  error: (
    <>
      <path d="M5.4 1.75h5.2l3.65 3.65v5.2l-3.65 3.65H5.4L1.75 10.6V5.4Z" />
      <path d="m6 6 4 4M10 6l-4 4" />
    </>
  ),
  info: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.9" />
      <path d="M8 4.9h.01" />
    </>
  ),
  active: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <circle cx="8" cy="8" r="2.6" fill="currentColor" stroke="none" />
    </>
  ),
  inactive: (
    <>
      <circle cx="8" cy="8" r="6.25" strokeDasharray="2.4 2.2" />
      <path d="M5.5 8h5" />
    </>
  ),
  syncing: (
    <>
      <path d="M13.2 6.4A5.4 5.4 0 0 0 3.3 5.2" />
      <path d="M3.1 2.6v2.8h2.8" />
      <path d="M2.8 9.6a5.4 5.4 0 0 0 9.9 1.2" />
      <path d="M12.9 13.4v-2.8h-2.8" />
    </>
  ),
};

export function StateIcon({ state, className }: { state: SemanticState; className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-decorative="true"
      className={[styles.icon, state === 'syncing' ? styles.spin : '', className ?? ''].join(' ').trim()}
    >
      {PATHS[state]}
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-decorative="true"
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}
