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

describe('the guard is a small lexical check, not DB/capability-aware (source-shape invariant)', () => {
  it('router source never imports the db client or a capability-check module', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const source = fs.readFileSync(path.resolve(__dirname, '../../lib/agents/agentRouter.ts'), 'utf8')
    expect(source).not.toMatch(/from ['"]@\/lib\/db['"]/)
    expect(source).not.toMatch(/requireCapability|checkCapability/)
  })
})
