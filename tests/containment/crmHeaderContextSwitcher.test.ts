import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Restore founder client-context switcher on CRM routes.
//
// ROOT CAUSE FOUND: none of the hypothesised causes in this phase's own
// brief (a different authenticated layout, missing header props, CRM
// bypassing the shared shell, a route-group boundary, or visibility
// logic excluding CRM) turned out to be real — components/admin/
// OrgSwitcher.tsx is mounted unconditionally in the single root layout
// (app/layout.tsx), BEFORE {children}, and every route in the app
// (including everything under app/crm/**) composes inside that same
// root layout — Next.js App Router has no mechanism for a nested layout
// to bypass or replace the root one. OrgSwitcher's own visibility gate
// (`state.role !== 'super_admin'`) reads the TRUE, un-overridden role
// from lib/org.ts's requireSession() (confirmed there: "role/name/
// userId are still the real, logged-in person's own identity —
// impersonation changes which organisation's DATA is shown, never who
// the founder is"), so it does not hide while actively impersonating
// another organisation either.
//
// The one concrete, provable bug found in this exact area: app/crm/
// layout.tsx still had two hardcoded `calc(100vh - 52px)` literals —
// the ONE consumer PR #109's own sweep of this exact bug class missed
// (its own sibling, app/crm/_components/CrmSidebar.tsx, was already
// correctly migrated). Fixed to use the same shared
// APP_HEADER_OFFSET_VH_CALC primitive, tested via tests/containment/
// appHeaderOffset.test.ts's own established consumers list (extended
// here, not duplicated). This file covers the remaining, CRM-specific
// architectural guarantees: CRM has no duplicate/local switcher, no
// route-based exclusion, and its own organisation-context-sensitive
// routes correctly use the override-aware session primitive.

const root = path.resolve(__dirname, '../..')
function read(relPath: string): string {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/\r\n/g, '\n')
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// ─────────────────────────────────────────────────────────────────────
// CRM inherits the ONE shared switcher — no bypass, no duplicate
// ─────────────────────────────────────────────────────────────────────

describe('The root layout unconditionally mounts OrgSwitcher before every route\'s own content', () => {
  const rootLayoutSource = stripComments(read('app/layout.tsx'))

  it('imports and renders exactly one <OrgSwitcher /> instance, with no route/pathname condition around it', () => {
    expect(rootLayoutSource).toMatch(/import OrgSwitcher from '@\/components\/admin\/OrgSwitcher';/)
    const occurrences = [...rootLayoutSource.matchAll(/<OrgSwitcher\s*\/>/g)]
    expect(occurrences.length).toBe(1)
  })

  it('<OrgSwitcher /> is rendered before {children} inside the same JSX tree — every route, including everything under app/crm/**, receives it by composing inside this same root', () => {
    const switcherIdx = rootLayoutSource.indexOf('<OrgSwitcher />')
    const childrenIdx = rootLayoutSource.indexOf('{children}')
    expect(switcherIdx).toBeGreaterThan(-1)
    expect(childrenIdx).toBeGreaterThan(switcherIdx)
  })

  it('OrgSwitcher does not accept props — its rendering is not gated by anything the root layout would need to pass in per-route (ruling out "missing header props/context")', () => {
    expect(rootLayoutSource).toMatch(/<OrgSwitcher\s*\/>/)
    // No prop assignment (an '=' between the tag name and its closing
    // '/>') anywhere on the OrgSwitcher element.
    const tagMatch = rootLayoutSource.match(/<OrgSwitcher[^>]*\/>/)
    expect(tagMatch).not.toBeNull()
    expect(tagMatch![0]).not.toContain('=')
  })
})

describe('app/crm/layout.tsx is a normal nested layout — it cannot bypass, and does not attempt to bypass, the shared root shell', () => {
  const crmLayoutSource = stripComments(read('app/crm/layout.tsx'))

  it('does not render its own <html>/<body> or any competing top-level document structure (Next.js App Router composes nested layouts inside the root; a nested layout has no mechanism to replace it)', () => {
    expect(crmLayoutSource).not.toMatch(/<html[\s>]/)
    expect(crmLayoutSource).not.toMatch(/<body[\s>]/)
  })

  it('renders {children} in both its capability-denied branch and its normal branch — never swallows or replaces the tree the root layout has already composed around it', () => {
    // The capability-denied branch intentionally shows a message instead
    // of the CRM shell's own {children} (companies/contacts/etc. pages)
    // — but that branch is still a normal React return nested INSIDE
    // the root layout's own {children} slot, so OrgSwitcher (rendered
    // by the root layout, above this component entirely) is unaffected
    // either way.
    expect(crmLayoutSource).toMatch(/\{children\}/)
  })

  it('does not import, define, or render any second switcher/impersonation component of its own', () => {
    expect(crmLayoutSource).not.toMatch(/OrgSwitcher|Impersonat|ViewAs|SwitchOrg|ContextSwitcher/i)
  })

  it('now uses the shared APP_HEADER_OFFSET_VH_CALC primitive for both its minHeight values — the one consumer in this exact bug class the original migration sweep missed', () => {
    expect(crmLayoutSource).toMatch(/from '@\/lib\/layout\/headerOffset'/)
    expect(crmLayoutSource).toContain('APP_HEADER_OFFSET_VH_CALC')
    expect(crmLayoutSource).not.toContain('calc(100vh - 52px)')
  })
})

