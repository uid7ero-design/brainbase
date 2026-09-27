'use client';

import { useId, useRef, type ReactNode } from 'react';
import { useDialogFocus } from './useDialogFocus';
import styles from './SlidePanel.module.css';

// Shared authenticated slide panel (Phase C). CRM, People and Commercial
// each had a byte-identical private copy of this shell (same API, same
// scrim-click / × close, same inline mount, same 440px width); they now
// re-export this one so the visual shell and its semantics live in one
// place. Behaviour kept exactly: `open` gates rendering, the scrim and the
// × button call `onClose`, children own any form and its submission.
//
// Added (accessibility, not behaviour change for pointer users):
//   - role="dialog", aria-modal, labelled by the title
//   - Escape calls onClose (same effect as the × button)
//   - focus moves into the panel on open, stays inside while open, and
//     returns to the element that opened it on close (useDialogFocus)
//   - a named, typed close button
//   - full width on narrow screens instead of overflowing

export type SlidePanelProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
};

export function SlidePanel({ open, onClose, title, children }: SlidePanelProps) {
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

export default SlidePanel;
