import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'

// Public event branding — light institutional refinement pass. The
// School Test Organisation theme was originally an all-dark "premium
// dark" treatment (see publicEventBranding.test.ts, still valid for the
// generic architecture); this pass moves the page's own background to a
// bright/editorial off-white while keeping a dark burgundy header/footer
// "band" as a bookend. This suite proves the refinement itself, plus a
// real WCAG contrast check (not just presence checks) for the light
// theme's text/accent colours — the previous dark-theme colours would
// silently fail contrast against white if reused as-is.
//
// Static source-text assertion, not a claim of proven rendering
// behaviour — this project has no jsdom/React Testing Library harness.
// See tennisSessionManagementUiStaticCheck.test.ts for the same caveat
// spelled out in full. Contrast checks below run the real resolver and
// real arithmetic, so they are genuine, not just string matches.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const themeSource = read('lib/events/publicEventTheme.ts')
const chromeSource = stripComments(read('components/publicEvents/InstitutionalChrome.tsx'))
const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
const hubSource = read('app/e/[organisationSlug]/PublicEventsHubClient.tsx')
const successSource = read('app/e/[organisationSlug]/[eventSlug]/checkout/success/page.tsx')

// --- Minimal WCAG 2.x contrast-ratio implementation -------------------
// Standard relative-luminance + contrast-ratio formulas (sRGB), used
// here to make the "primary text has suitable contrast" requirement a
// real, computed assertion rather than a guess.
function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) throw new Error(`Not a plain hex colour (rgba()/CSS-var strings aren't supported by this helper): ${hex}`)
  const int = parseInt(m[1], 16)
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255]
}
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const [rl, gl, bl] = [lin(r), lin(g), lin(b)]
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl
}
function contrastRatio(hexA: string, hexB: string): number {
  const lA = relativeLuminance(hexToRgb(hexA))
  const lB = relativeLuminance(hexToRgb(hexB))
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA]
  return (lighter + 0.05) / (darker + 0.05)
}

const AA_NORMAL_TEXT = 4.5
const AA_LARGE_TEXT_OR_UI = 3.0

