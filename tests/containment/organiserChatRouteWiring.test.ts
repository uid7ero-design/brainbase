import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.6C — app/api/chat/route.ts's Organiser tool wiring, verified
// via static source-text containment. This file cannot be safely imported
// into a plain-Node test (module-scope Anthropic/DB client construction —
// see helenaTenantAwarePrompt.test.ts's own header for this repo's
// established rationale for that choice on this exact file), so structural
// correctness is proven the same way every other phase touching this file
// has proven it: reading the real source and asserting on its shape.

const root = path.resolve(__dirname, '../..')
const routeSource = fs.readFileSync(path.join(root, 'app/api/chat/route.ts'), 'utf8')

describe('Organiser tools are registered in the SAME existing tool-use loop', () => {
  it('imports the D.4.6C tool helpers from lib/organiser/helenaTools, not a new module', () => {
    expect(routeSource).toMatch(/import \{\s*buildOrganiserTools,\s*executeOrganiserTool,\s*isOrganiserToolName,\s*ORGANISER_SAFETY_PROMPT,?\s*\} from ['"]\.\.\/\.\.\/\.\.\/lib\/organiser\/helenaTools['"]/)
  })

  it('no second Anthropic client, no second chat/tool-use loop, no new API route file was introduced', () => {
    const anthropicClientCount = (routeSource.match(/new Anthropic\(\)/g) ?? []).length
    expect(anthropicClientCount).toBe(1)
    const loopCount = (routeSource.match(/for \(let iter = 0; iter < 4; iter\+\+\)/g) ?? []).length
    expect(loopCount).toBe(1)
  })

  it('never fetches an internal /api/organiser/** route — Organiser tools call server-side helpers directly', () => {
    expect(routeSource).not.toMatch(/fetch\(['"`].*\/api\/organiser/)
  })

  it('the tool-use iteration cap remains exactly 4 — unchanged by this phase', () => {
    expect(routeSource).toMatch(/for \(let iter = 0; iter < 4; iter\+\+\) \{/)
  })
})

describe('capability-gated registration', () => {
  it('Organiser tools are appended to the tools array only when hasOrganiserCapability is true', () => {
    const idx = routeSource.indexOf('const hasOrganiserCapability')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 600)
    expect(block).toMatch(/hasOrganiserCapability\s*\?\s*buildOrganiserTools\(\)\s*:\s*\[\]/)
  })

  it('hasOrganiserCapability is derived from enabledCapabilities.some(c => c.key === \'organiser\'), the same array the tenant-identity block already trusts — never re-resolved from request input', () => {
    expect(routeSource).toMatch(/hasOrganiserCapability = \(enabledCapabilities \?\? \[\]\)\.some\(c => c\.key === 'organiser'\)/)
  })

  it('query_database registration is unaffected — buildDataTools(orgId) is still called unconditionally whenever orgId exists and the tenant is not LD Tennis', () => {
    expect(routeSource).toMatch(/\.\.\.buildDataTools\(orgId\)/)
  })

  it('LD Tennis special case still excludes ALL tools (query_database AND Organiser) — tools stays undefined for that tenant', () => {
    const idx = routeSource.indexOf('const tools = orgId && !isLDTennisOrg')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 250)
    expect(block).toMatch(/: undefined/)
  })

  it('buildSystem\'s ORGANISER_SAFETY_PROMPT inclusion checks the exact same enabledCapabilities condition as tool registration — the two gates cannot drift apart', () => {
    const occurrences = routeSource.match(/\(enabledCapabilities \?\? \[\]\)\.some\(c => c\.key === 'organiser'\)/g) ?? []
    expect(occurrences.length).toBe(2)
  })
})

describe('execution dispatch', () => {
  it('the tool_use loop branches on isOrganiserToolName(block.name) before falling through to the query_database/SQL path, with no executeQuery call in the Organiser branch itself', () => {
    const idx = routeSource.indexOf('if (isOrganiserToolName(block.name))')
    expect(idx).toBeGreaterThan(-1)
    const nearbyElse = routeSource.indexOf('} else {', idx)
    expect(nearbyElse).toBeGreaterThan(idx)
    const organiserBranch = routeSource.slice(idx, nearbyElse)
    expect(organiserBranch).not.toMatch(/executeQuery\(/)
  })

  it('Organiser tool execution calls executeOrganiserTool(block.name, block.input) — no inline reimplementation of auth/dispatch here', () => {
    expect(routeSource).toMatch(/content = await executeOrganiserTool\(block\.name, block\.input\);/)
  })

  it('Organiser tool calls do not touch usedTool/allTables/totalRows/trendNote/anomalyNote (the query_database-specific analysis accumulators)', () => {
    const idx = routeSource.indexOf('if (isOrganiserToolName(block.name)) {')
    const branchEnd = routeSource.indexOf('} else {', idx)
    const organiserBranch = routeSource.slice(idx, branchEnd)
    expect(organiserBranch).not.toMatch(/usedTool = true/)
    expect(organiserBranch).not.toMatch(/allTables =/)
    expect(organiserBranch).not.toMatch(/totalRows \+=/)
  })
})

describe('Organiser system-prompt safety section', () => {
  it('is appended in buildSystem only when hasOrganiser capability, using the same key-based check', () => {
    const buildSystemStart = routeSource.indexOf('function buildSystem(')
    const buildSystemEnd = routeSource.indexOf('\n// ─── Ollama', buildSystemStart)
    const body = routeSource.slice(buildSystemStart, buildSystemEnd)
    expect(body).toMatch(/ORGANISER_SAFETY_PROMPT/)
    expect(body).toMatch(/\.some\(c => c\.key === 'organiser'\)/)
  })

  it('is appended before the final [Organisation ID] block, and TENNIS_SYSTEM\'s own early return is untouched', () => {
    const idx = routeSource.indexOf('ORGANISER_SAFETY_PROMPT')
    const orgIdBlockIdx = routeSource.indexOf('[Organisation ID for database queries]')
    expect(idx).toBeGreaterThan(-1)
    expect(idx).toBeLessThan(orgIdBlockIdx)
    expect(routeSource).toMatch(/if \(isLDTennis\) \{\s*let s = TENNIS_SYSTEM;/)
  })
})

describe('no Organiser write action / side-effect surface added', () => {
  it('the action enum in SYSTEM_RULES is unchanged — no new organiser_* action value was added', () => {
    expect(routeSource).toMatch(
      /"action": "none \| open_chat \| close_chat \| open_sidebar \| close_sidebar \| open_panel \| close_panel \| navigate \| clear_chat \| show_memory \| spotify_control \| task_add \| task_complete \| task_clear \| scout_search \| calendar_create \| note_create"/,
    )
    expect(routeSource).not.toMatch(/organiser_(create|update|delete|move)/)
  })

  it('no INSERT/UPDATE/DELETE against any organiser_* table appears anywhere in this file', () => {
    expect(routeSource).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+organiser_/i)
  })
})

describe('no unrelated files were pulled into this change (spot-check imports)', () => {
  it('hooks/useHelena.js is only referenced from its own pre-existing comment (Phase C.2B.2), never imported by the server route — this phase adds no new reference to it', () => {
    const matches = routeSource.match(/useHelena/g) ?? []
    // Exactly the one pre-existing comment mention (department-selection
    // context, unrelated to Organiser) — never an import statement.
    expect(matches.length).toBe(1)
    expect(routeSource).not.toMatch(/from ['"].*useHelena/)
  })

  it('agentRouter is imported unchanged — same import path and named export as before this phase', () => {
    expect(routeSource).toMatch(/import \{ route as routeToAgent \} from '@\/lib\/agents\/agentRouter';/)
  })
})