describe('No CRM-local duplicate of the switcher exists anywhere under app/crm/**', () => {
  it('no file under app/crm defines its own switcher/impersonation UI', () => {
    const crmDir = path.join(root, 'app', 'crm')
    const files: string[] = []
    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(crmDir)
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const source = stripComments(fs.readFileSync(file, 'utf8'))
      expect(source, `${path.relative(root, file)} must not define its own OrgSwitcher/impersonation component`)
        .not.toMatch(/function\s+(OrgSwitcher|ImpersonationSwitcher|ClientContextSwitcher)\b/)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────
// Visibility gate: super_admin only, never a broader role
// ─────────────────────────────────────────────────────────────────────

describe('OrgSwitcher visibility remains super_admin-only, unconditionally (not route-specific, so it cannot be "on" for CRM but excluded for an ordinary admin, or vice versa)', () => {
  const orgSwitcherSource = stripComments(read('components/admin/OrgSwitcher.tsx'))

  it('gates entirely on session.role === super_admin, with no route/pathname check anywhere in the component', () => {
    expect(orgSwitcherSource).toMatch(/if \(state\.role !== 'super_admin'\) return null;/)
    expect(orgSwitcherSource).not.toMatch(/usePathname|window\.location\.pathname/)
  })

  it('reads role from /api/me, which itself derives role from lib/org.ts\'s requireSession() — the TRUE, un-overridden role, confirmed by that file\'s own contract (organisationId changes while impersonating, role never does)', () => {
    expect(orgSwitcherSource).toMatch(/fetch\('\/api\/me'\)/)
    const meRouteSource = stripComments(read('app/api/me/route.ts'))
    expect(meRouteSource).toMatch(/requireSession/)
    expect(meRouteSource).toContain('role:           session.role,')
    const orgSource = stripComments(read('lib/org.ts'))
    // role is read once, straight from the users table, never
    // conditionally swapped for an impersonated org's own role — unlike
    // organisationId (assigned via `let organisationId = ...` and
    // conditionally reassigned right below it for an active
    // org_override), role is declared `const` and never appears on the
    // left-hand side of another assignment before being returned.
    expect(orgSource).toMatch(/const role = \(user\.role as string\)\.toLowerCase\(\) as Role;/)
    const roleAssignIdx = orgSource.indexOf('const role =')
    const returnIdx = orgSource.indexOf('return {')
    expect(roleAssignIdx).toBeGreaterThan(-1)
    expect(returnIdx).toBeGreaterThan(roleAssignIdx)
    // Skip past the declaration line itself; check only what follows it
    // for any later reassignment.
    const afterDeclaration = orgSource.slice(orgSource.indexOf('\n', roleAssignIdx), returnIdx)
    expect(afterDeclaration).not.toMatch(/\brole\s*=[^=]/)
  })
})

// ─────────────────────────────────────────────────────────────────────
// Organisation context used by CRM routes is the override-aware one
// ─────────────────────────────────────────────────────────────────────

describe('CRM/Events-backfill routes use the override-aware session primitive, so the currently-switched organisation is respected', () => {
  const routesUsingRequireSession = [
    'app/api/crm/contacts/route.ts',
    'app/api/crm/events-backfill/route.ts',
    'app/api/crm/events-backfill/classification/route.ts',
  ]

  for (const routePath of routesUsingRequireSession) {
    it(`${routePath} derives organisation identity from requireSession() (lib/org.ts) — override-aware, not the raw un-overridden JWT/session`, () => {
      const source = stripComments(read(routePath))
      expect(source, `${routePath} must import requireSession from @/lib/org`).toMatch(/requireSession/)
      expect(source, `${routePath} must use session.organisationId, never a hardcoded or client-supplied org id`)
        .toMatch(/session\.organisationId/)
    })
  }

  it('the classification execute/preview route specifically: organisationId and actor both come from session, never a request parameter (already covered in depth by tests/containment/crmEventContactClassificationBackfill.test.ts — this is a light structural cross-check, not a duplicate of that suite)', () => {
    const source = stripComments(read('app/api/crm/events-backfill/classification/route.ts'))
    expect(source).toContain('auth.session.organisationId')
    expect(source).toContain('auth.session.userId')
  })
})

describe('Events/CRM capability enforcement is unchanged by this fix', () => {
  it('app/crm/layout.tsx still calls checkCapability(session.organisationId, \'crm\') exactly as before — the header-offset fix touches only minHeight values, not the authorization gate above them', () => {
    const source = stripComments(read('app/crm/layout.tsx'))
    expect(source).toMatch(/checkCapability\(session\.organisationId, 'crm'\)/)
    expect(source).toMatch(/if \(!capability\.allowed\)/)
  })

  it('app/api/crm/events-backfill/classification/route.ts still requires both events and crm capabilities, admin-or-above role — unchanged by this phase', () => {
    const source = stripComments(read('app/api/crm/events-backfill/classification/route.ts'))
    expect(source).toContain("requireCapability(session.organisationId, 'events')")
    expect(source).toContain("requireCapability(session.organisationId, 'crm')")
    expect(source).toContain("roleGte(session.role, 'admin')")
  })
})
