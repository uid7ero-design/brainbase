import 'server-only';
import { escHtml } from '@/lib/email';
import { displayWebsite, organiserReference, publicOrganiserContact } from '@ticketing/core/publicOrganiser';
import type { EveOrganiserContact } from '@/lib/organisations/branding';

// The organiser contact line in Eve buyer emails (ticket + lifecycle). Built
// only from the organiser's public display name and the public contact
// (publicEmail + website) — re-checked here through the same allowlist, so a
// hand-built or stale value cannot add anything else. No contact => no line
// (null); Eve support stays in the email footer, separately.
//
//   Questions about this event? Contact Riverlights Festival: hello@riverlights.example · riverlights.example

export type EveOrganiserContactLine = { html: string; text: string };

export function eveOrganiserContactLine(
  organiserDisplayName: string | null | undefined,
  contact: EveOrganiserContact | null | undefined,
): EveOrganiserContactLine | null {
  const safe = publicOrganiserContact({ publicEmail: contact?.email, website: contact?.website });
  if (!safe) return null;
  const organiser = organiserReference(organiserDisplayName);

  const htmlParts: string[] = [];
  const textParts: string[] = [];
  if (safe.email) {
    htmlParts.push(`<a href="mailto:${escHtml(safe.email)}" style="color:#555">${escHtml(safe.email)}</a>`);
    textParts.push(safe.email);
  }
  if (safe.website) {
    htmlParts.push(`<a href="${escHtml(safe.website)}" style="color:#555">${escHtml(displayWebsite(safe.website))}</a>`);
    textParts.push(safe.website);
  }

  return {
    html: `
      <p data-organiser-contact style="margin:24px 0 0;font-size:13px;color:#555;line-height:1.6">
        Questions about this event? Contact <strong>${escHtml(organiser)}</strong>: ${htmlParts.join(' · ')}
      </p>`,
    text: `Questions about this event? Contact ${organiser}: ${textParts.join(' · ')}`,
  };
}
