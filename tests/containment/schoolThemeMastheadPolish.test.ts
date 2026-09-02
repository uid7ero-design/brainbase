import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Public event branding — final presentation polish pass. Manual mobile
// Production review confirmed the light institutional theme itself
// works, but the site-wide BrainBase masthead (TopNav's PublicNav — a
// full marketing navbar: Logo, Product, Pricing, Login) was still
// stacking on top of the School Test Organisation branded header, since
// TopNav renders unconditionally in the root layout for every route.
// This suite proves: TopNav now suppresses itself for institutional-
// themed public event pages ONLY (reusing the same resolvePublicEventTheme
// lookup every other public-event component already calls, not a new
// theme mechanism), the default theme's own masthead is untouched, and
// the accompanying header/hero/spacing/step-label polish landed without
// touching business logic.
//
// Static source-text assertion, not a claim of proven rendering
// behaviour — this project has no jsdom/React Testing Library harness.
// See tennisSessionManagementUiStaticCheck.test.ts for the same caveat
// spelled out in full.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const topNavSource = read('components/nav/TopNav.tsx')
const topNavCode = stripComments(topNavSource)
const chromeSource = read('components/publicEvents/InstitutionalChrome.tsx')
const chromeCode = stripComments(chromeSource)
const clientSource = read('app/e/[organisationSlug]/[eventSlug]/PublicEventClient.tsx')

describe('TopNav — institutional-themed public event pages suppress the site-wide BrainBase masthead', () => {
  it('imports and reuses the exact same resolvePublicEventTheme lookup every other public-event component uses', () => {
    expect(topNavCode).toContain("import { resolvePublicEventTheme } from '@/lib/events/publicEventTheme'")
  })

  it('derives the organisation slug from the pathname for /e/[organisationSlug]/** routes only', () => {
    expect(topNavCode).toContain('const publicEventOrgSlug')
    expect(topNavCode).toContain('pathname?.match(')
    expect(topNavCode).toContain("([^/]+)/")
  })

  it('the early-return bail-out ORs the new institutional check onto the existing /tennis and /connect checks — it does not replace them', () => {
    // Anchored after the useEffect's own closing `}, []);` — the fetch
    // handler inside it has its own early `return null;` statements
    // (unrelated 401/non-ok short-circuits), so the bail-out block itself
    // must be located strictly after that, not from the top of the
    // component.
    const fnStart = topNavCode.indexOf('export default function TopNav(')
    const effectEnd = topNavCode.indexOf('}, []);', fnStart)
    const bailStart = topNavCode.indexOf('if (', effectEnd)
    const bailReturn = topNavCode.indexOf('return null;', bailStart)
    const bailBlock = topNavCode.slice(bailStart, bailReturn + 20)
    expect(bailBlock).toContain("pathname?.startsWith(\n      '/tennis',\n    )")
    expect(bailBlock).toContain("pathname?.startsWith(\n      '/connect',\n    )")
    expect(bailBlock).toContain('publicEventOrgSlug')
    expect(bailBlock).toContain('resolvePublicEventTheme(')
    expect(bailBlock).toContain("'institutional'")
  })

  it('the bail-out is gated on variant === "institutional", never a hardcoded organisation slug/name', () => {
    expect(topNavCode).not.toMatch(/school-test-organisation/i)
  })

  it('a non-themed organisation\'s slug never satisfies the bail-out condition — the resolver\'s own default fallback (variant: "default") keeps this false', () => {
    // Structural proof, not a runtime one (no jsdom here): the condition
    // explicitly checks `.variant === 'institutional'`, and
    // resolvePublicEventTheme's own contract (see publicEventBranding.test.ts)
    // is that every unknown slug resolves to variant: 'default' — so this
    // condition is false for every organisation except the ones actually
    // registered as institutional.
    expect(topNavCode).toMatch(/\.variant ===\s*\n?\s*'institutional'/)
    expect(topNavCode).not.toContain(".variant !== 'default'")
  })
})

describe('Institutional public-event pages still show their OWN branded header — masthead suppression is additive, not a content removal', () => {
  it('InstitutionalHeader and InstitutionalFooter still exist and are unchanged in purpose', () => {
    expect(chromeCode).toContain('export function InstitutionalHeader')
    expect(chromeCode).toContain('export function InstitutionalFooter')
  })

  it('the footer still carries the subtle BrainBase attribution disclosure', () => {
    expect(chromeCode).toContain('Registrations powered by BrainBase')
  })

  it('the footer never reintroduces a large BrainBase mark (no BrainBaseWordmark / large logo import)', () => {
    expect(chromeCode).not.toContain('BrainBaseWordmark')
    expect(chromeCode).not.toMatch(/brainbase-horizontal-color|brainbase-logo-dark/)
  })
})

describe('InstitutionalHeader — premium spacing polish', () => {
  it('vertical padding was modestly increased (18px, up from 14px) and crest/wordmark gap widened (14px, up from 12px)', () => {
    const headerFn = chromeCode.slice(chromeCode.indexOf('export function InstitutionalHeader'), chromeCode.indexOf('export function InstitutionalHero'))
    expect(headerFn).toContain("padding: '18px 20px'")
    expect(headerFn).toMatch(/gap: 14,\s*minWidth: 0/)
  })

  it('the header is not excessively tall — padding stays a fixed, modest value, not a large fixed height', () => {
    const headerFn = chromeCode.slice(chromeCode.indexOf('export function InstitutionalHeader'), chromeCode.indexOf('export function InstitutionalHero'))
    expect(headerFn).not.toMatch(/height:\s*\d{2,}/) // no explicit large fixed height
  })
})

