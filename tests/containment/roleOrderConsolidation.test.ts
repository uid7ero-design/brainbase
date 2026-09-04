import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { roleGte, ROLE_ORDER, type Role } from '@/lib/session'

// Phase C1.6 — role-order consolidation (lib/org.ts and middleware.ts
// previously maintained two independent copies of the manager+ ordering,
// one as ROLE_ORDER/roleGte(), one as middleware.ts's own hand-listed
// COMMAND_ROLES array — a real drift risk even though both happened to
// agree at the time) and the ANALYST/Role type-coherence fix (the real
// Postgres UserRole enum has 5 values; the app-layer Role type only
// recognised 4, so a user row genuinely holding role='ANALYST' would fail
// every requireRole()/roleGte() check via an accidental array .indexOf()
// === -1 quirk, not an intentional one).

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

describe('Phase C1.6 — single source of truth for role ordering', () => {
  it('lib/org.ts re-exports roleGte from lib/session.ts rather than defining its own copy', () => {
    const orgSource = readSource('lib/org.ts')
    expect(orgSource).toMatch(/import\s*\{[^}]*\broleGte\b[^}]*\}\s*from\s*['"]\.\/session['"]/)
    expect(orgSource).toMatch(/export\s*\{\s*roleGte\s*\}/)
    // The old, independently-defined ROLE_ORDER/roleGte in this file must be gone.
    expect(orgSource).not.toMatch(/const ROLE_ORDER/)
    expect(orgSource).not.toMatch(/export function roleGte/)
  })

  it('middleware.ts imports roleGte from lib/session.ts and no longer hand-maintains its own COMMAND_ROLES list', () => {
    const middlewareSource = readSource('middleware.ts')
    const withoutComments = middlewareSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
    expect(middlewareSource).toMatch(/import\s*\{[^}]*\broleGte\b[^}]*\}\s*from\s*['"]@\/lib\/session['"]/)
    // The old array declaration/usage must be gone from live code — a
    // comment explaining the history (which mentions the old name) is fine.
    expect(withoutComments).not.toMatch(/COMMAND_ROLES/)
    expect(middlewareSource).toMatch(/roleGte\(role, 'manager'\)/)
    expect(middlewareSource).toMatch(/roleGte\(role, 'super_admin'\)/)
  })

  it('every consumer that previously imported roleGte from @/lib/org still resolves it (re-export, not a breaking rename)', () => {
    // Spot-check a few real, pre-existing consumers rather than every one.
    const consumers = [
      'lib/organiser/authorize.ts',
      'lib/events/authorize.ts',
      'app/organiser/layout.tsx',
    ]
    for (const file of consumers) {
      const source = readSource(file)
      expect(source).toMatch(/import\s*\{[^}]*\broleGte\b[^}]*\}\s*from\s*['"]@\/lib\/org['"]/)
    }
  })
})

describe('Phase C1.6 — Role/UserRole coherence', () => {
  it("lib/session.ts's Role type includes 'analyst', matching the real 5-value Postgres UserRole enum", () => {
    const sessionSource = readSource('lib/session.ts')
    expect(sessionSource).toMatch(/'super_admin'\s*\|\s*'admin'\s*\|\s*'manager'\s*\|\s*'viewer'\s*\|\s*'analyst'/)
  })

  it("ROLE_ORDER deliberately does NOT include 'analyst' — no privilege placement has been decided", () => {
    expect(ROLE_ORDER).toEqual(['viewer', 'manager', 'admin', 'super_admin'])
    expect(ROLE_ORDER).not.toContain('analyst')
  })

  it('roleGte() covers every valid role correctly for the four defined levels (unchanged behaviour)', () => {
    const levels: Role[] = ['viewer', 'manager', 'admin', 'super_admin']
    for (let i = 0; i < levels.length; i++) {
      for (let j = 0; j < levels.length; j++) {
        expect(roleGte(levels[i], levels[j])).toBe(i >= j)
      }
    }
  })

  it("roleGte('analyst', ...) fails closed against every defined role, including the lowest ('viewer') — never throws, never silently grants access", () => {
    expect(() => roleGte('analyst', 'viewer')).not.toThrow()
    expect(roleGte('analyst', 'viewer')).toBe(false)
    expect(roleGte('analyst', 'manager')).toBe(false)
    expect(roleGte('analyst', 'admin')).toBe(false)
    expect(roleGte('analyst', 'super_admin')).toBe(false)
  })

  it("roleGte(x, 'analyst') — an undefined MINIMUM — also fails closed (denies) for every role, not just an undefined role being checked. This is the asymmetric bug this suite caught during development: checking only the `role` side would let roleIdx (>= 0 for any real role) satisfy min's indexOf of -1, silently granting access to a threshold nobody defined", () => {
    expect(roleGte('viewer', 'analyst')).toBe(false)
    expect(roleGte('super_admin', 'analyst')).toBe(false)
    expect(roleGte('analyst', 'analyst')).toBe(false)
  })

  it('app/actions/auth.ts casts the DB role with no runtime validation — confirmed still true, documented as the reason this fix matters (not something this phase changes)', () => {
    const authSource = readSource('app/actions/auth.ts')
    expect(authSource).toMatch(/\(user\.role as string\)\.toLowerCase\(\) as Role/)
  })
})
