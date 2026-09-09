// Public event STRUCTURAL presentation — generic theming layer.
//
// Resolves a purely structural presentation (layout variant + fixed
// token palette) for the public event surfaces (app/e/[organisationSlug]/**)
// from the organisationSlug that is already present in every one of
// those routes/components — no schema change, no new query, no
// organisationId ever crosses into this module. Deliberately NOT
// `server-only`: every consumer is a 'use client' component
// (PublicEventClient, PublicEventsHubClient, the checkout success page),
// so this stays a plain, synchronous, isomorphic module — a static
// registry lookup, nothing more.
//
// Phase 3B: this module NO LONGER owns any organisation identity
// (name/logo/website) — that is now sourced exclusively from
// lib/organisations/branding.ts's PublicOrganisationBranding, threaded
// through the public event/ticket/booking resolvers (Phase 3A) and the
// public events hub resolver (Phase 3B). This registry is now
// structural-only: which layout variant an organisation gets, and the
// fixed token palette that variant uses — including the FALLBACK accent
// values used when an organisation hasn't configured its own
// branding.accentColor (see applyAccentOverride below). There must be
// no code path anywhere that lets this registry assert a name, logo, or
// website belonging to any organisation — that would be exactly the
// duplicate/competing identity source this phase removes.
//
// `variant` (not `id`) is what every consumer actually branches on for
// rendering strategy, so a second institutional-style client later is
// just one more registry entry with variant: 'institutional' and its own
// structural tokens — zero new conditionals anywhere else in the
// codebase. `id` exists only for registry lookup / debugging and is
// never used for visual branching itself.

export type PublicEventThemeVariant = 'default' | 'institutional';

export type PublicEventThemeTokens = {
  // Solid page background — the dominant colour behind the hero and main
  // content. Light/off-white for the institutional variant (see the
  // design note on SCHOOL_TEST_TOKENS below); dark for the default
  // BrainBase presentation, unchanged from before this refinement pass.
  bg: string;
  // Same colour as `bg`, pre-composed as a translucent rgba() string —
  // only ever consumed by the default theme's own sticky EventHeader
  // (`.bb-event-header` in PublicEventClient.tsx); the institutional
  // header/footer use the separate `band*` tokens below instead. A
  // plain rgba string (not CSS `color-mix()`, which older Safari/Chrome
  // don't support) so this public page degrades gracefully everywhere.
  bgTranslucent: string;
  border: string;
  borderSoft: string;
  // Solid accent colours (icons, links, focus rings, selected-state
  // borders, badges) used against the main `bg`. Must stay legible on
  // `bg` — for the institutional theme this means a deep, AA-contrast
  // gold rather than the brighter decorative gold used on the dark
  // `band*` surfaces below.
  //
  // Phase 3B: `accent`/`accentSoft`/`accentRgb` here are FALLBACK values
  // only — the effective values an organisation actually sees are
  // computed by applyAccentOverride() below, which substitutes the
  // organisation's own branding.accentColor when configured. These
  // per-variant literals remain exactly as they were so an organisation
  // with no configured accent renders identically to before this phase.
  accent: string;
  accentSoft: string;
  // Comma-separated "r,g,b" triplet for the SAME colour as `accent`,
  // for the handful of rgba(var(--x-accent-rgb), alpha) glow/hover
  // treatments in the shared public-event CSS block that need an alpha
  // channel CSS custom properties alone can't express.
  accentRgb: string;
  // Full CSS gradient string for the primary call-to-action button.
  // Deliberately its own token, independent of `accent` — the CTA can
  // be a different hue (e.g. burgundy) from the icon/link accent (gold)
  // without needing a second full accent channel.
  accentGradient: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  // Semantic status colours (availability/sold-out, error states).
  // Independently themeable per variant — not because the *meaning*
  // changes, but because a colour tuned for legibility on a near-black
  // background (the default theme) can fail WCAG contrast on a light
  // one, and vice versa. Each theme picks its own AA-safe green/red;
  // DEFAULT_TOKENS keeps the original values unchanged.
  green: string;
  red: string;
  // Institutional variant only: the serif stack used for the school
  // wordmark/hero heading, giving it a distinct "not-app-like" register
  // from the rest of the page's Inter sans-serif. Undefined for the
  // default theme, which has no such heading treatment.
  headingFontFamily?: string;
  // "Band" surfaces — the header/footer chrome, which stay a dark
  // burgundy/navy band even when the main page (`bg`) is light, per the
  // "bright editorial page, dark bookend chrome" brief. For the default
  // theme these simply mirror the page's own existing tokens (default
  // has no separate band — EventHeader already uses `bg`/`bgTranslucent`
  // directly), so nothing changes there.
  bandBg: string;
  bandBgTranslucent: string;
  bandBorder: string;
  bandTextPrimary: string;
  bandTextMuted: string;
  // Brighter decorative gold for use ONLY on the dark band surfaces
  // (crest stroke, "Visit website" link, divider) — contrast against a
  // dark burgundy band is a different calculation from contrast against
  // the light `bg`, so this is deliberately not the same value as
  // `accent`.
  //
  // Phase 3B: deliberately NEVER overridden by branding.accentColor
  // (see applyAccentOverride's own comment for why) — an arbitrary
  // admin-chosen accent colour is not guaranteed to stay legible against
  // this FIXED dark band background, so this token always keeps its
  // per-variant literal value regardless of configured branding.
  bandAccent: string;
  // The handful of PublicEventClient/Hub/checkout-success panel
  // backgrounds that were literal `rgba(255,255,255,.0N)` translucent
  // overlays (never routed through a shared const) — a "frosted glass"
  // treatment that reads correctly against the default theme's near-
  // black `bg` but would be visually indistinguishable from a light
  // `bg` (a 2-3% white tint on off-white is imperceptible), leaving
  // primary panels with no visible surface at all. `cardBg` is for the
  // page's one or two "hero" panels per screen (the booking panel, the
  // confirmation/status card, each event card in the hub); `sectionBg`
  // is for secondary/nested surfaces inside those cards (detail rows,
  // ticket-link rows, the artwork frame). DEFAULT_TOKENS keeps these at
  // the exact original literal values, so the default theme's rendered
  // output is unchanged.
  cardBg: string;
  sectionBg: string;
  // Soft elevation shadow for the primary `cardBg` panels — 'none' for
  // the default theme (which never had a shadow), a subtle drop shadow
  // for the institutional theme's "cards ... subtle shadow/border" ask.
  cardShadow: string;
};

