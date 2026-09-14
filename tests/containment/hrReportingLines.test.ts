import { describe, it, expect, vi, beforeEach } from 'vitest';

// HR-2 Step 1C — direct unit coverage for lib/hr/reportingLines.ts's
// wouldCreateManagerCycle(). `sql` is fully mocked here (this repo's
// standard containment-test pattern — see tests/setupEnv.ts and every
// other hr*.test.ts file), so these tests prove the function's CALLING
// CONTRACT (correct query shape/parameters, correct boolean relay) —
// they cannot themselves execute the real recursive CTE against a
// database.
//
// The query's own GRAPH-WALKING correctness was independently verified,
// during this phase's implementation, against a real disposable
// postgres:16-alpine container running the exact SQL text
// lib/hr/reportingLines.ts issues (see this phase's own report for the
// full scenario list and results). All ten scenarios below returned the
// exact expected boolean:
//   1. no manager chain (proposed manager has no manager at all) -> false
//   2. a valid, non-cyclic chain -> false
//   3. a 4-node cycle -> true
//   4. a 3-node cycle -> true
//   5. a 2-node cycle -> true
//   6. a direct self-check (personId === proposedManagerPersonId) -> true
//      (the app layer already blocks this earlier — see
//      app/api/hr/people/[id]/route.ts's own existing self-management
//      check — this proves the query itself is ALSO safe as a
//      defense-in-depth backstop, not the primary guard)
//   7. an unrelated query is unaffected by a pre-existing corrupt 2-node
//      cycle (P<->Q) elsewhere in the same organisation -> correctly
//      false
//   8. querying the corrupt pair itself TERMINATES (does not hang) and
//      correctly reports true
//   9. a proposed manager in a DIFFERENT organisation is invisible to
//      the walk -> false (never crosses orgs)
//   10. a 20-hop chain still correctly detects a cycle beyond trivial
//       depth

let responseQueue: unknown[][] = [];
let callCount = 0;
let calls: { text: string; values: unknown[] }[] = [];
const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values });
  return Promise.resolve(responseQueue[callCount++] ?? []);
});
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...(args as [TemplateStringsArray, ...unknown[]])),
}));

function queue(...responses: unknown[][]) { responseQueue = responses; callCount = 0; }

const { wouldCreateManagerCycle } = await import('@/lib/hr/reportingLines');

beforeEach(() => {
  sqlMock.mockClear();
  calls = [];
  responseQueue = [];
  callCount = 0;
});

describe('wouldCreateManagerCycle', () => {
  it('relays false when the underlying query finds no cycle (no chain / valid chain)', async () => {
    queue([{ would_cycle: false }]);
    const result = await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(result).toBe(false);
  });

  it('relays true when the underlying query finds a cycle (2/3/4+-node — the query does not distinguish hop count, only reachability)', async () => {
    queue([{ would_cycle: true }]);
    const result = await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(result).toBe(true);
  });

  it('issues exactly one query — a single recursive round trip, never an iterative per-hop call', async () => {
    queue([{ would_cycle: false }]);
    await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(sqlMock).toHaveBeenCalledTimes(1);
  });

  it('scopes the walk to the caller organisation (never a different org\'s manager graph)', async () => {
    queue([{ would_cycle: false }]);
    await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(calls[0].text).toContain('organisation_id');
    expect(calls[0].values).toContain('org-a');
  });

  it('the walk starts at the PROPOSED manager and checks for personId as the target', async () => {
    queue([{ would_cycle: false }]);
    await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'the-person', proposedManagerPersonId: 'the-proposed-manager' });
    expect(calls[0].values).toContain('the-proposed-manager');
    expect(calls[0].values).toContain('the-person');
  });

  it('uses a recursive CTE with the visited-array cycle-safe guard and a defensive depth cap — the same idiom already reviewed and shipped for app/api/organiser/items/[itemId]/route.ts\'s own parent_item_id cycle check', async () => {
    queue([{ would_cycle: false }]);
    await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(calls[0].text).toContain('WITH RECURSIVE');
    expect(calls[0].text).toContain('ARRAY[id]');
    expect(calls[0].text).toContain('NOT p.id = ANY(a.visited)');
    expect(calls[0].text).toContain('array_length(a.visited, 1) < 500');
  });

  it('never mutates data — the query is a pure SELECT, no INSERT/UPDATE/DELETE', async () => {
    queue([{ would_cycle: false }]);
    await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(calls[0].text).not.toMatch(/INSERT|UPDATE|DELETE/i);
  });

  it('handles a defensively-missing would_cycle field as false rather than throwing', async () => {
    queue([{}]);
    const result = await wouldCreateManagerCycle({ organisationId: 'org-a', personId: 'p1', proposedManagerPersonId: 'p2' });
    expect(result).toBe(false);
  });
});
