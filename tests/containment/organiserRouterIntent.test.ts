import { describe, it, expect } from 'vitest'

// Phase D.4.6C — lib/agents/agentRouter.ts's Organiser-intent guard. Real,
// directly-imported execution (not source-text containment) — route() is a
// plain importable async function, and every case tested here short-
// circuits before any Anthropic call (the Organiser guard and the
// keyword-heuristic path both return synchronously-reachable results), so
// no client mocking is needed. This is the FIRST test coverage
// lib/agents/agentRouter.ts has ever had in this repo.

process.env.ANTHROPIC_API_KEY ??= 'test-anthropic-key-not-for-production'

const { route } = await import('@/lib/agents/agentRouter')

function q(query: string) {
  return route({ organisationId: 'org-a', userId: 'u1', query })
}

function qc(query: string, organiserContext: boolean) {
  return route({ organisationId: 'org-a', userId: 'u1', query, organiserContext })
}

describe('Organiser-intent guard — reaches general chat (bypasses briefingAgent)', () => {
  it('"what changed on Founder Tasks today?" -> chat (would otherwise hit briefing\'s "what changed")', async () => {
    const r = await q('what changed on Founder Tasks today?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"summarise this board" -> chat', async () => {
    const r = await q('summarise this board')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"what happened on this board this week?" -> chat via the guard specifically', async () => {
    const r = await q('what happened on this board this week?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"who changed this item?" -> chat via the guard specifically', async () => {
    const r = await q('who changed this item?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"which items moved groups?" -> chat via the guard specifically', async () => {
    const r = await q('which items moved groups?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"were any files added to this board?" -> chat via the guard specifically', async () => {
    const r = await q('were any files added to this board?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('"what happened to this deleted item?" -> chat via the guard specifically', async () => {
    const r = await q('what happened to this deleted item?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })
})

describe('non-Organiser phrasing still routes to briefingAgent (no regression)', () => {
  it('"brief me on today\'s operations" -> briefing, via keyword match (guard did not fire)', async () => {
    const r = await q("brief me on today's operations")
    expect(r.agent).toBe('briefing')
    expect(r.reason).toBe('keyword match')
  })

  it('"summarise today" -> briefing, via keyword match', async () => {
    const r = await q('summarise today')
    expect(r.agent).toBe('briefing')
    expect(r.reason).toBe('keyword match')
  })

  it('"what changed across the business today?" -> briefing, via keyword match (no organiser word present)', async () => {
    const r = await q('what changed across the business today?')
    expect(r.agent).toBe('briefing')
    expect(r.reason).toBe('keyword match')
  })
})

describe('existing non-Organiser specialist routing is unaffected (regression)', () => {
  it('"why are missed bins increasing?" -> insight', async () => {
    const r = await q('why are missed bins increasing?')
    expect(r.agent).toBe('insight')
  })

  it('"what should I do about fleet?" -> action', async () => {
    const r = await q('what should I do about fleet?')
    expect(r.agent).toBe('action')
  })

  it('"what columns does this CSV have?" -> dataIntake', async () => {
    const r = await q('what columns does this CSV have?')
    expect(r.agent).toBe('dataIntake')
  })

  it('"show me our Instagram engagement" -> social', async () => {
    const r = await q('show me our Instagram engagement')
    expect(r.agent).toBe('social')
  })

  it('empty query still returns the pre-existing "no query" fast path', async () => {
    const r = await route({ organisationId: 'org-a', userId: 'u1', query: '' })
    expect(r).toEqual({ agent: 'chat', confidence: 1, reason: 'no query' })
  })
})

// ── Phase D.4.6C.1 — named-board routing accuracy (organiserContext) ───────
//
// "What changed on WORK today?" has no ORGANISER_INTENT_RE keyword
// (no "board"/"item"/"organiser"/"group"/"task"), so it falls straight
// through to briefing's "what changed" keyword match — QA proved this
// reaches briefingAgent, which has zero Organiser awareness, instead of
// Helena's general tool-use loop. Every case below stays on the
// synchronous heuristic-keyword path (never reaches the Anthropic LLM
// classification branch), so — like every other test in this file — no
// client mocking is needed and no network call happens.

describe('organiserContext — named-board briefing override', () => {
  it('"what changed on WORK today?" + organiserContext -> chat (the QA-proven gap)', async () => {
    const r = await qc('what changed on WORK today?', true)
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser context — briefing override')
  })

  it('"what changed today?" + organiserContext -> chat', async () => {
    const r = await qc('what changed today?', true)
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser context — briefing override')
  })

  it('the SAME "what changed on WORK today?" query WITHOUT organiserContext still routes to briefing — no global behaviour change', async () => {
    const r1 = await q('what changed on WORK today?')
    expect(r1.agent).toBe('briefing')
    const r2 = await qc('what changed on WORK today?', false)
    expect(r2.agent).toBe('briefing')
  })

  it('known trade-off: organiserContext overrides ANY briefing-shaped query, including an explicit generic briefing request — documented, not hidden (see agentRouter.ts\'s shouldOverrideToChat header and the D.4.6C.1 report\'s Known Limitations)', async () => {
    const r = await qc("brief me on today's operations", true)
    expect(r.agent).toBe('chat')
  })

  it('organiserContext never affects non-briefing routes — insight/action/dataIntake/social keyword matches are untouched', async () => {
    expect((await qc('why are missed bins increasing?', true)).agent).toBe('insight')
    expect((await qc('what should I do about fleet?', true)).agent).toBe('action')
    expect((await qc('what columns does this CSV have?', true)).agent).toBe('dataIntake')
    expect((await qc('show me our Instagram engagement', true)).agent).toBe('social')
  })

  it('the ORGANISER_INTENT_RE guard still takes priority regardless of organiserContext — "what changed on this board" reaches chat via the guard, not the override', async () => {
    const r = await qc('what changed on this board today?', true)
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('organiserContext defaults to no behaviour change when omitted entirely (backward-compatible input)', async () => {
    const r = await route({ organisationId: 'org-a', userId: 'u1', query: 'what changed on WORK today?' })
    expect(r.agent).toBe('briefing')
  })
})

// ── Phase D.4.6M — Organiser-vs-social comment routing disambiguation ──────
//
// Root cause (see agentRouter.ts's own EXPLICIT_SOCIAL_RE/BARE_COMMENT_RE
// header): ROUTE_KEYWORDS.social matched bare "comment" with no
// accompanying platform noun, and shouldOverrideToChat() only ever
// overrode the 'briefing' route — never 'social' — so an established
// Organiser context could not rescue a short "post another comment"
// follow-up, and a fully context-free "post a comment" silently and
// confidently routed to social with no ambiguity signal at all.

describe('D.4.6M — Organiser positive', () => {
  it('A. explicit Organiser item wording -> chat via the pre-existing organiser-intent guard (unaffected by this phase)', async () => {
    const r = await q('Post a comment on the Test 2 item saying hello')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('B. explicit Organiser wording -> chat via the organiser-intent guard', async () => {
    const r = await q('Add a comment to this Organiser item')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('C. established Organiser context + short comment follow-up (no organiser noun) -> chat, routed to organiser', async () => {
    const r = await qc('Post another comment saying hello', true)
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser context — comment routed to organiser')
  })

  it('D. established Organiser context + "comment on this item" -> chat via the organiser-intent guard ("item" is present)', async () => {
    const r = await qc('Comment on this item', true)
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('the SAME short follow-up WITHOUT organiserContext is ambiguous, not silently Organiser-routed', async () => {
    const r = await q('Post another comment saying hello')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('ambiguous comment — routed to general chat for clarification')
  })
})

describe('D.4.6M — social positive (unaffected by the new guard)', () => {
  it('E. "Post a comment on our latest Instagram post" -> social', async () => {
    const r = await q('Post a comment on our latest Instagram post')
    expect(r.agent).toBe('social')
  })

  it('F. "Reply to that Facebook comment" -> social', async () => {
    const r = await q('Reply to that Facebook comment')
    expect(r.agent).toBe('social')
  })

  it('G. "Add a comment to the LinkedIn post" -> social', async () => {
    const r = await q('Add a comment to the LinkedIn post')
    expect(r.agent).toBe('social')
  })

  it('explicit social wording still routes social even WITH an established Organiser context', async () => {
    const r = await qc('Post a comment on our latest Instagram post', true)
    expect(r.agent).toBe('social')
  })
})

describe('D.4.6M — ambiguous context-free comment wording', () => {
  it('H. context-free "Post a comment" -> chat (safe neutral), never a silently-confident social/Organiser guess', async () => {
    const r = await q('Post a comment')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('ambiguous comment — routed to general chat for clarification')
    expect(r.confidence).toBeLessThan(0.85)
  })

  it('I. context-free "Add a comment" -> chat (safe neutral)', async () => {
    const r = await q('Add a comment')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('ambiguous comment — routed to general chat for clarification')
  })

  it('ambiguous routing never returns "social" or invents an Organiser-specific reason for a context-free comment', async () => {
    const r = await q('post a comment')
    expect(r.agent).not.toBe('social')
    expect(r.reason).not.toMatch(/organiser/i)
  })
})

describe('D.4.6M — conflicting signals: explicit intent beats stale/established context', () => {
  it('J. Organiser context + explicit Instagram wording -> social (explicit social wins)', async () => {
    const r = await qc('Post a comment on our Instagram post', true)
    expect(r.agent).toBe('social')
  })

  it('K. explicit Organiser item wording -> chat via the organiser-intent guard, regardless of any social-adjacent phrasing elsewhere in the same turn', async () => {
    const r = await q('Post a comment on the Test 2 Organiser item saying hello')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })
})

describe('D.4.6M — regression: unrelated routing and write-surface invariants unchanged', () => {
  it('L. unrelated normal Helena requests unchanged', async () => {
    expect((await q('why are missed bins increasing?')).agent).toBe('insight')
    expect((await q('what should I do about fleet?')).agent).toBe('action')
    expect((await q('what columns does this CSV have?')).agent).toBe('dataIntake')
  })

  it('M. non-comment social requests unchanged', async () => {
    const r = await q('show me our Instagram engagement')
    expect(r.agent).toBe('social')
  })

  it('N. Organiser read requests unchanged', async () => {
    const r = await q('what changed on this board today?')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser intent')
  })

  it('O. exactly 6 Organiser Helena tools remain (source-shape invariant, cross-file) — updated in D.4.6N to add propose_organiser_status_change', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/helenaTools.ts'), 'utf8')
    const names = [...source.matchAll(/name: '([a-z_]+)'/g)].map(m => m[1])
    expect(names).toEqual([
      'list_organiser_boards',
      'list_organiser_items',
      'get_organiser_board_activity',
      'get_organiser_item_activity',
      'propose_organiser_comment',
      'propose_organiser_status_change',
    ])
  })

  it('P. exactly 2 write actions remain (propose_organiser_comment, propose_organiser_status_change) — no generic update/create/move/delete capability', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/organiser/helenaTools.ts'), 'utf8')
    expect(source).not.toMatch(/\b(create|update|move|delete)_organiser/)
  })
})

describe('the guard is a small lexical check, not DB/capability-aware (source-shape invariant)', () => {
  it('router source never imports the db client or a capability-check module', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/agents/agentRouter.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(source).not.toMatch(/requireCapability|checkCapability/)
  })
})

// ── Phase D.4.6N — explicit Organiser status-change routing intent ─────────

describe('D.4.6N — status-change intent guard', () => {
  it('"Change Test 2 to Done" -> chat via the status-change intent guard (the phase\'s own primary example)', async () => {
    const r = await q('Change Test 2 to Done')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser status-change intent')
  })

  it('"Set Test 2\'s status to In Progress" -> chat via the status-change intent guard', async () => {
    const r = await q("Set Test 2's status to In Progress")
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser status-change intent')
  })

  it('"Mark Test 2 as Done" -> chat via the status-change intent guard', async () => {
    const r = await q('Mark Test 2 as Done')
    expect(r.agent).toBe('chat')
    expect(r.reason).toBe('organiser status-change intent')
  })

  it('a bare "done" with no change-verb never satisfies this guard on its own ("Are we done with the meeting?")', async () => {
    const r = await q('Are we done with the meeting?')
    expect(r.reason).not.toBe('organiser status-change intent')
  })

  it('a change-verb with neither "status" nor a canonical status value never satisfies this guard ("Change my password")', async () => {
    const r = await q('Change my password')
    expect(r.reason).not.toBe('organiser status-change intent')
  })

  it('organiserContext has no bearing on this guard — it fires purely on explicit wording, with or without established context', async () => {
    const withContext = await qc('Change Test 2 to Done', true)
    const withoutContext = await q('Change Test 2 to Done')
    expect(withContext.reason).toBe('organiser status-change intent')
    expect(withoutContext.reason).toBe('organiser status-change intent')
  })
})