describe('InstitutionalHero — responsive mobile typography and tighter mobile spacing', () => {
  const heroFn = chromeCode.slice(chromeCode.indexOf('export function InstitutionalHero'), chromeCode.indexOf('export function InstitutionalFooter'))

  it('the event heading uses CSS clamp() so it scales down on narrow viewports while preserving desktop size', () => {
    expect(heroFn).toMatch(/fontSize: 'clamp\(26px, 6\.5vw, 32px\)'/)
  })

  it('the hero container padding uses clamp() to tighten on mobile without a fixed media query fork', () => {
    expect(heroFn).toMatch(/padding: 'clamp\(28px, 7vw, 40px\) 20px clamp\(24px, 6vw, 34px\)'/)
  })

  it('the clamped minimums are still comfortably larger than body text, preserving strong visual hierarchy', () => {
    expect(heroFn).toMatch(/clamp\(26px/) // 26px minimum h1 size, still clearly larger than the 14-16px meta/body text around it
  })
})

describe('Mobile/institutional spacing tightened without touching the default theme\'s own rendering', () => {
  it('the event description bottom margin is tightened for the institutional theme only, via an inline ternary on the existing `institutional` flag — not a new theme token, not a fork', () => {
    expect(clientSource).toContain("margin: institutional ? '0 0 18px' : '0 0 22px'")
  })

  it('the booking form\'s internal field-group gap is tightened for the institutional theme only, the same way', () => {
    expect(clientSource).toContain('gap: institutional ? 18 : 22')
  })

  it('every such tightening is a plain ternary on the existing `institutional` boolean — no new CSS variable, no JSX fork, no duplicated form', () => {
    expect(clientSource).toContain('const institutional = theme.variant')
    expect((clientSource.match(/institutional \? /g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})

describe('Registration panel — step headings softened for the institutional theme, form otherwise unchanged', () => {
  it('StepLabel accepts an explicit `softer` prop (not a closure/theme lookup) and every call site passes softer={institutional}', () => {
    const fnStart = clientSource.indexOf('function StepLabel(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const stepLabelFn = clientSource.slice(fnStart, fnEnd)
    expect(stepLabelFn).toContain('softer?: boolean')
    expect(stepLabelFn).toContain("fontWeight: softer ? 600 : 700")
    expect(stepLabelFn).toContain("letterSpacing: softer ? '.03em' : '.06em'")

    const callSites = clientSource.match(/<StepLabel[^/]*\/>/g) ?? []
    expect(callSites.length).toBe(6)
    for (const call of callSites) {
      expect(call, `every StepLabel call site must pass softer={institutional}: ${call}`).toContain('softer={institutional}')
    }
  })

  it('the default theme\'s own StepLabel rendering is unchanged when softer is omitted/false — the ternary falls back to the exact original values (700 / .06em)', () => {
    const fnStart = clientSource.indexOf('function StepLabel(')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const stepLabelFn = clientSource.slice(fnStart, fnEnd)
    expect(stepLabelFn).toContain(': 700')
    expect(stepLabelFn).toContain("'.06em'")
  })

  it('every existing form field/fieldset/step remains present — no fields were removed or restructured', () => {
    expect(clientSource).toContain('StepLabel index={stepTicket}')
    expect(clientSource).toContain('StepLabel index={stepSession as number}')
    expect(clientSource).toContain('StepLabel index={stepQuantity}')
    expect(clientSource).toContain('StepLabel index={stepPurchaser}')
    expect(clientSource).toContain('StepLabel index={stepOrderQuestions as number}')
    expect(clientSource).toContain('StepLabel index={stepAttendee}')
  })
})

describe('No business/registration/payment logic touched by this presentation-only pass', () => {
  it('PublicEventClient handler/API-call shapes are unchanged', () => {
    expect(clientSource).toContain('async function handleSubmit(')
    expect(clientSource).toContain("${paid ? 'checkout' : 'register'}")
    expect(clientSource).toContain('computeSelectionTotalCents')
  })

  it('EventHeader() — the default theme\'s own header — remains completely untouched (org-agnostic contract)', () => {
    const fnStart = clientSource.indexOf('function EventHeader()')
    const fnEnd = clientSource.indexOf('\n}', fnStart) + 2
    const headerBody = clientSource.slice(fnStart, fnEnd)
    expect(headerBody).not.toMatch(/organisationSlug|eventSlug|event\.name|event\.title|theme|institutional/)
  })

  it('TopNav\'s own capability-gated nav logic (AppNav, dashboardVariant classification) is untouched — only the early public-event bail-out was added', () => {
    expect(topNavCode).toMatch(/dashboardVariant\s*===\s*'ld-tennis'/)
    expect(topNavCode).toMatch(/dashboardVariant\s*===\s*'brainbase-hq'/)
  })
})
