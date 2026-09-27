'use client';

import { useEffect, useRef, type RefObject } from 'react';

// Shared modal focus behaviour for SlidePanel and Dialog (Phase C/D1):
//   - on open, focus the first control in the body ([data-dialog-body]),
//     falling back to the panel itself
//   - Tab / Shift+Tab stay inside the panel while it is open
//   - Escape calls onClose (the same effect as the visible close button)
//   - on close, focus returns to the element that opened it

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogFocus(open: boolean, onClose: () => void, panelRef: RefObject<HTMLElement | null>) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const body = panel?.querySelector<HTMLElement>('[data-dialog-body]');
    const first = body?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        // A control inside the panel already consumed this Escape (e.g. an
        // inline editor cancelling, or an open listbox closing) — leave the
        // panel open. (Phase D3: Organiser's item drawer hosts both.)
        if (e.defaultPrevented) return;
        e.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === firstItem || document.activeElement === panel)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, panelRef]);
}
