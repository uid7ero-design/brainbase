import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase C1.3 — repair of the obsolete `modules.id = organisation_modules.module_id`
// join pattern (modules has no `id` or `industry` column under the current
// schema; the canonical join is `modules.key = organisation_modules.module_key`,
// see scripts/create-modules.sql and lib/capabilities/requireCapability.ts).
//
// This pattern was found, independently copy-pasted, in eight places:
//   - app/api/account/modules/route.ts   — dead code, zero callers, REMOVED
//   - app/api/me/route.ts                — covered by apiMeCapabilityProjection.test.ts
//   - lib/agents/briefingAgent.ts         — covered here
//   - lib/agents/insightAgent.ts          — covered here
//   - app/api/hlna/briefing/route.ts      — covered here
//   - app/api/hlna/whatchanged/route.ts   — covered here
//   - app/account/profile/page.tsx        — covered here
//   - app/api/account/profile/route.ts    — covered here
//
// Every occurrence threw on every call, and every occurrence's catch block
// fell back to assuming behaviour that must instead fail CLOSED. This suite
// proves, per file, that (a) the broken join is gone, (b) the corrected join
// is present, (c) no fallback still assumes success/full access on error, and
// (d) app/api/account/modules/route.ts no longer exists.

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8')
}

const BROKEN_JOIN = /JOIN\s+modules\s+m\s+ON\s+m\.id\s*=\s*om\.module_id/i
const CORRECT_JOIN = /JOIN\s+modules\s+m\s+ON\s+m\.key\s*=\s*om\.module_key/i
const FAIL_OPEN_FALLBACK = /\[\s*['"]waste_recycling['"]\s*,\s*['"]fleet_management['"]\s*,\s*['"]service_requests['"]\s*\]/

describe('Phase C1.3 — module-entitlement query repair (fail-closed, correct schema)', () => {
  it('app/api/account/modules/route.ts no longer exists (confirmed orphaned: zero imports/fetch/dynamic references anywhere in the repo before removal)', () => {
    const routePath = path.resolve(__dirname, '../../app/api/account/modules/route.ts')
    expect(fs.existsSync(routePath)).toBe(false)
  })

  const cases: { label: string; file: string; failOpenFallback: RegExp | null }[] = [
    { label: 'lib/agents/briefingAgent.ts', file: 'lib/agents/briefingAgent.ts', failOpenFallback: FAIL_OPEN_FALLBACK },
    { label: 'lib/agents/insightAgent.ts', file: 'lib/agents/insightAgent.ts', failOpenFallback: FAIL_OPEN_FALLBACK },
    { label: 'app/api/hlna/briefing/route.ts', file: 'app/api/hlna/briefing/route.ts', failOpenFallback: FAIL_OPEN_FALLBACK },
    { label: 'app/api/hlna/whatchanged/route.ts', file: 'app/api/hlna/whatchanged/route.ts', failOpenFallback: FAIL_OPEN_FALLBACK },
    { label: 'app/account/profile/page.tsx', file: 'app/account/profile/page.tsx', failOpenFallback: null },
    { label: 'app/api/account/profile/route.ts', file: 'app/api/account/profile/route.ts', failOpenFallback: null },
  ]

  for (const { label, file, failOpenFallback } of cases) {
    describe(label, () => {
      const source = readSource(file)

      it('no longer contains the broken m.id = om.module_id join', () => {
        expect(source).not.toMatch(BROKEN_JOIN)
      })

      it('contains the corrected m.key = om.module_key join', () => {
        expect(source).toMatch(CORRECT_JOIN)
      })

      it('no longer references the nonexistent modules.industry column in a SELECT list', () => {
        // Comments referencing `.industry` for documentation purposes are fine;
        // a live SELECT projecting it is not. Strip comments before checking.
        const withoutComments = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        expect(withoutComments).not.toMatch(/m\.industry|m\.status\b/)
      })

      if (failOpenFallback) {
        it('the module-lookup catch block no longer assumes all modules enabled on failure', () => {
          expect(source).not.toMatch(failOpenFallback)
        })
      }
    })
  }

  it('briefingAgent.ts and insightAgent.ts fail closed to an empty array, not a hardcoded module list, when the entitlement query throws', () => {
    const briefing = readSource('lib/agents/briefingAgent.ts')
    const insight = readSource('lib/agents/insightAgent.ts')
    // The catch block immediately preceding the closing brace of
    // getEnabledModules must return an empty array.
    const briefingCatch = briefing.match(/catch\s*\{\s*return\s*(\[[^\]]*\])\s*;?\s*\}/)
    const insightCatch = insight.match(/catch\s*\{\s*return\s*(\[[^\]]*\])\s*;?\s*\}/)
    expect(briefingCatch?.[1]).toBe('[]')
    expect(insightCatch?.[1]).toBe('[]')
  })

  it('the two hlna route files assign an empty array (not a hardcoded module list) inside their module-lookup catch blocks', () => {
    const briefingRoute = readSource('app/api/hlna/briefing/route.ts')
    const whatchangedRoute = readSource('app/api/hlna/whatchanged/route.ts')
    expect(briefingRoute).toMatch(/catch\s*\(err\)\s*\{[\s\S]{0,120}moduleKeys\s*=\s*\[\];?/)
    expect(whatchangedRoute).toMatch(/catch\s*\{[\s\S]{0,60}moduleKeys\s*=\s*\[\];?/)
  })
})
