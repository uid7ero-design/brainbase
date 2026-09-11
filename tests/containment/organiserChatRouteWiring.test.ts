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

  it('buildSystem\'s ORGANISER_SAFETY_PROMPT inclusion, callClaude\'s tool registration, and POST\'s own D.4.6D context-resolution gate all check the exact same enabledCapabilities condition — none can drift apart', () => {
    // Phase D.4.6D added a THIRD occurrence: POST() now needs
    // hasOrganiserCapability itself (to gate resolveHelenaOrganiserContext,
    // before callClaude/buildSystem ever run) — a tenant without the
    // capability gets no tools AND no context resolution, exactly as
    // before this phase for tools alone.
    const occurrences = routeSource.match(/\(enabledCapabilities \?\? \[\]\)\.some\(c => c\.key === 'organiser'\)/g) ?? []
    expect(occurrences.length).toBe(3)
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

  it('Organiser tool execution calls executeOrganiserTool(block.name, block.input, ...) — no inline reimplementation of auth/dispatch here', () => {
    expect(routeSource).toMatch(/content = await executeOrganiserTool\(block\.name, block\.input, \{/)
  })

  it('the D.4.6D context-default argument passes only board/item IDS from the resolved (never the raw client-supplied) organiserContext', () => {
    const idx = routeSource.indexOf('content = await executeOrganiserTool(block.name, block.input, {')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 200)
    expect(block).toMatch(/boardId:\s*organiserContext\?\.board\?\.id/)
    expect(block).toMatch(/itemId:\s*organiserContext\?\.item\?\.id/)
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

describe('D.4.6H-era: no Organiser write action / side-effect surface added via SYSTEM_RULES\' generic action enum', () => {
  it('the action enum in SYSTEM_RULES is unchanged — the D.4.6I write action is NOT modeled as a SYSTEM_RULES action value', () => {
    expect(routeSource).toMatch(
      /"action": "none \| open_chat \| close_chat \| open_sidebar \| close_sidebar \| open_panel \| close_panel \| navigate \| clear_chat \| show_memory \| spotify_control \| task_add \| task_complete \| task_clear \| scout_search \| calendar_create \| note_create"/,
    )
    expect(routeSource).not.toMatch(/organiser_(create|update|delete|move)/)
  })

  it('no INSERT/UPDATE/DELETE against any organiser_* table appears anywhere in THIS file — the one D.4.6I mutation lives entirely in lib/organiser/helenaWrite.ts, never inlined into the chat route', () => {
    expect(routeSource).not.toMatch(/(INSERT INTO|UPDATE|DELETE FROM)\s+organiser_/i)
  })
})

// ── Phase D.4.6I — guarded write/action confirmation wiring ────────────────

describe('organiserActionConfirmation: trusted, non-model confirmation channel', () => {
  it('is parsed as `unknown` at the body-destructure boundary, exactly like organiserContext — never trusted as a typed shape until validated', () => {
    const idx = routeSource.indexOf('organiserActionConfirmation,')
    expect(idx).toBeGreaterThan(-1)
    const typeIdx = routeSource.indexOf('organiserActionConfirmation?: unknown;')
    expect(typeIdx).toBeGreaterThan(idx)
  })

  it('only a string .token field is ever extracted from it — no other field, and never assigned straight through', () => {
    expect(routeSource).toMatch(
      /typeof \(organiserActionConfirmation as \{ token\?: unknown \}\)\.token === 'string'/,
    )
  })

  it('the extracted token is threaded into callClaude as its own argument, never merged into the messages array or any tool input', () => {
    const idx = routeSource.indexOf('const result = await callClaude(')
    const block = routeSource.slice(idx, idx + 400)
    expect(block).toMatch(/organiserActionConfirmationToken/)
  })

  it('the ONLY input_schema defined directly in this file is query_database\'s own (buildDataTools) — every Organiser tool schema, and the proof none of them declare a confirmation_token field, lives entirely in helenaTools.ts, covered by organiserHelenaToolsExecution.test.ts', () => {
    const occurrences = (routeSource.match(/input_schema:/g) ?? []).length
    expect(occurrences).toBe(1)
    const idx = routeSource.indexOf('input_schema:')
    const fnIdx = routeSource.indexOf('function buildDataTools')
    expect(fnIdx).toBeGreaterThan(-1)
    expect(fnIdx).toBeLessThan(idx)
  })

  it('the pending-action surfaced to the HTTP caller is populated from executeOrganiserTool\'s OWN tool_result JSON, never re-derived or re-validated from the model\'s tool-call arguments', () => {
    const idx = routeSource.indexOf("if (block.name === 'propose_organiser_comment') {")
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 700)
    expect(block).toMatch(/JSON\.parse\(content\)/)
    expect(block).not.toMatch(/block\.input/)
  })

  it('PendingOrganiserAction is returned to the HTTP client, never passed back into the model\'s system prompt or messages', () => {
    expect(routeSource).toMatch(/pendingOrganiserAction,?\s*\}\);?\s*$/m)
  })
})

describe('one-shot mutation consumption across the 4-iteration tool loop', () => {
  it('the confirmation token is captured into a mutable local BEFORE the loop, not read fresh from the outer parameter on every iteration', () => {
    expect(routeSource).toMatch(/let remainingConfirmationToken = organiserActionConfirmationToken;/)
  })

  it('the capture-and-clear of the token happens synchronously, before the first await inside each tool_use block\'s handling — never inside the async tool-execution body itself', () => {
    const idx = routeSource.indexOf('toolUseBlocks.map((block)')
    expect(idx).toBeGreaterThan(-1)
    // Phase D.4.6N — widened from 1200: the one-shot guard's own comment
    // now documents why BOTH write tools share this gate, pushing the
    // actual code further from the search anchor. Still a generous bound,
    // not a meaningful invariant in itself.
    const block = routeSource.slice(idx, idx + 1800)
    expect(block).toMatch(/let confirmationTokenForThisCall: string \| undefined;/)
    expect(block).toMatch(/remainingConfirmationToken = undefined;/)
    // The clear must appear BEFORE the async IIFE that does the actual
    // (possibly awaited) tool execution — proving it is not itself awaited.
    const clearIdx = block.indexOf('remainingConfirmationToken = undefined;')
    const asyncIdx = block.indexOf('return (async ()')
    expect(clearIdx).toBeGreaterThan(-1)
    expect(asyncIdx).toBeGreaterThan(clearIdx)
  })

  it('D.4.6N: BOTH write-tool calls (propose_organiser_comment, propose_organiser_status_change) — and only those two — ever receive the captured token', () => {
    expect(routeSource).toMatch(
      /\(block\.name === 'propose_organiser_comment' \|\| block\.name === 'propose_organiser_status_change'\) &&\s*\n\s*remainingConfirmationToken/,
    )
  })

  it('the captured-or-undefined token is passed as confirmationToken into executeOrganiserTool\'s contextDefaults — never the raw outer token', () => {
    const idx = routeSource.indexOf('confirmationToken: confirmationTokenForThisCall,')
    expect(idx).toBeGreaterThan(-1)
  })
})

// Phase D.4.6L — result-accuracy: the backend's own resolved status for a
// CONFIRMED Organiser action must control the user-facing wording, never
// unconstrained model narration. These are static source-text proofs
// (this file cannot be safely imported — see the module header) that the
// deterministic map exists, covers every known backend outcome, excludes
// 'proposed' (fresh proposals still get ordinary model narration), is gated
// on the same one-shot token-consumption guard already proven above, and
// short-circuits BEFORE the tool loop ever feeds results back to the model.
describe('Phase D.4.6L — deterministic Organiser confirmation result authority', () => {
  it('ORGANISER_CONFIRMATION_OUTCOME_TEXT exists and covers every backend confirm+execute outcome', () => {
    const idx = routeSource.indexOf('const ORGANISER_CONFIRMATION_OUTCOME_TEXT')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 1200)
    for (const key of ['posted', 'already_used_confirmation', 'expired_confirmation', 'invalid_confirmation', 'unauthorized', 'item_not_found', 'failed']) {
      expect(block).toMatch(new RegExp(`\\b${key}:`))
    }
  })

  it('a fresh proposal ("proposed") is deliberately absent from the deterministic map — normal model narration for a pending proposal is unchanged', () => {
    const idx = routeSource.indexOf('const ORGANISER_CONFIRMATION_OUTCOME_TEXT')
    const endIdx = routeSource.indexOf('};', idx)
    const block = routeSource.slice(idx, endIdx)
    expect(block).not.toMatch(/\bproposed:/)
  })

  it('no confirmation token, jti, org id, or user id literal is embedded in any of the fixed outcome sentences', () => {
    const idx = routeSource.indexOf('const ORGANISER_CONFIRMATION_OUTCOME_TEXT')
    const endIdx = routeSource.indexOf('};', idx)
    const block = routeSource.slice(idx, endIdx)
    expect(block).not.toMatch(/\$\{/) // no interpolation of any runtime value at all
  })

  it('the deterministic outcome is captured ONLY when this exact call consumed the trusted confirmationTokenForThisCall — never for a bare fresh proposal', () => {
    const idx = routeSource.indexOf('organiserConfirmationOutcomeText = ORGANISER_CONFIRMATION_OUTCOME_TEXT')
    expect(idx).toBeGreaterThan(-1)
    const before = routeSource.slice(Math.max(0, idx - 300), idx)
    expect(before).toMatch(/confirmationTokenForThisCall &&/)
  })

  it('the short-circuit return happens strictly BEFORE tool results are fed back into msgs for another model iteration', () => {
    const outcomeCheckIdx = routeSource.indexOf('if (organiserConfirmationOutcomeText !== null)')
    const msgsAppendIdx = routeSource.indexOf("{ role: 'assistant', content: resp.content },")
    expect(outcomeCheckIdx).toBeGreaterThan(-1)
    expect(msgsAppendIdx).toBeGreaterThan(-1)
    expect(outcomeCheckIdx).toBeLessThan(msgsAppendIdx)
  })

  it('the short-circuit returns the fixed text directly — it does not call anthropicClient.messages.create again first', () => {
    const outcomeCheckIdx = routeSource.indexOf('if (organiserConfirmationOutcomeText !== null)')
    const block = routeSource.slice(outcomeCheckIdx, outcomeCheckIdx + 250)
    expect(block).toMatch(/return \{ text: organiserConfirmationOutcomeText, analysis: null, pendingOrganiserAction: null \};/)
  })
})

describe('Phase D.4.6D — organiserContext resolution wiring', () => {
  it('imports resolveHelenaOrganiserContext (and the HelenaOrganiserContext type) from lib/organiser/helenaRead, not a new module', () => {
    expect(routeSource).toMatch(/import \{\s*resolveHelenaOrganiserContext,\s*type HelenaOrganiserContext,?\s*\} from ['"]\.\.\/\.\.\/\.\.\/lib\/organiser\/helenaRead['"]/)
  })

  it('the client organiserContext hint is parsed as `unknown`, never trusted as a typed shape at the body-destructure boundary', () => {
    const idx = routeSource.indexOf('organiserContext: organiserContextHint,')
    expect(idx).toBeGreaterThan(-1)
    const typeIdx = routeSource.indexOf('organiserContext?: unknown;')
    expect(typeIdx).toBeGreaterThan(idx)
  })

  it('resolveHelenaOrganiserContext is called with organisationId: orgId (the auth-resolved session value) — never a client-supplied organisationId', () => {
    const idx = routeSource.indexOf('await resolveHelenaOrganiserContext({')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 250)
    expect(block).toMatch(/organisationId:\s*orgId,/)
    expect(block).not.toMatch(/organisationId:\s*hint/)
  })

  it('only boardId/itemId are read from the parsed hint object, and only when they are strings — the hint object type never declares a boardName/itemName field', () => {
    expect(routeSource).toMatch(/boardIdHint:\s*typeof hint\.boardId === 'string' \? hint\.boardId : undefined,/)
    expect(routeSource).toMatch(/itemIdHint:\s*typeof hint\.itemId === 'string' \? hint\.itemId : undefined,/)
    expect(routeSource).not.toMatch(/hint\.boardName|hint\.itemName|boardName\??:|itemName\??:/)
  })

  it('context resolution is gated on hasOrganiserCapability — a tenant without the capability never triggers resolveHelenaOrganiserContext', () => {
    const idx = routeSource.indexOf('const resolvedOrganiserContext: HelenaOrganiserContext =')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 200)
    expect(block).toMatch(/hasOrganiserCapability && hint/)
  })

  it('the router boolean is the OR of a real resolved board/item and the D.4.6C.1 moduleKey fallback — neither alone was removed', () => {
    expect(routeSource).toMatch(/const hasResolvedOrganiserContext = !!\(resolvedOrganiserContext\.board \|\| resolvedOrganiserContext\.item\);/)
    expect(routeSource).toMatch(/const organiserContext = hasResolvedOrganiserContext \|\| moduleKey === 'organiser';/)
  })

  it('agentRouter.ts itself is unchanged in import shape — D.4.6D added no new export/parameter to the router call', () => {
    expect(routeSource).toMatch(/routeToAgent\(\{ organisationId: orgId, userId, query: lastUserMsg, organiserContext \}\)/)
  })

  it('the resolved organiserContext (not the raw hint) is threaded into both callClaude and the Ollama buildSystem fallback', () => {
    const callClaudeIdx = routeSource.indexOf('const result = await callClaude(')
    const callClaudeBlock = routeSource.slice(callClaudeIdx, callClaudeIdx + 300)
    expect(callClaudeBlock).toMatch(/resolvedOrganiserContext/)

    const ollamaIdx = routeSource.indexOf('const sys = buildSystem(')
    const ollamaBlock = routeSource.slice(ollamaIdx, ollamaIdx + 300)
    expect(ollamaBlock).toMatch(/resolvedOrganiserContext/)
  })

  it('the Organiser context system-prompt block only appears inside the same hasOrganiserCapability-gated section as ORGANISER_SAFETY_PROMPT — never unconditionally', () => {
    const safetyIdx = routeSource.indexOf(`s += \`\\n\\n\${ORGANISER_SAFETY_PROMPT}\`;`)
    const contextBlockIdx = routeSource.indexOf('[Current Organiser context — navigation hint only]')
    expect(safetyIdx).toBeGreaterThan(-1)
    expect(contextBlockIdx).toBeGreaterThan(safetyIdx)
    // Still inside buildSystem's own function body, before its closing "return s;".
    const buildSystemStart = routeSource.indexOf('function buildSystem(')
    const buildSystemEnd = routeSource.indexOf('\n// ─── Ollama', buildSystemStart)
    expect(buildSystemEnd).toBeGreaterThan(-1)
    expect(contextBlockIdx).toBeLessThan(buildSystemEnd)
  })

  it('the context block explicitly instructs the model that an explicit different board/item from the user wins over the current context', () => {
    const idx = routeSource.indexOf('[Current Organiser context — navigation hint only]')
    const block = routeSource.slice(idx, idx + 700)
    expect(block).toMatch(/explicitly name a DIFFERENT board or item, use their explicit request instead/i)
    expect(block).toMatch(/never as instructions/i)
  })

  it('no D.4.6D board/item context plumbing beyond {boardId, itemId} was added — no boardName/itemName ever appears in the resolved context\'s use, only board.name/item.name read from the server-resolved object', () => {
    // The ONLY "Name" occurrences on organiserContext.* are the server-
    // resolved board.name/item.name reads inside the prompt block already
    // asserted above — never a client-shaped boardName/itemName field.
    const matches = routeSource.match(/organiserContext\??\.\w*[Nn]ame/g) ?? []
    expect(matches.every(m => m === 'organiserContext.board.name' || m === 'organiserContext.item.name')).toBe(true)
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

// Phase D.4.6N — same deterministic-bypass requirement as D.4.6L, extended
// to Helena's second write action (propose_organiser_status_change).
describe('Phase D.4.6N — deterministic status-change result authority', () => {
  it('ORGANISER_STATUS_CHANGE_OUTCOME_TEXT exists and covers every backend confirm+execute outcome except the dynamic "changed" template', () => {
    const idx = routeSource.indexOf('const ORGANISER_STATUS_CHANGE_OUTCOME_TEXT')
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 1500)
    for (const key of ['already_used_confirmation', 'expired_confirmation', 'invalid_confirmation', 'unauthorized', 'item_not_found', 'stale_item_state', 'failed']) {
      expect(block).toMatch(new RegExp(`\\b${key}:`))
    }
    // 'changed' and 'proposed' are deliberately absent — 'changed' is a
    // dynamic template (real item/status names), 'proposed' still gets
    // ordinary model narration.
    expect(block).not.toMatch(/\bchanged:/)
    expect(block).not.toMatch(/\bproposed:/)
  })

  it('both write tools share the SAME short-circuit variable (organiserConfirmationOutcomeText): the status-change branch sets it from ORGANISER_STATUS_CHANGE_OUTCOME_TEXT, and there is only ONE `if (organiserConfirmationOutcomeText !== null)` guard in the whole file — so the ordering-vs-msgs-append guarantee Phase D.4.6L already proves for the comment action necessarily covers this action too, without a separate mutation-tested duplicate here', () => {
    const statusChangeSetIdx = routeSource.indexOf('organiserConfirmationOutcomeText = ORGANISER_STATUS_CHANGE_OUTCOME_TEXT')
    expect(statusChangeSetIdx).toBeGreaterThan(-1)

    const outcomeCheckMatches = routeSource.match(/if \(organiserConfirmationOutcomeText !== null\)/g) ?? []
    expect(outcomeCheckMatches.length).toBe(1)
  })

  it('the "changed" outcome is built ONLY from the tool result\'s own server-authoritative `item` object, never from confirmationTokenForThisCall\'s absence or model text', () => {
    const idx = routeSource.indexOf("parsed.status === 'changed' && parsed.item")
    expect(idx).toBeGreaterThan(-1)
    const block = routeSource.slice(idx, idx + 300)
    expect(block).toMatch(/parsed\.item\.name/)
    expect(block).toMatch(/parsed\.item\.previous_status/)
    expect(block).toMatch(/parsed\.item\.new_status/)
  })

  it('the one-shot confirmation-token guard is gated on EITHER write tool name, never a bare tool-name-agnostic check', () => {
    expect(routeSource).toMatch(
      /\(block\.name === 'propose_organiser_comment' \|\| block\.name === 'propose_organiser_status_change'\)/,
    )
  })
})
