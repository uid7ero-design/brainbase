import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolvePublicEventTheme, applyAccentOverride } from '@/lib/events/publicEventTheme'

// Public event branding — generic theming layer for app/e/[organisationSlug]/**
// (see lib/events/publicEventTheme.ts). Behavioural checks run the real
// resolver directly; everything else is a static source-text check
// (this repo has no jsdom/React Testing Library harness — same caveat
// as every other Events UI containment suite, e.g.
// registrationDetailSectionsStaticCheck.test.ts).

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const themeSource = read('lib/events/publicEventTheme.ts')
const chromeSource = read('components/publicEvents/InstitutionalChrome.tsx')
const chromeCode = stripComments(chromeSource)
const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')
const hubSource = read('app/e/[organisationSlug]/PublicEventsHubClient.tsx')
// checkout/success is a thin server wrapper (successPageSource) plus a
// client child (successSource) as of the pre-push correction — see
// CheckoutSuccessClient.tsx's own header comment. Behavioural/theme
// checks below target the client child, which now holds that logic;
// successPageSource is checked separately for identity-source
// containment (no slug-derived name, reuses the existing resolver).
const successPageSource = read('app/e/[organisationSlug]/[eventSlug]/checkout/success/page.tsx')
const successSource = read('app/e/[organisationSlug]/[eventSlug]/checkout/success/CheckoutSuccessClient.tsx')

describe('resolvePublicEventTheme — resolver behaviour', () => {
  it('an unknown organisation slug resolves to the default, non-branded theme', () => {
    const theme = resolvePublicEventTheme('some-random-unknown-org-slug')
    expect(theme.id).toBe('default')
    expect(theme.variant).toBe('default')
  })

  it('school-test-organisation resolves to the institutional variant', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    expect(theme.id).toBe('school-test-organisation')
    expect(theme.variant).toBe('institutional')
  })

  it('PublicEventTheme carries no identity field at all — Phase 3B removed brand entirely', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    expect(theme).not.toHaveProperty('brand')
  })

  it('the default theme\'s tokens are byte-identical to the original hardcoded PublicEventClient palette — a non-branded organisation must render exactly as before this pass', () => {
    const theme = resolvePublicEventTheme('any-other-organisation')
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

  it('cssVars exposes exactly the CSS custom properties every consumer\'s own local consts resolve to', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    expect(theme.cssVars['--bbpe-bg']).toBe(theme.tokens.bg)
    expect(theme.cssVars['--bbpe-accent']).toBe(theme.tokens.accent)
    expect(theme.cssVars['--bbpe-accent-rgb']).toBe(theme.tokens.accentRgb)
    expect(theme.cssVars['--bbpe-accent-gradient']).toBe(theme.tokens.accentGradient)
  })

  it('applyAccentOverride is a no-op when accentColor is null — unconfigured organisations keep the exact fixed fallback tokens', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    const result = applyAccentOverride(theme.tokens, null)
    expect(result).toEqual(theme.tokens)
    expect(result.accent).toBe('#8A6D1D')
    expect(result.bandAccent).toBe('#C9A227')
  })

  it('applyAccentOverride substitutes accent/accentSoft/accentRgb from a configured hex, but never bandAccent or accentGradient', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    const result = applyAccentOverride(theme.tokens, '#123456')
    expect(result.accent).toBe('#123456')
    expect(result.accentSoft).toBe('#123456')
    expect(result.accentRgb).toBe('18,52,86')
    expect(result.bandAccent).toBe(theme.tokens.bandAccent)
    expect(result.accentGradient).toBe(theme.tokens.accentGradient)
    expect(result.bandBg).toBe(theme.tokens.bandBg)
    expect(result.bg).toBe(theme.tokens.bg)
  })

  it('applyAccentOverride never crashes on a malformed hex — falls back to the original fixed tokens', () => {
    const theme = resolvePublicEventTheme('default-org')
    expect(applyAccentOverride(theme.tokens, 'not-a-hex')).toEqual(theme.tokens)
  })

  it('the resolver never touches a database, session, or organisation id — purely a synchronous slug-keyed lookup', () => {
    const code = stripComments(themeSource)
    expect(themeSource).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(code).not.toMatch(/organisationId/)
    expect(themeSource).not.toContain("'server-only'")
    expect(code).not.toMatch(/\basync\b/)
  })

  it('never hardcodes ld-tennis or any other non-school-test organisation coupling', () => {
    expect(themeSource).not.toMatch(/ld-tennis/i)
  })
})

