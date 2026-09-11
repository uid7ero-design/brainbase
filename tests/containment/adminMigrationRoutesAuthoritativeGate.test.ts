import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// SEC-1B1 — structural regression proof for all four routes hardened in
// this phase. Each previously gated on a raw getSession() call plus a
// manual, JWT-only role-string comparison, which never re-validated
// against the DB: a disabled, demoted, reassigned, or deleted user's
// still-valid JWT could keep executing schema migrations, session
// migrations, CRM classification migrations, or destructive demo-data
// reseeding. All four now gate on requireRole() (lib/org.ts), which
// re-reads the caller's current role/organisation assignment from the
// database on every call. This file proves none of the four has silently
// regressed back to the raw JWT-only pattern.

const ROUTES: { label: string; path: string; minRole: string }[] = [
  { label: 'admin/migrate', path: 'app/api/admin/migrate/route.ts', minRole: 'super_admin' },
  { label: 'admin/migrate-sessions', path: 'app/api/admin/migrate-sessions/route.ts', minRole: 'super_admin' },
  { label: 'admin/migrate/crm-contact-classification', path: 'app/api/admin/migrate/crm-contact-classification/route.ts', minRole: 'super_admin' },
  { label: 'admin/seed-demo', path: 'app/api/admin/seed-demo/route.ts', minRole: 'admin' },
]

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

// Strips `//` and `/* */` comments so the "no manual role-string
// comparison" check below can't false-positive on this hotfix's own
// explanatory comments, several of which legitimately quote the OLD
// `session.role !== 'super_admin'` / `.includes(session.role)` pattern in
// prose to describe what changed. This is a narrow, string-literal-naive
// stripper (adequate for these route files, which contain no `//` or
// `/*`/`*/` sequences inside string or template literals).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('SEC-1B1 — the four hardened admin routes all gate on requireRole(), never raw getSession()', () => {
  for (const route of ROUTES) {
    describe(route.label, () => {
      const source = read(route.path)
      const code = stripComments(source)

      it('does not import getSession from @/lib/session', () => {
        expect(code).not.toMatch(/import\s*\{[^}]*getSession[^}]*\}\s*from\s*'@\/lib\/session'/)
      })

      it(`imports and calls requireRole('${route.minRole}') from @/lib/org`, () => {
        expect(code).toContain("import { requireRole } from '@/lib/org'")
        expect(code).toContain(`requireRole('${route.minRole}')`)
      })

      it('never trusts a manual JWT role-string comparison (no `.role !==` / `.includes(session.role)` gate) in executable code', () => {
        expect(code).not.toMatch(/session\.role\s*!==/)
        expect(code).not.toMatch(/\.includes\(session\.role\)/)
      })

      it('the requireRole() call is wrapped so a thrown auth error yields 403, not an unhandled rejection', () => {
        const escapedRole = route.minRole.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        expect(code).toMatch(new RegExp(
          `try\\s*\\{\\s*session\\s*=\\s*await\\s*requireRole\\('${escapedRole}'\\)\\s*;?\\s*\\}\\s*catch\\s*\\{\\s*return forbidden\\(\\)\\s*;?\\s*\\}`,
        ))
      })
    })
  }
})