export type PublicEventTheme = {
  id: string;
  variant: PublicEventThemeVariant;
  tokens: PublicEventThemeTokens;
  // Pre-built for direct use as a React inline `style` object spread on
  // the page's root element — every consumer's own local BG/BORDER/etc.
  // constants are themselves just the matching `var(--bbpe-*)` strings,
  // so setting these once at the root re-themes the entire subtree with
  // no further prop-threading into any sub-component. Reflects the
  // per-variant FALLBACK tokens only — call applyAccentOverride() first
  // and regenerate via cssVarsFor() if an organisation has a configured
  // branding.accentColor (see both below).
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
  // The default theme has no separate band chrome (EventHeader renders
  // directly on `bg`/`bgTranslucent`) — these mirror the page's own
  // tokens exactly, so they are inert no-ops if ever read.
  bandBg: '#07080B',
  bandBgTranslucent: 'rgba(7,8,11,.86)',
  bandBorder: 'rgba(255,255,255,.08)',
  bandTextPrimary: '#F5F7FA',
  bandTextMuted: 'rgba(226,232,240,.42)',
  bandAccent: '#8A4DFF',
  // Exact original literals from PublicEventClient/Hub/checkout-success
  // — see this field's own type-level comment for why these exist.
  cardBg: 'rgba(255,255,255,.02)',
  sectionBg: 'rgba(255,255,255,.02)',
  cardShadow: 'none',
};

// School Test Organisation — a GENERIC, SYNTHETIC institutional theme.
// Colour family only loosely inspired by "deep navy + burgundy + gold"
// private-school branding conventions in general — no specific
// institution's palette, crest, wordmark, or copy is reproduced anywhere
// in this file or its consuming components. See
// components/publicEvents/InstitutionalChrome.tsx for the generic
// shield-mark treatment.
//
// Light/editorial refinement pass: the page itself (hero + main content)
// is now a bright, warm off-white — the "dark SaaS" first draft read as
// an event-ticketing app, not a school website. The header/footer
// chrome stays a dark burgundy band (the `band*` tokens) as a deliberate
// bookend, matching real school-site conventions of a coloured masthead/
// footer around a light editorial page. `accent`/`accentSoft` here are a
// deliberately DARKENED gold (not the brighter `#C9A227` used only on
// the dark band) — the brighter gold fails WCAG AA text contrast on
// white at the sizes this page actually uses it (icons, the eyebrow
// label, ticket price); every value below was chosen to clear 4.5:1
// against `bg`. `green`/`red` are likewise re-picked from the default
// theme's own values for the same reason (see failureTaxonomy-style
// reasoning: a colour tuned for a near-black background can silently
// fail contrast on white) — the default theme's own green/red are
// completely unchanged.
const SCHOOL_TEST_TOKENS: PublicEventThemeTokens = {
  bg: '#FAF9F6',
  bgTranslucent: 'rgba(250,249,246,.9)',
  border: 'rgba(26,26,26,.12)',
  borderSoft: 'rgba(26,26,26,.07)',
  accent: '#8A6D1D',
  accentSoft: '#6B5416',
  accentRgb: '138,109,29',
  accentGradient: 'linear-gradient(100deg,#4B001F 0%,#5C0026 55%,#65002B 100%)',
  textPrimary: '#1A1A1A',
  textSecondary: 'rgba(26,26,26,.68)',
  textMuted: 'rgba(26,26,26,.46)',
  green: '#1B7F3F',
  red: '#B3261E',
  headingFontFamily: 'Georgia, "Times New Roman", Times, serif',
  bandBg: '#4B001F',
  bandBgTranslucent: 'rgba(75,0,31,.92)',
  bandBorder: 'rgba(201,162,39,.35)',
  bandTextPrimary: '#FFFFFF',
  bandTextMuted: 'rgba(255,255,255,.72)',
  bandAccent: '#C9A227',
  cardBg: '#FFFFFF',
  sectionBg: '#F3F2EF',
  cardShadow: '0 1px 3px rgba(26,26,26,.08), 0 4px 12px rgba(26,26,26,.05)',
};

