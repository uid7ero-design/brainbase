import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// SEC-1B3 — structural regression proof for the sixteen self-scoped
// routes hardened in this phase. Each previously gated on a raw
// getSession() call, a JWT-only claim never revalidated against the DB: a
// disabled, deleted, or since-reassigned user's still-valid JWT could
// keep reading/writing their own profile, avatar, onboarding progress,
// briefings, social connections, uploads, or waste-service verification
// under their old identity/organisation. All sixteen now gate on
// requireSession() (lib/org.ts), which re-reads the caller's current
// role/organisation/status from the database on every call. This file
// proves none of the sixteen has silently regressed back to the raw
// JWT-only pattern.
//
// app/api/me/route.ts is deliberately excluded — it was already
// converted to requireSession() in an earlier phase (Phase C1.3/F.6F),
// before SEC-1B3 began; no change was needed or made to it here.

const ROUTES: { label: string; path: string; usesSessionVar: boolean }[] = [
  { label: 'account/avatar', path: 'app/api/account/avatar/route.ts', usesSessionVar: true },
  { label: 'account/profile', path: 'app/api/account/profile/route.ts', usesSessionVar: true },
  { label: 'auth/refresh', path: 'app/api/auth/refresh/route.ts', usesSessionVar: true },
  { label: 'auth/verify-lock', path: 'app/api/auth/verify-lock/route.ts', usesSessionVar: true },
  { label: 'briefings', path: 'app/api/briefings/route.ts', usesSessionVar: true },
  { label: 'onboarding/progress', path: 'app/api/onboarding/progress/route.ts', usesSessionVar: true },
  { label: 'onboarding/submit', path: 'app/api/onboarding/submit/route.ts', usesSessionVar: true },
  { label: 'onboarding/upload', path: 'app/api/onboarding/upload/route.ts', usesSessionVar: true },
  { label: 'social/analyse', path: 'app/api/social/analyse/route.ts', usesSessionVar: true },
  { label: 'social/callback', path: 'app/api/social/callback/route.ts', usesSessionVar: true },
  { label: 'social/connect', path: 'app/api/social/connect/route.ts', usesSessionVar: false },
  { label: 'social/insights', path: 'app/api/social/insights/route.ts', usesSessionVar: true },
  { label: 'social/posts', path: 'app/api/social/posts/route.ts', usesSessionVar: true },
  { label: 'social/sync', path: 'app/api/social/sync/route.ts', usesSessionVar: true },
  { label: 'tennis/blog/upload-image', path: 'app/api/tennis/blog/upload-image/route.ts', usesSessionVar: false },
  { label: 'wste/verify', path: 'app/api/wste/verify/route.ts', usesSessionVar: true },
]

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n')
}

// Strips `//` and `/* */` comments so the "no raw getSession() import"
// check below can't false-positive on this hotfix's own explanatory
// comments, several of which legitimately quote the OLD pattern in prose
// to describe what changed (same technique established in SEC-1B1's/
// SEC-1B2's own *AuthoritativeGate.test.ts files).
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('SEC-1B3 — the sixteen hardened self-scoped routes all gate on requireSession(), never raw getSession()', () => {
  for (const route of ROUTES) {
    describe(route.label, () => {
      const source = read(route.path)
      const code = stripComments(source)

      it('does not import getSession from @/lib/session', () => {
        expect(code).not.toMatch(/import\s*\{[^}]*getSession[^}]*\}\s*from\s*'@\/lib\/session'/)
      })

      it("imports requireSession from @/lib/org and calls it", () => {
        expect(code).toContain("import { requireSession } from '@/lib/org'")
        expect(code).toMatch(/await requireSession\(\)/)
      })

      it('never uses requireRole() — this is a self-scoped route, not an admin-gated one', () => {
        expect(code).not.toContain('requireRole(')
      })

      it('the requireSession() call is wrapped in try/catch so a thrown auth error yields a controlled response, not an unhandled rejection', () => {
        const pattern = route.usesSessionVar
          ? /try\s*\{\s*session\s*=\s*await\s*requireSession\(\)\s*;?\s*\}\s*catch\s*\{/
          : /try\s*\{\s*await\s*requireSession\(\)\s*;?\s*\}\s*catch\s*\{/
        expect(code).toMatch(pattern)
      })
    })
  }
})

describe('SEC-1B3 — app/api/me/route.ts was already converted before this phase and needed no change', () => {
  it('still uses requireSession(), not raw getSession(), as its gate', () => {
    const source = read('app/api/me/route.ts')
    const code = stripComments(source)
    expect(code).not.toMatch(/import\s*\{[^}]*getSession[^}]*\}\s*from\s*'@\/lib\/session'/)
    expect(code).toContain("import { requireSession } from '@/lib/org'")
  })
})
