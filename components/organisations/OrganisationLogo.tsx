// Organisation logo — presentation only. Renders an organisation's
// configured branding.logoUrl (public-safe PublicOrganisationBranding,
// see lib/organisations/branding.ts) with a graceful no-logo fallback.
// No upload/delete logic, no Blob write logic, no network call beyond
// the plain <img> the browser itself makes — this component only ever
// reads props, matching this codebase's own presentation-component
// convention (see components/events/TicketCard.tsx).
//
// Deliberately UNUSED by any page as of this PR (Phase 3A scope) — see
// tests/containment/organisationBrandingConsumerFoundation.test.ts's
// own "not yet imported by any live page" assertion.
//
// contain, never cover — matches the existing, correct precedent
// TicketCard.tsx already set for event artwork (objectFit: 'contain'):
// an organisation logo must preserve its full aspect ratio, never be
// cropped. A light/neutral backing plate sits behind the image because
// uploaded logos are frequently transparent-background PNGs/WebPs — an
// unconstrained transparent logo dropped directly onto this app's own
// dark surfaces would often be unreadable.
//
// logoUrl is validated http(s)-only at write time (lib/organisations/
// branding.ts's normalizeUrl) but is NOT assumed to be Vercel-Blob-
// hosted — branding.logoUrl accepts any http(s) URL by design (see
// isManagedLogoUrl's own comment in lib/organisations/brandingStorage.ts
// for why). A plain <img> is used rather than next/image, since
// next/image's remote-pattern allowlist would need to cover arbitrary
// external hosts, a separate decision this component does not make.

import type { CSSProperties } from 'react';
import type { PublicOrganisationBranding } from '@/lib/organisations/branding';

export type OrganisationLogoProps = {
  branding: PublicOrganisationBranding | null;
  organisationName: string;
  size?: number;
};

const DEFAULT_SIZE = 48;

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]?.[0] ?? '';
  const second = words.length > 1 ? words[1]?.[0] ?? '' : '';
  return (first + second).toUpperCase() || '?';
}

export function OrganisationLogo({ branding, organisationName, size = DEFAULT_SIZE }: OrganisationLogoProps) {
  const logoUrl = branding?.logoUrl ?? null;
  const displayName = branding?.name ?? organisationName;

  const plateStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: 10,
    background: '#F5F7FA',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    flexShrink: 0,
  };

  if (!logoUrl) {
    return (
      <div style={plateStyle} aria-hidden="true">
        <span style={{ fontSize: Math.max(10, Math.round(size * 0.36)), fontWeight: 700, letterSpacing: '.02em', color: '#4B5563' }}>
          {initials(displayName)}
        </span>
      </div>
    );
  }

  return (
    <div style={plateStyle}>
      {/* eslint-disable-next-line @next/next/no-img-element -- plain <img>: arbitrary external http(s) host, not assumed Blob-hosted (see file header) */}
      <img
        src={logoUrl}
        alt={displayName}
        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
      />
    </div>
  );
}
