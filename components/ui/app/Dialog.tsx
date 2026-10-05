'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';
import styles from './Dialog.module.css';

// Shared centred dialog (Phase D1) for short confirm / edit forms — the
// centred counterpart of SlidePanel, with the same close model and focus
// behaviour (useDialogFocus). Mounted only while open; the scrim and the
// close button call onClose; children own any form and its submission.

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Max width in px (default 440). */
  width?: number;
};

export function Dialog({ open, onClose, title, children, width = 440 }: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogFocus(open, onClose, panelRef);

  if (!open) return null;

  return (
    <div className={styles.root}>
      <div className={styles.scrim} onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className={styles.panel}
        style={{ maxWidth: width }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className={styles.header}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={onClose} aria-label={`Close ${title}`}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true" focusable="false">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        <div className={styles.body} data-dialog-body="">
          {children}
        </div>
      </div>
    </div>
  );
}
