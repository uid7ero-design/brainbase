// Public event branding — generic theming layer.
//
// Resolves a presentation theme for the public event surfaces
// (app/e/[organisationSlug]/**) purely from the organisationSlug that is
// already present in every one of those routes/components — no schema
// change, no new query, no organisationId ever crosses into this module.
// Deliberately NOT `server-only`: every consumer is a 'use client'
// component (PublicEventClient, PublicEventsHubClient, the checkout
// success page), so this stays a plain, synchronous, isomorphic module —
// a static registry lookup, nothing more.
//
// `variant` (not `id`) is what every consumer actually branches on for
// rendering strategy, so a second institutional-style client later is
// just one more registry entry with variant: 'institutional' and its own
// tokens/brand — zero new conditionals anywhere else in the codebase.
// `id` exists only for registry lookup / debugging and is never used for
// visual branching itself.

export type PublicEventThemeVariant = 'default' | 'institutional';

export type PublicEventThemeTokens = {
  // Solid page background. Both themes stay dark — see this file's own
  // design note below for why a literal light re-skin was rejected.
  bg: string;
  // Same colour as `bg`, pre-composed as a translucent rgba() string for
  // the sticky header's backdrop-blur overlay — a plain rgba string
  // (not CSS `color-mix()`, which older Safari/Chrome don't support) so
  // this public page degrades gracefully everywhere.
  bgTranslucent: string;
  border: string;
  borderSoft: string;
  // Solid accent colours (icons, links, focus rings, badges).
  accent: string;
  accentSoft: string;
  // Comma-separated "r,g,b" triplet for the SAME colour as `accent`,
  // for the handful of rgba(var(--x-accent-rgb), alpha) glow/hover
  // treatments in the shared public-event CSS block that need an alpha
  // channel CSS custom properties alone can't express.
  accentRgb: string;
  // Full CSS gradient string for the primary call-to-action button.
  accentGradient: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Semantic, not brand — identical across every theme on purpose (a
  // "sold out" or "payment failed" state should never change colour
  // just because the organisation's brand accent does).
  green: string;
  red: string;
  // Institutional variant only: the serif stack used for the school
  // wordmark/hero heading, giving it a distinct "not-app-like" register
  // from the rest of the page's Inter sans-serif. Undefined for the
  // default theme, which has no such heading treatment.
  headingFontFamily?: string;
};

export type PublicEventBrand = {
  name: string;
  shortName: string;
  tagline?: string;
  // "Visit website" / "Back to website" link target. Genuinely optional
  // — omit it rather than invent a URL that doesn't belong to the
  // organisation. See school-test-organisation's own entry below.
  websiteUrl?: string;
};

export type PublicEventTheme = {
  id: string;
  variant: PublicEventThemeVariant;
  tokens: PublicEventThemeTokens;
  brand: PublicEventBrand;
  // Pre-built for direct use as a React inline `style` object spread on
  // the page's root element — every consumer's own local BG/BORDER/etc.
  // constants are themselves just the matching `var(--bbpe-*)` strings,
  // so setting these once at the root re-themes the entire subtree with
  // no further prop-threading into any sub-component.
  cssVars: Record<string, string>;
};

const DEFAULT_TOKENS: PublicEventThemeTokens = {
  bg: '#07080B',
  bgTranslucent: 'rgba(7,8,11,.86)',
  border: 'rgba(255,255,255,.08)',
  borderSoft: 'rgba(255,255,255,.06)',
  accent: '#8A4DFF',
  accentSoft: '#A78BFA',
  accentRgb: '138,77,255',
  accentGradient: 'linear-gradient(100deg,#6A3DFF 0%,#8A4DFF 55%,#5677FF 100%)',
  textPrimary: '#F5F7FA',
  textSecondary: 'rgba(226,232,240,.66)',
  textMuted: 'rgba(226,232,240,.42)',
  green: '#4ADE80',
  red: '#F87171',
};

// School Test Organisation — a GENERIC, SYNTHETIC institutional theme.
// Colour family only loosely inspired by "deep navy + burgundy + gold"
// private-school branding conventions in general — no specific
// institution's palette, crest, wordmark, or copy is reproduced anywhere
// in this file or its consuming components. See
// components/publicEvents/InstitutionalChrome.tsx for the generic
// shield-mark treatment.
//
// Deliberately still a DARK theme, not a literal light "school website"
// re-skin: PublicEventClient/PublicEventsHubClient/the checkout success
// page all use dozens of raw `rgba(255,255,255,.0N)` translucent-panel
// literals directly in JSX (never routed through the shared colour
// consts), which read correctly as "frosted glass" on any dark base but
// would invert to near-invisible on a light one. Re-deriving every one
// of those literals for a true light theme is a much larger, riskier
// diff than this task's "smallest clean" instruction calls for. A deep
// navy base with gold/burgundy accents and a serif heading treatment
// already reads as premium and institutional (the same register real
// private-school/members'-club sites often use) without touching a
// single one of those existing literals.
const SCHOOL_TEST_TOKENS: PublicEventThemeTokens = {
  bg: '#0A0E1A',
  bgTranslucent: 'rgba(10,14,26,.88)',
  border: 'rgba(201,162,39,.18)',
  borderSoft: 'rgba(201,162,39,.10)',
  accent: '#C9A227',
  accentSoft: '#E3C468',
  accentRgb: '201,162,39',
  accentGradient: 'linear-gradient(100deg,#6E1F28 0%,#8C2F39 55%,#7A2530 100%)',
  textPrimary: '#F3EFE6',
  textSecondary: 'rgba(243,239,230,.68)',
  textMuted: 'rgba(243,239,230,.44)',
  green: '#4ADE80',
  red: '#F87171',
  headingFontFamily: 'Georgia, "Times New Roman", Times, serif',
};

function cssVarsFor(tokens: PublicEventThemeTokens): Record<string, string> {
  return {
    '--bbpe-bg': tokens.bg,
    '--bbpe-bg-translucent': tokens.bgTranslucent,
    '--bbpe-border': tokens.border,
    '--bbpe-border-soft': tokens.borderSoft,
    '--bbpe-accent': tokens.accent,
    '--bbpe-accent-soft': tokens.accentSoft,
    '--bbpe-accent-rgb': tokens.accentRgb,
    '--bbpe-accent-gradient': tokens.accentGradient,
    '--bbpe-text-primary': tokens.textPrimary,
    '--bbpe-text-secondary': tokens.textSecondary,
    '--bbpe-text-muted': tokens.textMuted,
    '--bbpe-green': tokens.green,
    '--bbpe-red': tokens.red,
    '--bbpe-heading-font': tokens.headingFontFamily ?? 'inherit',
  };
}

const DEFAULT_THEME: PublicEventTheme = {
  id: 'default',
  variant: 'default',
  tokens: DEFAULT_TOKENS,
  brand: { name: 'BrainBase', shortName: 'BB' },
  cssVars: cssVarsFor(DEFAULT_TOKENS),
};

// The registry itself. Adding a future client's own branded theme is
// exactly one more entry here — nothing else in this file, or in any
// consuming component, needs to change.
const PUBLIC_EVENT_THEMES: Record<string, PublicEventTheme> = {
  'school-test-organisation': {
    id: 'school-test-organisation',
    variant: 'institutional',
    tokens: SCHOOL_TEST_TOKENS,
    brand: {
      name: 'School Test Organisation',
      shortName: 'STO',
      tagline: 'Community & Events',
      // No real school-test-organisation.* domain exists — inventing one
      // here would be worse than omitting it. InstitutionalChrome only
      // renders a "Visit website" link when this is actually set, so a
      // future real client with a real domain gets the link for free.
    },
    cssVars: cssVarsFor(SCHOOL_TEST_TOKENS),
  },
};

export function resolvePublicEventTheme(organisationSlug: string): PublicEventTheme {
  return PUBLIC_EVENT_THEMES[organisationSlug] ?? DEFAULT_THEME;
}
