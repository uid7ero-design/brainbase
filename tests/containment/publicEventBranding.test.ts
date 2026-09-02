import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'

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
const successSource = read('app/e/[organisationSlug]/[eventSlug]/checkout/success/page.tsx')

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
    expect(theme.brand.name).toBe('School Test Organisation')
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

  it('school-test-organisation has no websiteUrl configured — a real domain was deliberately never invented for a demo organisation', () => {
    const theme = resolvePublicEventTheme('school-test-organisation')
    expect(theme.brand.websiteUrl).toBeUndefined()
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
  const allTouchedSources = [themeSource, chromeSource, clientSource, hubSource, successSource]

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

  it('the generic crest mark is code-drawn SVG, not an imported/copied image asset', () => {
    const fnStart = chromeSource.indexOf('export function GenericCrestMark')
    const fnEnd = chromeSource.indexOf('\n}', fnStart) + 2
    const body = chromeSource.slice(fnStart, fnEnd)
    expect(body).toContain('<svg')
    expect(body).not.toMatch(/<img|next\/image|\.svg["']|\.png["']|\.jpg["']/)
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
    expect(clientSource).toMatch(/institutional \? <InstitutionalHeader theme=\{theme\} \/> : <EventHeader \/>/)
  })
})

describe('PublicEventClient.tsx — theme resolution is additive, organisationSlug-only', () => {
  it('imports and calls the shared resolver using only the organisationSlug prop it already receives', () => {
    expect(clientSource).toContain("import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'")
    expect(clientSource).toContain('const theme = resolvePublicEventTheme(organisationSlug)')
  })

  it('the root element(s) spread theme.cssVars — both the confirmation-state and main-state renders', () => {
    const occurrences = clientSource.match(/\.\.\.theme\.cssVars/g) ?? []
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
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
      expect(src).toContain("import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'")
      expect(src).toMatch(/resolvePublicEventTheme\(/)
    })

    it(`${name} spreads theme.cssVars onto its root element`, () => {
      expect(src).toContain('...theme.cssVars')
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

  it('InstitutionalChrome renders only organisation-supplied brand fields, never a hardcoded organisation name', () => {
    expect(chromeCode).not.toMatch(/School Test Organisation|Cardijn/i)
  })

  it('the "Visit website" link is gated on theme.brand.websiteUrl being present, never unconditionally rendered', () => {
    const headerFn = chromeSource.slice(chromeSource.indexOf('export function InstitutionalHeader'), chromeSource.indexOf('export function InstitutionalHero'))
    expect(headerFn).toContain('theme.brand.websiteUrl && (')
  })
})

describe('Public route files themselves are untouched by this pass', () => {
  it('the public event/hub route directory structure is unchanged — no new route, no preview/bypass route added', () => {
    const eventSlugDir = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]/[eventSlug]'))
    expect(eventSlugDir.sort()).toEqual(['PublicEventClient.tsx', 'checkout', 'page.tsx'].sort())
    const orgSlugDir = fs.readdirSync(path.join(root, 'app/e/[organisationSlug]'))
    expect(orgSlugDir.sort()).toEqual(['[eventSlug]', 'PublicEventsHubClient.tsx', 'page.tsx'].sort())
  })

  it('page.tsx (the server route entry) was not modified by this pass — no new import of the theme module there', () => {
    const pageSource = read('app/e/[organisationSlug]/[eventSlug]/page.tsx')
    expect(pageSource).not.toContain('publicEventTheme')
  })
})
