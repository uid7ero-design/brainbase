import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// SEC-1B2 — structural regression proof for the ten high-risk read/proxy/
// admin routes hardened in this phase. Each previously gated on a raw
// getSession() call plus a manual, JWT-only role-string comparison
// (`session.role !== 'super_admin'`), never re-validated against the DB:
// a disabled, demoted, reassigned, or deleted super_admin's still-valid
// JWT could keep reading cross-organisation agent-run data, invoking
// privileged agents, reading founder-only pipeline/intelligence/state
// data, or triggering founder-pipeline mutations via the external
// backend proxy. All ten now gate on requireRole('super_admin')
// (lib/org.ts), which re-reads the caller's current role/organisation/
// status from the database on every call. This file proves none of the
// ten has silently regressed back to the raw JWT-only pattern.

const ROUTES: { label: string; path: string }[] = [
  { label: 'admin/agent-runs', path: 'app/api/admin/agent-runs/route.ts' },
  { label: 'agents/route-test', path: 'app/api/agents/route-test/route.ts' },
  { label: 'admin/founder-clients', path: 'app/api/admin/founder-clients/route.ts' },
  { label: 'admin/founder-intelligence', path: 'app/api/admin/founder-intelligence/route.ts' },
  { label: 'admin/founder-state', path: 'app/api/admin/founder-state/route.ts' },
  { label: 'admin/founder-action/add-lead', path: 'app/api/admin/founder-action/add-lead/route.ts' },
  { label: 'admin/founder-action/advance-client-stage', path: 'app/api/admin/founder-action/advance-client-stage/route.ts' },
  { label: 'admin/founder-action/follow-up-client', path: 'app/api/admin/founder-action/follow-up-client/route.ts' },
  { label: 'admin/founder-action/log-demo', path: 'app/api/admin/founder-action/log-demo/route.ts' },
  { label: 'admin/founder-action/mark-analysis-reviewed', path: 'app/api/admin/founder-action/mark-analysis-reviewed/route.ts' },
]

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

// Strips `//` and `/* */` comments so the "no manual role-string
// comparison" check below can't false-positive on this hotfix's own
// explanatory comments, several of which legitimately quote the OLD
// `session.role !== 'super_admin'` pattern in prose to describe what
// changed (same technique established in SEC-1B1's
// adminMigrationRoutesAuthoritativeGate.test.ts).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('SEC-1B2 — the ten hardened high-risk routes all gate on requireRole(), never raw getSession()', () => {
  for (const route of ROUTES) {
    describe(route.label, () => {
      const source = read(route.path)
      const code = stripComments(source)

      it('does not import getSession from @/lib/session', () => {
        expect(code).not.toMatch(/import\s*\{[^}]*getSession[^}]*\}\s*from\s*'@\/lib\/session'/)
      })

      it("imports and calls requireRole('super_admin') from @/lib/org", () => {
        expect(code).toContain("import { requireRole } from '@/lib/org'")
        expect(code).toContain("requireRole('super_admin')")
      })

      it('never trusts a manual JWT role-string comparison in executable code (no `.role !==`, no `.role?.toLowerCase() ===`, no `.includes(session.role)`)', () => {
        expect(code).not.toMatch(/session\.role\s*!==/)
        expect(code).not.toMatch(/session\.role\??\.toLowerCase\(\)\s*===/)
        expect(code).not.toMatch(/\.includes\(session\.role\)/)
        expect(code).not.toMatch(/\[\s*'admin'\s*,\s*'super_admin'\s*\]/)
      })

      it("the requireRole('super_admin') call is wrapped so a thrown auth error yields 403, not an unhandled rejection", () => {
        expect(code).toMatch(
          /try\s*\{\s*session\s*=\s*await\s*requireRole\('super_admin'\)\s*;?\s*\}\s*catch\s*\{\s*return forbidden\(\)\s*;?\s*\}/,
        )
      })
    })
  }
})
