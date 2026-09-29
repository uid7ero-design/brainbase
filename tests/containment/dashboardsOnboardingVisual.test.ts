import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'

// Remaining visual islands pass — Phase 5A (/dashboards module library) and
// Phase 5B (/onboarding wizard + its seven steps). Consumer-aware guard:
// the files below are the live route files (app/dashboards/page.tsx is the
// /dashboards route; app/onboarding/page.tsx renders OnboardingWizard, which
// imports every step). Comments are stripped before scanning. The only hue
// literals allowed are the per-module identity colours in the DASHBOARDS
// data array (categorical data encoding, pinned exactly below).
// Rendered behaviour + axe in both themes: tests/components/app/
// DashboardsLibrary.test.tsx and OnboardingWizard.test.tsx.

const root = path.resolve(__dirname, '../..')
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1')

const DASH = 'app/dashboards/page.tsx'
const DASH_CSS = 'app/dashboards/Dashboards.module.css'
const WIZ = 'app/onboarding/_components/OnboardingWizard.tsx'
const ONB_CSS = 'app/onboarding/_components/Onboarding.module.css'
const STEP_DIR = 'app/onboarding/_components/steps'
const STEPS = [
  'Step1OrgInfo.tsx', 'Step2DataSources.tsx', 'Step3WasteMapping.tsx', 'Step4FleetMapping.tsx',
  'Step5KeyQuestions.tsx', 'Step6SuccessMetrics.tsx', 'Step7Review.tsx',
].map(f => `${STEP_DIR}/${f}`)

const MODULE_COLORS = [
  '#10b981', '#3b82f6', '#f59e0b', '#f97316', '#64748b', '#06b6d4', '#22c55e',
  '#8b5cf6', '#ec4899', '#0ea5e9', '#a855f7', '#16a34a', '#2DD4BF',
]

/** The dashboards page with its DASHBOARDS data array's identity colours removed. */
function dashChrome() {
  const src = strip(read(DASH))
  const start = src.indexOf('const DASHBOARDS = [')
  const end = src.indexOf('\n];', start)
  const data = src.slice(start, end)
  return src.slice(0, start) + data.replace(/^\s*color: "#[0-9A-Fa-f]{6}",$/gm, '') + src.slice(end)
}

const SURFACES: Array<[string, () => string]> = [
  [DASH, dashChrome],
  [DASH_CSS, () => strip(read(DASH_CSS))],
  [WIZ, () => strip(read(WIZ))],
  [ONB_CSS, () => strip(read(ONB_CSS))],
  ...STEPS.map(p => [p, () => strip(read(p))] as [string, () => string]),
]