describe('School Test institutional theme — now light/editorial, not dark', () => {
  const theme = resolvePublicEventTheme('school-test-organisation')

  it('the main page background is bright off-white, not the previous dark navy', () => {
    expect(theme.tokens.bg).toBe('#FAF9F6')
    expect(theme.tokens.bg).not.toMatch(/^#0/) // no longer a near-black/near-navy hex
  })

  it('card and section surfaces are white / very light neutral, not translucent-on-dark overlays', () => {
    expect(theme.tokens.cardBg).toBe('#FFFFFF')
    expect(theme.tokens.sectionBg).toBe('#F3F2EF')
  })

  it('cards get a real, visible elevation shadow (the default theme never had one)', () => {
    expect(theme.tokens.cardShadow).not.toBe('none')
    expect(theme.tokens.cardShadow.length).toBeGreaterThan(0)
  })

  it('the header/footer "band" stays a dark burgundy bookend, distinct from the now-light page background', () => {
    expect(theme.tokens.bandBg).not.toBe(theme.tokens.bg)
    const [r, g, b] = hexToRgb(theme.tokens.bandBg)
    // Deep burgundy: red-dominant-but-dark, green near zero, blue low —
    // and dark overall (low luminance), never confusable with the pale
    // page background.
    expect(g).toBeLessThan(40)
    expect(relativeLuminance([r, g, b])).toBeLessThan(0.08)
  })

  it('the band wordmark colour is white, per the "white school wordmark" brief', () => {
    expect(theme.tokens.bandTextPrimary).toBe('#FFFFFF')
  })

  it('gold remains the accent family — never violet — for both the light-page accent and the band-only brighter gold', () => {
    for (const hex of [theme.tokens.accent, theme.tokens.accentSoft, theme.tokens.bandAccent]) {
      const [r, g, b] = hexToRgb(hex)
      // Gold/bronze family: red and green channels both clearly exceed
      // blue (the exact opposite shape of the old violet accent, where
      // blue was the dominant channel).
      expect(r).toBeGreaterThan(b)
      expect(g).toBeGreaterThan(b)
    }
  })

  it('the CTA gradient is burgundy, independent of the gold accent channel', () => {
    expect(theme.tokens.accentGradient).toMatch(/#4B001F|#5C0026|#65002B/)
    expect(theme.tokens.accentGradient).not.toMatch(/#C9A227|#8A6D1D/)
  })
})

describe('School Test institutional theme — real WCAG AA contrast against the light background', () => {
  const theme = resolvePublicEventTheme('school-test-organisation')
  const bg = theme.tokens.bg

  it('primary text (charcoal) clears AA normal-text contrast (4.5:1) against the page background', () => {
    expect(contrastRatio(theme.tokens.textPrimary, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  it('the accent gold (used for icons/eyebrow/prices, some as small text) clears AA normal-text contrast against the page background', () => {
    expect(contrastRatio(theme.tokens.accent, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  it('the softer accent gold variant also clears AA normal-text contrast against the page background', () => {
    expect(contrastRatio(theme.tokens.accentSoft, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  it('semantic green (availability/free) clears at least AA large-text/UI contrast against the page background', () => {
    expect(contrastRatio(theme.tokens.green, bg)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_UI)
  })

  it('semantic red (sold out / failed) clears at least AA large-text/UI contrast against the page background', () => {
    expect(contrastRatio(theme.tokens.red, bg)).toBeGreaterThanOrEqual(AA_LARGE_TEXT_OR_UI)
  })

  it('the white band wordmark clears AA normal-text contrast against the dark burgundy band', () => {
    expect(contrastRatio(theme.tokens.bandTextPrimary, theme.tokens.bandBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  it('the brighter band-only gold clears AA normal-text contrast against the dark burgundy band', () => {
    expect(contrastRatio(theme.tokens.bandAccent, theme.tokens.bandBg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
  })

  it('white CTA text clears AA normal-text contrast against every stop colour in the burgundy CTA gradient', () => {
    const stops = theme.tokens.accentGradient.match(/#[0-9A-Fa-f]{6}/g) ?? []
    expect(stops.length).toBeGreaterThan(0)
    for (const stop of stops) {
      expect(contrastRatio('#FFFFFF', stop)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT)
    }
  })
})

describe('DEFAULT_THEME is completely unaffected by the light refinement', () => {
  it('every original default token value is byte-identical to before this pass', () => {
    const theme = resolvePublicEventTheme('some-non-themed-organisation')
    expect(theme.tokens.bg).toBe('#07080B')
    expect(theme.tokens.border).toBe('rgba(255,255,255,.08)')
    expect(theme.tokens.borderSoft).toBe('rgba(255,255,255,.06)')
    expect(theme.tokens.accent).toBe('#8A4DFF')
    expect(theme.tokens.accentSoft).toBe('#A78BFA')
    expect(theme.tokens.accentRgb).toBe('138,77,255')
    expect(theme.tokens.accentGradient).toBe('linear-gradient(100deg,#6A3DFF 0%,#8A4DFF 55%,#5677FF 100%)')
    expect(theme.tokens.textPrimary).toBe('#F5F7FA')
    expect(theme.tokens.textSecondary).toBe('rgba(226,232,240,.66)')
    expect(theme.tokens.textMuted).toBe('rgba(226,232,240,.42)')
    expect(theme.tokens.green).toBe('#4ADE80')
    expect(theme.tokens.red).toBe('#F87171')
  })

  it('the new card/section/band token fields are all inert no-ops for the default theme (mirror the existing page tokens exactly)', () => {
    const theme = resolvePublicEventTheme('some-non-themed-organisation')
    expect(theme.tokens.cardBg).toBe('rgba(255,255,255,.02)')
    expect(theme.tokens.sectionBg).toBe('rgba(255,255,255,.02)')
    expect(theme.tokens.cardShadow).toBe('none')
    expect(theme.tokens.bandBg).toBe(theme.tokens.bg)
    expect(theme.tokens.bandBgTranslucent).toBe(theme.tokens.bgTranslucent)
    expect(theme.tokens.bandBorder).toBe(theme.tokens.border)
    expect(theme.tokens.bandTextPrimary).toBe(theme.tokens.textPrimary)
    expect(theme.tokens.bandTextMuted).toBe(theme.tokens.textMuted)
    expect(theme.tokens.bandAccent).toBe(theme.tokens.accent)
  })
})

describe('PublicEventClient.tsx / Hub / checkout-success — panel backgrounds now theme-routed, not stuck on invisible-on-light literals', () => {
  it('no raw rgba(255,255,255,.0N) card/section literal remains for the primary panel surfaces this pass targeted', () => {
    // Only the CSS-in-JS control surfaces (radio-card-inner, input,
    // stepper-btn) and the two minor/decorative literals (checkout-
    // cancelled notice, neutral availability badge) are deliberately
    // left as-is — see this file's own investigation notes in the final
    // report. Every PRIMARY panel/card literal must now be var-routed.
    for (const src of [clientSource, hubSource, successSource]) {
      expect(src).not.toMatch(/background: 'rgba\(255,255,255,\.025\)'/)
    }
  })

  it('PublicEventClient booking panel and confirmation card use the themed card background + shadow', () => {
    expect(clientSource).toMatch(/background: 'var\(--bbpe-card-bg\)', boxShadow: 'var\(--bbpe-card-shadow\)'/)
  })

  it('PublicEventsHubClient empty-state and event cards use the themed card background + shadow', () => {
    expect(hubSource).toMatch(/background: 'var\(--bbpe-card-bg\)', boxShadow: 'var\(--bbpe-card-shadow\)'/)
  })

  it('checkout success status card uses the themed card background + shadow', () => {
    expect(successSource).toMatch(/background: 'var\(--bbpe-card-bg\)', boxShadow: 'var\(--bbpe-card-shadow\)'/)
  })

  it('the checkout success "pending" status circle no longer hardcodes the old violet RGB triplet — it now tracks the accent colour it displays', () => {
    expect(successSource).not.toMatch(/rgba\(138,77,255/)
    expect(successSource).toMatch(/pending: \{ fg: VIOLET_SOFT, bg: 'rgba\(var\(--bbpe-accent-rgb\),\.12\)', bd: 'rgba\(var\(--bbpe-accent-rgb\),\.35\)' \}/)
  })
})

describe('InstitutionalChrome — header/footer stay on the dark "band" tokens, hero stays on the light page tokens', () => {
  it('InstitutionalHeader and InstitutionalFooter reference only band-* CSS variables for background/text/border, never the (now light) page bg/text tokens', () => {
    const headerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalHeader'), chromeSource.indexOf('export function InstitutionalHero'))
    const footerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalFooter'))
    for (const fn of [headerFn, footerFn]) {
      expect(fn).toMatch(/var\(--bbpe-band-bg/)
      expect(fn).not.toMatch(/var\(--bbpe-bg\)/)
      expect(fn).not.toMatch(/var\(--bbpe-text-primary\)/)
    }
  })

  it('InstitutionalHero renders on the light page tokens, not the dark band tokens', () => {
    const heroFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalHero'), chromeSource.indexOf('export function InstitutionalFooter'))
    expect(heroFn).toMatch(/var\(--bbpe-bg\)/)
    expect(heroFn).not.toMatch(/var\(--bbpe-band-/)
  })

  it('GenericCrestMark renders only on band tokens (it is only ever placed inside the header/footer band)', () => {
    const crestFn = chromeSource.slice(chromeSource.indexOf('export function GenericCrestMark'), chromeSource.indexOf('export function InstitutionalHeader'))
    expect(crestFn).toMatch(/var\(--bbpe-band-bg\)/)
    expect(crestFn).toMatch(/var\(--bbpe-band-accent\)/)
    expect(crestFn).not.toMatch(/var\(--bbpe-accent\)/) // the light-page accent, not the band one
  })

  it('InstitutionalFooter now sets an explicit band background (previously it had none and silently inherited the page bg)', () => {
    const footerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalFooter'))
    expect(footerFn).toMatch(/<footer style=\{\{ background: 'var\(--bbpe-band-bg\)'/)
  })
})

describe('Copyright/branding safety — still no real institution referenced anywhere', () => {
  const allTouchedSources = [themeSource, chromeSource, clientSource, hubSource, successSource]

  it('the word "Cardijn" never appears in any touched file', () => {
    for (const src of allTouchedSources) {
      expect(src).not.toMatch(/cardijn/i)
    }
  })

  it('no real institution asset URL/domain appears anywhere', () => {
    for (const src of allTouchedSources) {
      expect(src).not.toMatch(/cardijn\.catholic\.edu\.au/i)
    }
  })
})

describe('No internal/admin navigation leaks into the refined branded chrome', () => {
  it('InstitutionalChrome still never links to any internal manager/admin route', () => {
    expect(chromeSource).not.toMatch(/href=["`]\/events\/|href=["`]\/admin\/|href=["`]\/crm\/|Manage registration|Check-in|View CRM Contact/)
  })
})

describe('Public registration/payment/business logic untouched by this presentation-only refinement', () => {
  it('PublicEventClient handler/API-call shapes are unchanged', () => {
    expect(clientSource).toContain('async function handleSubmit(')
    expect(clientSource).toContain("${paid ? 'checkout' : 'register'}")
    expect(clientSource).toContain('computeSelectionTotalCents')
  })

  it('checkout success polling logic (interval, endpoint, max attempts) is unchanged', () => {
    expect(successSource).toContain('const POLL_INTERVAL_MS = 2000')
    expect(successSource).toContain('const MAX_POLLS = 20')
    expect(successSource).toContain('/checkout/status?session_id=')
  })

  it('EventHeader() — the default theme\'s own header — remains completely untouched (org-agnostic contract)', () => {
    const fnStart = clientSource.indexOf('function EventHeader()')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const headerBody = clientSource.slice(fnStart, fnEnd)
    expect(headerBody).not.toMatch(/organisationSlug|eventSlug|event\.name|event\.title|theme|institutional/)
  })
})