export function cssVarsFor(tokens: PublicEventThemeTokens): Record<string, string> {
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
    '--bbpe-band-bg': tokens.bandBg,
    '--bbpe-band-bg-translucent': tokens.bandBgTranslucent,
    '--bbpe-band-border': tokens.bandBorder,
    '--bbpe-band-text-primary': tokens.bandTextPrimary,
    '--bbpe-band-text-muted': tokens.bandTextMuted,
    '--bbpe-band-accent': tokens.bandAccent,
    '--bbpe-card-bg': tokens.cardBg,
    '--bbpe-section-bg': tokens.sectionBg,
    '--bbpe-card-shadow': tokens.cardShadow,
  };
}

const DEFAULT_THEME: PublicEventTheme = {
  id: 'default',
  variant: 'default',
  tokens: DEFAULT_TOKENS,
  cssVars: cssVarsFor(DEFAULT_TOKENS),
};

// The registry itself — STRUCTURE only (variant + fixed token palette).
// Adding a future client's own structurally-branded theme is exactly
// one more entry here — nothing else in this file, or in any consuming
// component, needs to change. This registry must never gain an identity
// field (name/logo/website) again — that is lib/organisations/
// branding.ts's job exclusively; see this file's own header comment.
const PUBLIC_EVENT_THEMES: Record<string, PublicEventTheme> = {
  'school-test-organisation': {
    id: 'school-test-organisation',
    variant: 'institutional',
    tokens: SCHOOL_TEST_TOKENS,
    cssVars: cssVarsFor(SCHOOL_TEST_TOKENS),
  },
};

export function resolvePublicEventTheme(organisationSlug: string): PublicEventTheme {
  return PUBLIC_EVENT_THEMES[organisationSlug] ?? DEFAULT_THEME;
}

// ── Accent override (Phase 3B) ───────────────────────────────────────
//
// effectiveAccent = branding.accentColor ?? theme.tokens.accent
//
// Applies an organisation's configured branding.accentColor to the
// SAFE accent-family tokens only (accent/accentSoft/accentRgb) — the
// handful of solid-colour affordances (icons, links, focus rings,
// selected-state borders, badges) that were always themeable per-
// variant already. Deliberately reuses the SAME configured hex for both
// `accent` and `accentSoft` rather than computing a lighter/darker
// variant — an admin-chosen colour is used exactly as given, never
// algorithmically altered, which avoids any risk of producing an
// unreviewed, potentially low-contrast derived shade. `accentRgb` is a
// pure hex-to-"r,g,b"-string format conversion (not colour generation)
// — required because CSS custom properties can't extract channel values
// from a hex string for the rgba(var(--x-accent-rgb), alpha) usages in
// the shared public-event CSS block.
//
// Deliberately NEVER overrides: `accentGradient` (the CTA button is a
// reviewed, deliberately-independent hue per variant — see that field's
// own comment), `bandAccent` (must stay legible against the FIXED
// `bandBg`, a contrast guarantee an arbitrary admin colour cannot make),
// or any non-accent structural token (backgrounds, text colours, green/
// red semantic colours, card shadows, heading font). No colour-
// generation/theme engine of any kind — this is the full extent of what
// "configured accent" is allowed to influence.
//
// accentColor is expected to already be normalised (lib/organisations/
// branding.ts's normalizeAccentColor: null, or a lowercase 6-digit
// '#rrggbb' string) — this function still defends against anything else
// by falling back to the theme's own fixed accent unchanged rather than
// ever producing a malformed CSS value.
export function applyAccentOverride(tokens: PublicEventThemeTokens, accentColor: string | null): PublicEventThemeTokens {
  if (!accentColor) return tokens;
  const rgb = hexToRgbTriplet(accentColor);
  if (!rgb) return tokens;
  return {
    ...tokens,
    accent: accentColor,
    accentSoft: accentColor,
    accentRgb: rgb,
  };
}

function hexToRgbTriplet(hex: string): string | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
