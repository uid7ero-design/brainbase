'use client';
import { useEffect } from 'react';

// Focus behaviour for the legacy /dashboard fallback overlays (Inbox,
// Contacts, Integrations, Memory, News, Brain graph) — remaining visual
// islands pass. Mirrors the shared useDialogFocus (components/ui/app) for
// initial focus, Tab containment and focus return, but deliberately does
// NOT own Escape: Escape behaviour stays exactly as it was before this pass.
// Contacts and Inbox keep their staged window-level Escape; Integrations,
// Memory and the Brain graph keep their own close-on-Escape; News and
// Activity never had one. BrainBase's separate window-level Escape only
// closes the chat. The shared useDialogFocus calls onClose and stops Escape
// propagation, which would change that, so it is not used here.
// If the focused control unmounts (async status swaps, view switches),
// focus is re-homed to the panel itself so Tab cannot leave the overlay.

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useOverlayFocus(open, panelRef) {
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    const body = panel?.querySelector('[data-dialog-body]');
    // An overlay may nominate its initial focus (e.g. Memory's selected tab,
    // so focus never lands on a destructive control); otherwise the first
    // control in the body, otherwise the panel itself.
    const first = panel?.querySelector('[data-initial-focus]') ?? body?.querySelector(FOCUSABLE);
    (first ?? panel)?.focus();

    function onKeyDown(e) {
      if (e.key !== 'Tab' || !panel) return;
      // A stacked overlay (Contacts opened from Inbox) owns its own Tab loop.
      const active = document.activeElement;
      if (active && active !== document.body && !panel.contains(active)) return;
      const items = Array.from(panel.querySelectorAll(FOCUSABLE));
      if (items.length === 0) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      // Focus fell out of the panel (e.g. to <body> after a control unmounted):
      // bring it back rather than letting Tab walk the page behind the overlay.
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? lastItem : firstItem).focus();
        return;
      }
      if (e.shiftKey && (document.activeElement === firstItem || document.activeElement === panel)) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    }

    // Re-home focus when the focused control inside the panel is removed.
    let focusWasInside = !!panel && panel.contains(document.activeElement);
    const onFocusIn = () => { focusWasInside = true; };
    const onFocusOut = (e) => { if (e.relatedTarget && !panel.contains(e.relatedTarget)) focusWasInside = false; };
    panel?.addEventListener('focusin', onFocusIn);
    panel?.addEventListener('focusout', onFocusOut);
    const observer = typeof MutationObserver !== 'undefined' && panel
      ? new MutationObserver(() => {
          const a = document.activeElement;
          if (focusWasInside && (!a || a === document.body) && panel.isConnected) panel.focus();
        })
      : null;
    observer?.observe(panel, { childList: true, subtree: true });

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      observer?.disconnect();
      panel?.removeEventListener('focusin', onFocusIn);
      panel?.removeEventListener('focusout', onFocusOut);
      if (opener && opener.isConnected) opener.focus();
    };
  }, [open, panelRef]);
}