const FORBIDDEN: Array<[string, RegExp]> = [
  ['white-alpha neutral', /rgba\(\s*255\s*,\s*255\s*,\s*255/i],
  ['any rgba()/rgb() literal', /\brgba?\(\s*\d/i],
  ['any hex colour literal', /#[0-9A-Fa-f]{3,8}\b(?![-\w])/],
  ['old violet chrome', /#(A78BFA|C4B5FD|8B5CF6|7C3AED|6D28D9|a5b4fc|818CF8|6366F1)\b/i],
  ['colorScheme dark', /colorScheme\s*:\s*['"]dark|color-scheme\s*:\s*dark/i],
  ['backdrop blur / glass', /backdrop-?filter|backdropFilter|blur\(/i],
  ['decorative gradient', /(linear|radial|conic)-gradient/i],
  ['glow / shadow chrome', /box-?shadow|boxShadow|text-shadow|textShadow/i],
  ['local font stack', /--font-inter|["']Inter["']|-apple-system|fontFamily/],
  ['outline suppression', /outline\s*:\s*['"]?(none|0)\b/i],
  ['Tailwind dark-only class', /\b(text-white|bg-black|bg-\[#|text-\[#|border-white)/],
  ['styled-jsx global island', /<style jsx|<style>\{/],
  ['JS hover styling', /onMouseEnter|onMouseLeave|onFocus=\{e => \{ e\.currentTarget\.style/],
]

describe('Dashboards + onboarding — no legacy dark-island chrome', () => {
  for (const [file, load] of SURFACES) {
    it(`${file} uses tokens only`, () => {
      const src = load()
      for (const [why, re] of FORBIDDEN) expect(src, `${file}: ${why}`).not.toMatch(re)
    })
  }
})

describe('/dashboards — data identity kept, behaviour preserved', () => {
  const src = strip(read(DASH))
  const css = strip(read(DASH_CSS))

  it('module identity colours are unchanged and applied as --module-color on the icon tile only', () => {
    const colors = [...src.matchAll(/^\s*color: "(#[0-9A-Fa-f]{6})",$/gm)].map(m => m[1])
    expect(colors).toEqual(MODULE_COLORS)
    expect(src).toContain('style={{ "--module-color": dashboard.color } as ModuleStyle}')
    expect(css).toMatch(/\.iconBox \{[^}]*color: color-mix\(in srgb, var\(--module-color\) \d+%, var\(--text-primary\)\)/)
    // Text never takes the raw module hue.
    expect(css).not.toMatch(/\n\s*color:\s*var\(--module-color\)/)
  })

  it('every module href, category and the filter/footer wiring is unchanged', () => {
    const hrefs = [...src.matchAll(/href: "([^"]+)"/g)].map(m => m[1])
    expect(hrefs).toEqual(['/dashboard/waste', '/dashboard/fleet', '/dashboard/logistics', '/dashboard/construction', '/dashboard/roads', '/dashboard/water', '/dashboard/parks', '/dashboard/facilities', '/dashboard/depot', '/dashboard/supply', '/dashboard/labour', '/dashboard/environment', '/dashboard/wste'])
    expect(src).toMatch(/const CATEGORIES = \[\s*"All",\s*"Local Government",\s*"Logistics & Transport",\s*"Construction",\s*"Utilities",\s*"Commercial",\s*\];/)
    expect(src).toContain('onClick={() => setActiveCategory(category)}')
    expect(src).toContain('aria-pressed={active}')
    expect(src).toContain('<Link href="/command" {...buttonProps("primary")}>')
    expect(src).toContain('<Link href="/" {...buttonProps("secondary")}>')
    expect(src).toContain('<CommandCentreHero />')
  })

  it('one page h1 (visually hidden; the hero and sections keep their h2s)', () => {
    expect((src.match(/<h1\b/g) ?? []).length).toBe(1)
    expect(src).toContain('<h1 className="bb-visually-hidden">Dashboards</h1>')
  })

  it('filter selected state = raised segment + accent border/text, never outline or accent-muted', () => {
    const i = css.indexOf(".filter[aria-pressed='true'] {")
    const rule = css.slice(i, css.indexOf('}', i))
    expect(rule).toMatch(/background:\s*var\(--bg-surface\)/)
    expect(rule).toMatch(/border-color:\s*var\(--brand-brainbase-accent-border\)/)
    expect(rule).toMatch(/color:\s*var\(--brand-brainbase-accent\)/)
    expect(rule).not.toMatch(/outline|accent-muted/)
  })

  it('responsive + reduced motion', () => {
    expect(css).toContain('@media (max-width: 560px)')
    expect(css).toContain('grid-template-columns: minmax(0, 1fr);')
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
  })
})

describe('/onboarding — one workflow, behaviour preserved', () => {
  const wiz = strip(read(WIZ))
  const css = strip(read(ONB_CSS))
  const step = (n: number) => strip(read(STEPS[n - 1]))

  it('wizard keeps its step order, persistence, fetch URLs/methods and header offset', () => {
    expect(wiz).toMatch(/\{ id: 1, label: 'Organisation' \},\s*\{ id: 2, label: 'Data Sources' \},\s*\{ id: 3, label: 'Waste Data' \},\s*\{ id: 4, label: 'Fleet Data' \},\s*\{ id: 5, label: 'Questions' \},\s*\{ id: 6, label: 'Goals' \},\s*\{ id: 7, label: 'Review' \},/)
    expect(wiz).toContain("function storageKey(orgId: string) { return `bb_onboarding_${orgId}`; }")
    expect(wiz).toContain("fetch('/api/onboarding/progress')")
    expect(wiz).toMatch(/fetch\('\/api\/onboarding\/progress', \{\s*method: 'POST',/)
    expect(wiz).toMatch(/fetch\('\/api\/onboarding\/submit', \{\s*method: 'POST',[\s\S]*body: JSON\.stringify\(\{ data: formData \}\)/)
    expect(wiz).toContain('setTimeout(() => { setStep(nextStep); setVisible(true); }, 180);')
    expect(wiz).toContain("from '@/lib/layout/headerOffset'")
    expect(wiz).toContain('style={{ top: APP_HEADER_OFFSET_VAR }}')
    for (let n = 1; n <= 7; n++) expect(wiz).toContain(`{step === ${n} && <Step`)
  })

  it('one page h1 per state; progress list exposes aria-current="step"', () => {
    expect((wiz.match(/<h1\b/g) ?? []).length).toBe(2) // wizard + success screen, mutually exclusive
    expect(wiz).toContain("aria-current={step === s.id ? 'step' : undefined}")
    expect(wiz).toMatch(/className=\{styles\.track\} aria-hidden="true"/)
    for (let n = 1; n <= 7; n++) expect(step(n)).not.toMatch(/<h1\b/)
  })

  it('forms use the shared Field + fieldControlClassName; validation unchanged', () => {
    const s1 = step(1)
    expect((s1.match(/<Field /g) ?? []).length).toBe(3)
    expect((s1.match(/className=\{fieldControlClassName\}/g) ?? []).length).toBe(3)
    expect(s1).toContain("else if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(form.contactEmail)) e.contactEmail = 'Invalid email';")
    expect(s1).toContain("error={errors.councilName || undefined}")
    const s5 = step(5)
    expect(s5).toMatch(/<Field key=\{q\.key\} label=\{q\.label\}>/)
    expect(s5).toContain('className={fieldControlClassName}')
  })

  it('selections are pressed buttons with the same toggle handlers', () => {
    expect(step(2)).toContain('onClick={() => setForm(f => ({ ...f, systems: toggle(f.systems, s.id) }))}')
    expect(step(2)).toContain('onClick={() => setForm(f => ({ ...f, fileTypes: toggle(f.fileTypes, ft.id) }))}')
    expect(step(6)).toContain('onClick={() => setForm(f => ({ ...f, goals: toggle(f.goals, g.id) }))}')
    for (const n of [2, 6]) expect(step(n)).toContain('aria-pressed={checked}')
    const i = css.indexOf(".option[aria-pressed='true'] {")
    const rule = css.slice(i, css.indexOf('}', i))
    expect(rule).toMatch(/background:\s*var\(--bg-surface\)/)
    expect(rule).toMatch(/border-color:\s*var\(--brand-brainbase-accent-border\)/)
    expect(rule).not.toMatch(/outline|box-shadow/)
  })

  it('upload keeps drag/drop + picker wiring on a real button and the same upload request', () => {
    for (const [n, kind] of [[3, 'waste'], [4, 'fleet']] as const) {
      const s = step(n)
      expect(s).toContain(`fd.append('serviceType', '${kind}');`)
      expect(s).toContain("await fetch('/api/onboarding/upload', { method: 'POST', body: fd });")
      expect(s).toMatch(/<button\s+type="button"\s+className=\{styles\.dropzone\}/)
      for (const h of ['onDragOver={e => { e.preventDefault(); setDragging(true); }}', 'onDragLeave={() => setDragging(false)}', 'onDrop={handleDrop}', 'onClick={() => fileRef.current?.click()}'])
        expect(s).toContain(h)
      expect(s).toContain('accept=".csv,.xlsx,.xls"')
      expect(s).toContain('{uploadError && <FormError>{uploadError}</FormError>}')
    }
    expect(step(3)).toMatch(/<select\s+aria-label=\{f\.label\}/)
  })

  it('review uses Panels (h3) and description lists; submit wiring unchanged', () => {
    const s7 = step(7)
    expect(s7).toContain('<Panel title={title} titleAs="h3">')
    expect(s7).toContain('<dt className={styles.reviewLabel}>{label}</dt>')
    expect(s7).toMatch(/<Button variant="primary" onClick=\{onSubmit\} disabled=\{submitting\}/)
    expect(s7).toContain('<Button variant="secondary" onClick={onBack}>')
  })

  it('reduced motion + phone layout', () => {
    expect(css).toContain('@media (prefers-reduced-motion: reduce)')
    expect(css).toMatch(/@media \(max-width: 560px\)[\s\S]*\.twoCol \{\s*grid-template-columns: minmax\(0, 1fr\);/)
  })
})
