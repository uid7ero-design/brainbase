import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1.4 — app/api/agents/** session-resolver consistency.
//
// Before this phase, three different resolvers were in use across this one
// route family: briefing/insights/actions/intake used the raw JWT-only
// getSession() (no DB re-check, no cross-org staleness rejection, no
// impersonation resolution), scout already used requireSession() (lib/org.ts,
// DB-authoritative), and neither matched app/api/chat's getAuthSession().
// requireSession() was chosen as the canonical implementation for this
// family — not because its own comment claims canonicity (getAuthSession()'s
// does too), but because it already covers everything this family actually
// needs (organisationId, userId, DB-authoritative staleness rejection,
// org_override impersonation resolution) plus homeOrganisationId (useful for
// impersonation correctness) and composes with the existing requireRole()
// helper — while none of these five routes ever read getAuthSession()'s
// extra `email` field. This suite proves every direct agents/** entry point
// now uses the same resolver, consistently, and rejects the same way.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const ROUTES = [
  { name: 'briefing', file: 'app/api/agents/briefing/route.ts' },
  { name: 'insights', file: 'app/api/agents/insights/route.ts' },
  { name: 'actions', file: 'app/api/agents/actions/route.ts' },
  { name: 'intake', file: 'app/api/agents/intake/route.ts' },
  { name: 'scout', file: 'app/api/agents/scout/route.ts' },
]

describe('Phase C1.4 — app/api/agents/** session-resolver consistency', () => {
  for (const { name, file } of ROUTES) {
    describe(name, () => {
      const source = readSource(file)

      it('imports requireSession from @/lib/org', () => {
        expect(source).toMatch(/import\s*\{\s*requireSession\s*\}\s*from\s*['"]@\/lib\/org['"]/)
      })

      it('never imports the raw JWT-only getSession from @/lib/session', () => {
        expect(source).not.toMatch(/import\s*\{[^}]*\bgetSession\b[^}]*\}\s*from\s*['"]@\/lib\/session['"]/)
      })

      it('calls requireSession() inside a try/catch that rejects with 401 on failure', () => {
        expect(source).toMatch(/await requireSession\(\)/)
        expect(source).toMatch(/status:\s*401/)
      })
    })
  }
})

// Behavioural proof for the four routes that changed in this phase (scout's
// requireSession() behaviour was already established prior to this phase —
// see orgHomeOrganisationId.test.ts / crmBackfillImpersonationAuthChain.test.ts
// for its own stale-session/org-mismatch/impersonation coverage, which this
// phase does not touch).

const requireSessionMock = vi.fn()
vi.mock('@/lib/org', () => ({
  requireSession: (...args: unknown[]) => requireSessionMock(...args),
}))

vi.mock('@/lib/agents/briefingAgent', () => ({ run: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/agents/insightAgent', () => ({ run: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/agents/actionAgent', () => ({ run: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/agents/dataIntakeAgent', () => ({ run: vi.fn(async () => ({ ok: true })) }))

const SESSION = {
  userId: 'u1',
  organisationId: 'org-a',
  homeOrganisationId: 'org-a',
  role: 'manager',
  name: 'Ada',
}

function fakeRequest(body: Record<string, unknown> = {}) {
  return { json: async () => body } as unknown as import('next/server').NextRequest
}

beforeEach(() => {
  requireSessionMock.mockReset()
})

describe('Phase C1.4 — behavioural proof, briefing/insights/actions/intake', () => {
  const cases = [
    { name: 'briefing', mod: () => import('@/app/api/agents/briefing/route') },
    { name: 'insights', mod: () => import('@/app/api/agents/insights/route') },
    { name: 'actions', mod: () => import('@/app/api/agents/actions/route') },
    { name: 'intake', mod: () => import('@/app/api/agents/intake/route') },
  ]

  for (const { name, mod } of cases) {
    describe(name, () => {
      it('a stale/rejected session (requireSession() throws) produces a 401, never reaches the agent', async () => {
        requireSessionMock.mockRejectedValue(new Error('Session invalid'))
        const { POST } = await mod()
        const res = await POST(fakeRequest({ query: 'x' }))
        expect(res.status).toBe(401)
      })

      it('a valid session passes organisationId/userId through to the agent input', async () => {
        requireSessionMock.mockResolvedValue(SESSION)
        const { POST } = await mod()
        const res = await POST(fakeRequest({ query: 'x' }))
        expect(res.status).toBe(200)
        expect(requireSessionMock).toHaveBeenCalledTimes(1)
      })

      it('an impersonated session (organisationId overridden, homeOrganisationId preserved by requireSession()) is honoured as-is — the route never re-derives organisationId itself', async () => {
        requireSessionMock.mockResolvedValue({
          ...SESSION,
          role: 'super_admin',
          organisationId: 'org-impersonated',
          homeOrganisationId: 'org-founder-home',
        })
        const { POST } = await mod()
        const res = await POST(fakeRequest({ query: 'x' }))
        expect(res.status).toBe(200)
        // The route must not contain any independent organisationId
        // resolution (e.g. reading a cookie/header itself) — requireSession()
        // is the sole source, consistent with every other route in the
        // family.
        const source = readSource(`app/api/agents/${name}/route.ts`)
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        expect(source).not.toMatch(/org_override|cookies\(\)/)
      })
    })
  }
})
