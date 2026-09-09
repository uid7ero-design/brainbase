'use client';

// Shared branded chrome for the "institutional" public-event theme
// variant (see lib/events/publicEventTheme.ts). Structural layout only
// — every piece of organisation IDENTITY (name/logo/website) comes from
// the caller's PublicOrganisationBranding + organisationName fallback
// (Phase 3B), never from the theme registry, which owns structural
// presentation only. A future second institutional-style client reuses
// these exact components with its own theme entry, no new component
// needed.

import { OrganisationLogo } from '@/components/organisations/OrganisationLogo';
import type { PublicOrganisationBranding } from '@/lib/organisations/branding';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

type IdentityProps = {
  branding: PublicOrganisationBranding | null;
  organisationName: string;
};

export function InstitutionalHeader({ branding, organisationName }: IdentityProps) {
  const displayName = branding?.name ?? organisationName;
  const website = branding?.website ?? null;

  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bbpe-band-bg-translucent)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--bbpe-band-border)',
      }}
    >
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '18px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <OrganisationLogo branding={branding} organisationName={organisationName} size={34} />
          <div style={{
            fontFamily: 'var(--bbpe-heading-font)', fontSize: 16, fontWeight: 700,
            color: 'var(--bbpe-band-text-primary)', letterSpacing: '.01em', lineHeight: 1.15,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {displayName}
          </div>
        </div>

        {/* Deliberately no internal/admin/Events-manager navigation here
            — a public visitor never sees anything beyond this org's own
            identity and (optionally) a link back to its own site. */}
        {website && (
          <a
            href={website} target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 12.5, fontWeight: 600, color: 'var(--bbpe-band-accent)', textDecoration: 'none',
              whiteSpace: 'nowrap', flex: 'none', fontFamily: FONT,
            }}
          >
            Visit website →
          </a>
        )}
      </div>
    </header>
  );
}

// Takes no identity props — every visual it needs is already reachable
// through the `--bbpe-*` CSS custom properties the page root sets from
// theme.cssVars (see lib/events/publicEventTheme.ts), so nothing here
// needs organisation identity or colours directly.
export function InstitutionalHero({
  eyebrow, title, subtitle,
}: { eyebrow: string; title: string; subtitle?: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative', borderBottom: '1px solid var(--bbpe-border)',
      background: 'linear-gradient(180deg, rgba(var(--bbpe-accent-rgb),.10) 0%, transparent 55%) var(--bbpe-bg)',
    }}>
      {/* clamp(), not a fixed value or a media query — scales the hero's
          vertical rhythm down on narrow viewports (roughly the 10-15%
          tighter mobile spacing asked for) while keeping the original
          desktop padding once the viewport is wide enough that `vw`
          exceeds it. */}
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: 'clamp(28px, 7vw, 40px) 20px clamp(24px, 6vw, 34px)' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700,
          letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--bbpe-accent-soft)', marginBottom: 12,
        }}>
          <span style={{ width: 22, height: 1, background: 'var(--bbpe-accent)', display: 'inline-block' }} aria-hidden="true" />
          {eyebrow}
        </div>
        {/* clamp() keeps the strong serif hierarchy at every width while
            stopping a long event name from consuming most of the first
            mobile viewport — 26px minimum still reads clearly larger
            than the 14-16px body/meta text around it. */}
        <h1 style={{
          fontFamily: 'var(--bbpe-heading-font)', fontSize: 'clamp(26px, 6.5vw, 32px)', fontWeight: 700, letterSpacing: '-.01em',
          lineHeight: 1.15, margin: subtitle ? '0 0 10px' : 0, color: 'var(--bbpe-text-primary)', maxWidth: 720,
        }}>
          {title}
        </h1>
        {subtitle && (
          <div style={{ fontSize: 14, color: 'var(--bbpe-text-secondary)' }}>{subtitle}</div>
        )}
      </div>
    </div>
  );
}

export function InstitutionalFooter({ branding, organisationName }: IdentityProps) {
  const displayName = branding?.name ?? organisationName;
  const website = branding?.website ?? null;

  return (
    <footer style={{ background: 'var(--bbpe-band-bg)', borderTop: '1px solid var(--bbpe-band-border)', marginTop: 48 }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '28px 20px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <OrganisationLogo branding={branding} organisationName={organisationName} size={24} />
          <span style={{ fontFamily: 'var(--bbpe-heading-font)', fontSize: 13, fontWeight: 600, color: 'var(--bbpe-band-text-primary)' }}>
            {displayName}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {website && (
            <a
              href={website} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--bbpe-band-accent)', textDecoration: 'none', fontFamily: FONT }}
            >
              Visit website
            </a>
          )}
          <span style={{ fontSize: 10.5, color: 'var(--bbpe-band-text-muted)', fontFamily: FONT }}>
            Registrations powered by BrainBase
          </span>
        </div>
      </div>
    </footer>
  );
}