describe('Copyright/branding safety — no real institution referenced anywhere', () => {
  const allTouchedSources = [themeSource, chromeSource, clientSource, hubSource, successSource, successPageSource]

  it('the word "Cardijn" never appears in any touched file', () => {
    for (const src of allTouchedSources) {
      expect(src).not.toMatch(/cardijn/i)
    }
  })

  it('no reference to the Cardijn domain or any external real-institution asset URL', () => {
    for (const src of allTouchedSources) {
      expect(src).not.toMatch(/cardijn\.catholic\.edu\.au/i)
    }
  })

})

describe('PublicEventClient.tsx — EventHeader() remains completely untouched (org-agnostic contract)', () => {
  it('EventHeader is still a zero-argument function, unconditionally rendering BrainBase\'s own identity', () => {
    expect(clientSource).toMatch(/function EventHeader\(\)\s*\{/)
  })

  it('EventHeader\'s own body never references organisationSlug, eventSlug, event.name/title, or the theme/institutional branching this pass introduced', () => {
    const fnStart = clientSource.indexOf('function EventHeader()')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const headerBody = clientSource.slice(fnStart, fnEnd)
    expect(headerBody).not.toMatch(/organisationSlug|eventSlug|event\.name|event\.title|theme|institutional/)
  })

  it('EventHeader is still used as the header for the default (non-branded) theme, unconditionally', () => {
    expect(clientSource).toMatch(/institutional \? <InstitutionalHeader branding=\{branding\} organisationName=\{organisationName\} \/> : <EventHeader \/>/)
  })
})

describe('PublicEventClient.tsx — theme resolution is additive, organisationSlug-only', () => {
  it('imports and calls the shared resolver using only the organisationSlug prop it already receives', () => {
    expect(clientSource).toMatch(/import \{ resolvePublicEventTheme, applyAccentOverride, cssVarsFor \} from '@\/lib\/events\/publicEventTheme'/)
    expect(clientSource).toContain('const theme = resolvePublicEventTheme(organisationSlug)')
  })

  it('the root element(s) spread the effective cssVars (structural tokens + any configured accent override) — both the confirmation-state and main-state renders', () => {
    const occurrences = clientSource.match(/\.\.\.cssVars/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
    expect(clientSource).toContain('applyAccentOverride(theme.tokens, branding.accentColor)')
    expect(clientSource).toContain('const cssVars = cssVarsFor(effectiveTokens)')
  })

  it('none of the existing state, handlers, or API call shapes were touched — registration/checkout plumbing is unchanged', () => {
    expect(clientSource).toContain('async function handleSubmit(');
    expect(clientSource).toContain("${paid ? 'checkout' : 'register'}");
    expect(clientSource).toContain('purchaser_name: purchaserName');
    expect(clientSource).toContain('computeSelectionTotalCents');
  })

  it('no literal violet/accent rgba colour remains hardcoded outside the theme module — every accent-tinted glow/shadow now routes through the CSS variable', () => {
    expect(clientSource).not.toMatch(/rgba\(138,77,255/)
    expect(clientSource).not.toMatch(/rgba\(106,61,255/)
    expect(clientSource).not.toMatch(/rgba\(124,58,237/)
    expect(clientSource).not.toMatch(/rgba\(74,54,180/)
    expect(clientSource).not.toMatch(/rgba\(88,68,220/)
  })
})

describe('PublicEventsHubClient.tsx and checkout success page — same theme resolver, same continuity', () => {
  for (const [name, src] of [['PublicEventsHubClient', hubSource], ['checkout success page', successSource]] as const) {
    it(`${name} imports and resolves the shared public-event theme`, () => {
      expect(src).toMatch(/import \{ resolvePublicEventTheme, applyAccentOverride, cssVarsFor \} from '@\/lib\/events\/publicEventTheme'/)
      expect(src).toMatch(/resolvePublicEventTheme\(/)
    })

    it(`${name} spreads the effective cssVars onto its root element`, () => {
      expect(src).toContain('...cssVars')
      expect(src).toContain('applyAccentOverride(theme.tokens')
    })
  }

  it('the hub page\'s event-card links are still exactly /e/[organisationSlug]/[eventSlug] using resolved slugs — "View public page"/"Copy public link" continuity is preserved', () => {
    expect(hubSource).toMatch(/href=\{`\/e\/\$\{organisationSlug\}\/\$\{event\.slug\}`\}/)
  })

  it('the hub page\'s empty-state copy is unchanged', () => {
    expect(hubSource).toContain('No upcoming events')
  })
})

describe('No internal/admin navigation leaks into the branded public chrome', () => {
  it('InstitutionalChrome never links to any internal manager/admin route', () => {
    expect(chromeCode).not.toMatch(/href=["`]\/events\/|href=["`]\/admin\/|href=["`]\/crm\/|Manage registration|Check-in|View CRM Contact/)
  })

  it('InstitutionalChrome renders only caller-supplied branding/organisationName, never a hardcoded organisation name', () => {
    expect(chromeCode).not.toMatch(/School Test Organisation|Cardijn/i)
  })

  it('the "Visit website" link is gated on the resolved website (branding.website ?? none) being present, never unconditionally rendered', () => {
    const headerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalHeader'), chromeSource.indexOf('export function InstitutionalHero'))
    expect(headerFn).toContain('website && (')
    expect(headerFn).toContain("branding?.website ?? null")
  })
})

describe('Phase 3B — publicEventTheme.ts no longer owns any organisation identity (single source of truth)', () => {
  it('contains no PublicEventBrand type', () => {
    expect(themeSource).not.toMatch(/PublicEventBrand/)
  })

  it('contains no "brand:" field on PublicEventTheme or either registry entry', () => {
    expect(themeSource).not.toMatch(/\bbrand:/)
  })

  it('contains no shortName/tagline/websiteUrl identity keys anywhere', () => {
    expect(themeSource).not.toMatch(/shortName/)
    expect(themeSource).not.toMatch(/tagline/)
    expect(themeSource).not.toMatch(/websiteUrl/)
  })

  it('contains no hardcoded organisation display name string ("School Test Organisation") in actual code — only in this file\'s own explanatory prose comments, which reference it as context, not as a live value', () => {
    const code = stripComments(themeSource)
    expect(code).not.toMatch(/School Test Organisation/)
  })

  it('InstitutionalChrome.tsx no longer imports or references theme.brand anywhere', () => {
    expect(chromeSource).not.toMatch(/theme\.brand/)
    expect(chromeSource).not.toMatch(/PublicEventBrand/)
  })

  it('InstitutionalChrome.tsx no longer defines GenericCrestMark — OrganisationLogo (Phase 3A) is the sole logo/initials renderer', () => {
    expect(chromeSource).not.toMatch(/GenericCrestMark/)
    expect(chromeSource).toContain("import { OrganisationLogo } from '@/components/organisations/OrganisationLogo'")
  })

  it('there is no code path anywhere in the touched surface where the theme registry can assert a name/logo/website value that reaches the rendered page', () => {
    // Exhaustive: the only two places identity text/logo can come from
    // post-Phase-3B are InstitutionalHeader/Footer's own branding/
    // organisationName props (verified above to derive from the
    // caller, never from resolvePublicEventTheme's return value) and
    // OrganisationLogo (verified in Phase 3A's own containment suite to
    // only accept PublicOrganisationBranding). No other identity-shaped
    // field exists on PublicEventTheme's own CODE (comments elsewhere in
    // this file legitimately discuss the concept in prose) to leak.
    const code = stripComments(themeSource)
    const typeStart = code.indexOf('export type PublicEventTheme = {')
    const typeEnd = code.indexOf('\n};', typeStart) + 3
    const themeType = code.slice(typeStart, typeEnd)
    expect(themeType.length).toBeGreaterThan(0)
    expect(themeType).not.toMatch(/\bname\b|\blogo\b|\bwebsite\b/i)
  })
})

describe('Pre-push correction — checkout success no longer humanizes the routing slug as identity', () => {
  it('no humanizeSlug helper (or any slug-humanizing function) exists anywhere in the checkout success surface', () => {
    for (const src of [successPageSource, successSource]) {
      expect(src).not.toMatch(/humanizeSlug/)
      expect(stripComments(src)).not.toMatch(/split\(['"]-['"]\)/)
    }
  })

  it('checkout success page.tsx (server wrapper) resolves organisation identity via the existing resolvePublicEvent choke point, not a new bespoke resolver', () => {
    expect(successPageSource).toMatch(/import \{ resolvePublicEvent \} from '@\/lib\/events\/publicResolve'/)
    expect(successPageSource).toContain('resolvePublicEvent(organisationSlug, eventSlug)')
    // Reuses the existing resolver only — no new checkout-only branding
    // lookup, no getPublicOrganisationBranding call added here.
    expect(successPageSource).not.toMatch(/getPublicOrganisationBranding|getOrganisationBranding/)
  })

  it('checkout success page.tsx never calls notFound() — a failed resolution degrades to unbranded chrome, it never blocks rendering of a completed payment', () => {
    const code = stripComments(successPageSource)
    expect(code).not.toMatch(/notFound\(/)
    expect(code).not.toMatch(/from ['"]next\/navigation['"].*notFound/)
  })

  it('organisationName/branding passed into the client child come only from resolvePublicEvent\'s own result, never from the URL slug directly', () => {
    expect(successPageSource).toMatch(/organisationName=\{resolved\.ok \? resolved\.organisationName : null\}/)
    expect(successPageSource).toMatch(/branding=\{resolved\.ok \? resolved\.branding : null\}/)
    expect(successPageSource).not.toMatch(/organisationName=\{organisationSlug\}/)
  })

  it('CheckoutSuccessClient never passes organisationSlug (or any derivative of it) as the organisationName identity prop', () => {
    const code = stripComments(successSource)
    // organisationSlug is still legitimately used for the STRUCTURAL
    // theme lookup (resolvePublicEventTheme(organisationSlug)) and the
    // checkout/status API URL — never as a display name. The only
    // identity-shaped prop is organisationName, which must always come
    // from the organisationName prop (itself server-resolved), never
    // from organisationSlug.
    expect(code).not.toMatch(/organisationName=\{organisationSlug\}/)
    expect(code).not.toMatch(/organisationName\s*=\s*organisationSlug/)
    expect(code).toContain('resolvePublicEventTheme(organisationSlug)')
  })

  it('institutional identity chrome renders only when server-side resolution actually succeeded, and only using the resolved branding/organisationName props', () => {
    expect(successSource).toContain('const hasResolvedIdentity = organisationName !== null')
    expect(successSource).toMatch(/institutional && hasResolvedIdentity \? \(\s*<InstitutionalHeader branding=\{branding\} organisationName=\{organisationName\} \/>/)
    expect(successSource).toMatch(/\{institutional && hasResolvedIdentity && <InstitutionalFooter branding=\{branding\} organisationName=\{organisationName\} \/>\}/)
  })

  it('when identity has not resolved, checkout success falls back to the same plain BrainBase header the default variant already uses — never a blank or slug-derived header', () => {
    const fallbackHeaderRegion = successSource.slice(successSource.indexOf(') : ('), successSource.indexOf('</header>'))
    expect(fallbackHeaderRegion).toContain('brainbase-logo-dark.svg')
  })
})

describe('Public route files themselves are untouched by this pass', () => {
  it('the public event/hub route directory structure is unchanged — no new route, no preview/bypass route added', () => {
    const eventSlugDir = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]'))
    expect(eventSlugDir.sort()).toEqual(['PublicEventClient.tsx', 'checkout', 'page.tsx'].sort())
    const orgSlugDir = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]'))
    expect(orgSlugDir.sort()).toEqual(['[eventSlug]', 'PublicEventsHubClient.tsx', 'page.tsx'].sort())
  })

  it('checkout/success is exactly a thin server page.tsx plus its CheckoutSuccessClient.tsx child — the pre-push correction\'s own minimal split, no extra files', () => {
    const successDir = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]/checkout/success'))
    expect(successDir.sort()).toEqual(['CheckoutSuccessClient.tsx', 'page.tsx'].sort())
  })

  it('page.tsx (the server route entry) was not modified by this pass — no new import of the theme module there', () => {
    const pageSource = read('app/e/[organisationSlug]/[eventSlug]/page.tsx')
    expect(pageSource).not.toContain('publicEventTheme')
  })
})
