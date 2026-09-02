'use client';

// Shared branded chrome for the "institutional" public-event theme
// variant (see lib/events/publicEventTheme.ts). Deliberately generic —
// nothing here references School Test Organisation, or any other
// specific organisation, by name; every visible string comes from the
// `theme.brand` config passed in by the caller. A future second
// institutional-style client reuses these exact components with its own
// theme entry, no new component needed.
//
// GenericCrestMark is an original, code-drawn geometric shield — not a
// copy, trace, or stylisation of any real institution's crest. It exists
// purely to give the header/footer an "academic/institutional" visual
// cue (per the design brief) without any real or implied third-party
// mark.

import type { PublicEventTheme } from '@/lib/events/publicEventTheme';

const FONT = 'var(--font-inter), "Inter", -apple-system, sans-serif';

export function GenericCrestMark({ shortName, size = 34 }: { shortName: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 44" aria-hidden="true" style={{ flex: 'none' }}>
      <path
        d="M20 1 L37 7 V21 C37 32 30 40 20 43 C10 40 3 32 3 21 V7 Z"
        fill="var(--bbpe-bg)"
        stroke="var(--bbpe-accent)"
        strokeWidth="1.4"
      />
      <path
        d="M20 5 L33 9.5 V21 C33 29.5 27.5 35.8 20 38.5 C12.5 35.8 7 29.5 7 21 V9.5 Z"
        fill="none"
        stroke="var(--bbpe-accent)"
        strokeWidth="0.6"
        opacity="0.55"
      />
      <circle cx="20" cy="17" r="4.2" fill="none" stroke="var(--bbpe-accent-soft)" strokeWidth="1.1" />
      <rect x="13" y="26" width="14" height="1.6" rx="0.8" fill="var(--bbpe-accent-soft)" />
      <text
        x="20" y="35" textAnchor="middle"
        fontFamily="Georgia, 'Times New Roman', serif" fontSize="7.5" fontWeight={700}
        fill="var(--bbpe-accent-soft)" letterSpacing="0.5"
      >
        {shortName}
      </text>
    </svg>
  );
}

export function InstitutionalHeader({ theme }: { theme: PublicEventTheme }) {
  return (
    <header
      style={{
        position: 'sticky', top: 0, zIndex: 50,
        background: 'var(--bbpe-bg-translucent)',
        backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        borderBottom: '1px solid var(--bbpe-border)',
      }}
    >
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '14px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <GenericCrestMark shortName={theme.brand.shortName} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--bbpe-heading-font)', fontSize: 16, fontWeight: 700,
              color: 'var(--bbpe-text-primary)', letterSpacing: '.01em', lineHeight: 1.15,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {theme.brand.name}
            </div>
            {theme.brand.tagline && (
              <div style={{ fontSize: 10.5, color: 'var(--bbpe-text-muted)', letterSpacing: '.06em', textTransform: 'uppercase' }}>
                {theme.brand.tagline}
              </div>
            )}
          </div>
        </div>

        {/* Deliberately no internal/admin/Events-manager navigation here
            — a public visitor never sees anything beyond this org's own
            identity and (optionally) a link back to its own site. */}
        {theme.brand.websiteUrl && (
          <a
            href={theme.brand.websiteUrl} target="_blank" rel="noopener noreferrer"
            style={{
              fontSize: 12.5, fontWeight: 600, color: 'var(--bbpe-accent-soft)', textDecoration: 'none',
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

// Takes no `theme` prop — every visual it needs is already reachable
// through the `--bbpe-*` CSS custom properties the page root sets from
// `theme.cssVars` (see lib/events/publicEventTheme.ts), so nothing here
// needs to re-derive colours from the theme object directly.
export function InstitutionalHero({
  eyebrow, title, subtitle,
}: { eyebrow: string; title: string; subtitle?: React.ReactNode }) {
  return (
    <div style={{
      position: 'relative', borderBottom: '1px solid var(--bbpe-border)',
      background: 'linear-gradient(180deg, rgba(var(--bbpe-accent-rgb),.10) 0%, transparent 55%) var(--bbpe-bg)',
    }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '40px 20px 34px' }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 700,
          letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--bbpe-accent-soft)', marginBottom: 12,
        }}>
          <span style={{ width: 22, height: 1, background: 'var(--bbpe-accent)', display: 'inline-block' }} aria-hidden="true" />
          {eyebrow}
        </div>
        <h1 style={{
          fontFamily: 'var(--bbpe-heading-font)', fontSize: 32, fontWeight: 700, letterSpacing: '-.01em',
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

export function InstitutionalFooter({ theme }: { theme: PublicEventTheme }) {
  return (
    <footer style={{ borderTop: '1px solid var(--bbpe-border)', marginTop: 48 }}>
      <div style={{
        maxWidth: 1080, margin: '0 auto', padding: '28px 20px',
        display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <GenericCrestMark shortName={theme.brand.shortName} size={24} />
          <span style={{ fontFamily: 'var(--bbpe-heading-font)', fontSize: 13, fontWeight: 600, color: 'var(--bbpe-text-secondary)' }}>
            {theme.brand.name}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {theme.brand.websiteUrl && (
            <a
              href={theme.brand.websiteUrl} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 12, color: 'var(--bbpe-accent-soft)', textDecoration: 'none', fontFamily: FONT }}
            >
              Visit website
            </a>
          )}
          <span style={{ fontSize: 10.5, color: 'var(--bbpe-text-muted)', fontFamily: FONT }}>
            Registrations powered by BrainBase
          </span>
        </div>
      </div>
    </footer>
  );
}
