// Ticket and booking links are bearer links: whoever holds the link can open
// the ticket. Shown wherever a link is the only credential.
export function BearerLinkNotice({ what = 'ticket' }: { what?: 'ticket' | 'booking' }) {
  return (
    <p data-testid="bearer-link-notice" role="note" className="mt-4 max-w-xl rounded-lg bg-eve-surface-alt p-3 text-sm text-eve-ink-soft">
      Anyone with this link can access {what === 'booking' ? 'these tickets' : 'this ticket'}. Keep it private.
    </p>
  );
}
