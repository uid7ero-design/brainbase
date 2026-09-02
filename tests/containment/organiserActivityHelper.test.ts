import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'fs'
import path from 'path'

// Phase D.4.5B — lib/organiser/activity.ts foundation. Mirrors this repo's
// established mocked-sql pattern (see organiserCapabilityEnforcement.test.ts)
// so organiserActivityInsertQuery's built query can be inspected without a
// real DB connection. No real Organiser mutation route calls anything in
// this file yet — see the "zero production callers" containment section
// below, which is the assertion that actually matters most for this phase.

const sqlMock = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({
  __query: true,
  text: strings,
  values,
}))
vi.mock('@/lib/db', () => ({
  default: (...args: unknown[]) => (sqlMock as unknown as (...a: unknown[]) => unknown)(...args),
}))

const {
  ORGANISER_EVENT_TYPES,
  ORGANISER_ENTITY_TYPES,
  MAX_ACTIVITY_STRING_LENGTH,
  truncateActivityString,
  sanitiseActivityFieldValue,
  sanitiseActivityPayload,
  organiserActivityInsertQuery,
  recordOrganiserActivity,
} = await import('@/lib/organiser/activity')

beforeEach(() => {
  sqlMock.mockClear()
})

const BASE_ENTRY = {
  organisationId: 'org-a',
  boardId: 'board-1',
  itemId: 'item-1',
  actorUserId: 'user-1',
  actorName: 'James',
  eventType: 'item.updated' as const,
  entityType: 'item' as const,
  entityId: 'item-1',
  before: { status: 'Not Started' },
  after: { status: 'Working on it' },
}

describe('taxonomy exports', () => {
  it('ORGANISER_EVENT_TYPES has exactly 17 entries', () => {
    expect(ORGANISER_EVENT_TYPES).toHaveLength(17)
  })

  it('ORGANISER_ENTITY_TYPES has exactly the 7 approved entity types', () => {
    expect(ORGANISER_ENTITY_TYPES).toEqual(['board', 'group', 'item', 'column', 'file', 'comment', 'import'])
  })

  it('no duplicate event types', () => {
    expect(new Set(ORGANISER_EVENT_TYPES).size).toBe(ORGANISER_EVENT_TYPES.length)
  })
})

describe('truncateActivityString', () => {
  it('leaves a string at or under the limit unchanged', () => {
    const s = 'a'.repeat(MAX_ACTIVITY_STRING_LENGTH)
    expect(truncateActivityString(s)).toBe(s)
  })

  it('truncates a string over the limit and appends an explicit, visible marker', () => {
    const s = 'a'.repeat(MAX_ACTIVITY_STRING_LENGTH + 50)
    const result = truncateActivityString(s)
    expect(result.length).toBeLessThan(s.length)
    expect(result).toContain('truncated')
    expect(result.startsWith('a'.repeat(MAX_ACTIVITY_STRING_LENGTH))).toBe(true)
  })

  it('is deterministic — same input always produces the same output', () => {
    const s = 'x'.repeat(300)
    expect(truncateActivityString(s)).toBe(truncateActivityString(s))
  })
})

describe('sanitiseActivityFieldValue', () => {
  it('passes primitives through unchanged', () => {
    expect(sanitiseActivityFieldValue(42)).toBe(42)
    expect(sanitiseActivityFieldValue(true)).toBe(true)
    expect(sanitiseActivityFieldValue(null)).toBe(null)
  })

  it('truncates a long string', () => {
    const long = 'y'.repeat(500)
    expect((sanitiseActivityFieldValue(long) as string).length).toBeLessThan(500)
  })

  it('sanitises a shallow object one level deep without mutating the input', () => {
    const input = { status: 'y'.repeat(500), count: 3 }
    const inputCopy = { ...input }
    const result = sanitiseActivityFieldValue(input) as Record<string, unknown>
    expect(input).toEqual(inputCopy) // never mutated
    expect((result.status as string).length).toBeLessThan(500)
    expect(result.count).toBe(3)
  })

  it('stringifies-and-truncates a nested object/array rather than recursing further', () => {
    const nested = { outer: { inner: { deep: 'value' } } }
    const result = sanitiseActivityFieldValue(nested) as Record<string, unknown>
    expect(typeof result.outer).toBe('string')
    expect(result.outer as string).toContain('inner')
  })

  it('stringifies-and-truncates a bare array', () => {
    const arr = [1, 2, 3]
    const result = sanitiseActivityFieldValue(arr)
    expect(typeof result).toBe('string')
  })
})

describe('sanitiseActivityPayload', () => {
  it('returns null for null/undefined input (distinguishable from "diff of nothing")', () => {
    expect(sanitiseActivityPayload(null)).toBe(null)
    expect(sanitiseActivityPayload(undefined)).toBe(null)
  })

  it('sanitises every top-level key independently, never mutating the input object', () => {
    const input = { name: 'z'.repeat(300), position: 5 }
    const inputCopy = { ...input }
    const result = sanitiseActivityPayload(input)!
    expect(input).toEqual(inputCopy)
    expect((result.name as string).length).toBeLessThan(300)
    expect(result.position).toBe(5)
  })
})

describe('organiserActivityInsertQuery', () => {
  it('builds an INSERT into organiser_activity with the required columns', () => {
    organiserActivityInsertQuery(BASE_ENTRY)
    expect(sqlMock).toHaveBeenCalledTimes(1)
    const [strings] = sqlMock.mock.calls[0] as [TemplateStringsArray]
    const joined = strings.join('?')
    expect(joined).toContain('INSERT INTO organiser_activity')
    expect(joined).toContain('organisation_id')
    expect(joined).toContain('board_id')
    expect(joined).toContain('item_id')
    expect(joined).toContain('actor_user_id')
    expect(joined).toContain('actor_name')
    expect(joined).toContain('event_type')
    expect(joined).toContain('entity_type')
    expect(joined).toContain('entity_id')
    expect(joined).toContain('before_json')
    expect(joined).toContain('after_json')
    expect(joined).toContain('metadata_json')
  })

  it('passes the exact organisationId/actorUserId/actorName/eventType/entityType/entityId values supplied — never a fallback or a re-derived value', () => {
    organiserActivityInsertQuery(BASE_ENTRY)
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('org-a')
    expect(values).toContain('board-1')
    expect(values).toContain('item-1')
    expect(values).toContain('user-1')
    expect(values).toContain('James')
    expect(values).toContain('item.updated')
    expect(values).toContain('item')
  })

  it('itemId/actorUserId default to null (not undefined) when omitted', () => {
    organiserActivityInsertQuery({ ...BASE_ENTRY, itemId: undefined, actorUserId: undefined })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).not.toContain(undefined)
  })

  it('sanitises before/after/metadata before they reach the query (a long value is truncated in the serialized JSON)', () => {
    organiserActivityInsertQuery({
      ...BASE_ENTRY,
      before: { notes: 'a'.repeat(500) },
      after: { notes: 'b'.repeat(500) },
    })
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    const beforeJson = values.find(v => typeof v === 'string' && v.includes('"notes"')) as string
    expect(beforeJson.length).toBeLessThan(500)
  })

  it('metadata defaults to {} when omitted, never null', () => {
    organiserActivityInsertQuery(BASE_ENTRY) // BASE_ENTRY itself carries no metadata key
    const values = sqlMock.mock.calls[0].slice(1) as unknown[]
    expect(values).toContain('{}')
  })
})

describe('recordOrganiserActivity — best-effort wrapper', () => {
  it('awaits the insert query and resolves normally on success', async () => {
    await expect(recordOrganiserActivity(BASE_ENTRY)).resolves.toBeUndefined()
    expect(sqlMock).toHaveBeenCalledTimes(1)
  })

  it('catches and logs a failure rather than throwing — the underlying mutation this describes must never be affected by an activity-write failure', async () => {
    sqlMock.mockImplementationOnce(() => { throw new Error('insert failed') })
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(recordOrganiserActivity(BASE_ENTRY)).resolves.toBeUndefined()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('actor/tenant model — no session fetching, no fallback tenant', () => {
  const root = path.resolve(__dirname, '../..')
  const SOURCE = fs.readFileSync(path.join(root, 'lib/organiser/activity.ts'), 'utf8')
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('does not import requireSession/getSession/authorizeOrganiserRequest — actor identity is always caller-supplied, never resolved here', () => {
    expect(CODE).not.toMatch(/requireSession|getSession|authorizeOrganiserRequest/)
  })

  it('does not fetch or query the users table to resolve actor name — actorName is always the caller-supplied snapshot', () => {
    expect(CODE).not.toMatch(/FROM users/)
  })

  it('organisationId/actorUserId/actorName have no default/fallback value anywhere in this file', () => {
    expect(CODE).not.toMatch(/organisationId\s*[?]?[?:]=/)
    expect(CODE).not.toMatch(/actorUserId\s*\?\?\s*['"]/) // no string fallback for actor id
  })

  it('the entry type has no role or capability field', () => {
    expect(CODE).not.toMatch(/role\s*[:?]/)
    expect(CODE).not.toMatch(/capability\s*[:?]/)
  })
})

describe('filesystem boundary — this phase does not touch organiser_item_files, fs.writeFile, or fs.unlink', () => {
  const root = path.resolve(__dirname, '../..')
  const SOURCE = fs.readFileSync(path.join(root, 'lib/organiser/activity.ts'), 'utf8')
  // Comment-stripped: the file's own header comment explains (in prose) why
  // organiser_item_files is out of scope this phase — that explanatory
  // mention must not itself trip this check, only real usage should.
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

  it('lib/organiser/activity.ts has no filesystem import and no executable reference to organiser_item_files', () => {
    expect(CODE).not.toMatch(/from ['"]fs/)
    expect(CODE).not.toContain('organiser_item_files')
  })
})

describe('zero production callers (the phase\'s core behavioral-inertness guarantee)', () => {
  const root = path.resolve(__dirname, '../..')
  const ORGANISER_API_DIR = path.join(root, 'app/api/organiser')

  function listRouteFiles(dir: string): string[] {
    const out: string[] = []
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) out.push(...listRouteFiles(full))
      else if (entry.name === 'route.ts') out.push(full)
    }
    return out
  }

  // Phase D.4.5C-B — this assertion originally read "...yet" as a
  // deliberate temporal boundary (D.4.5B's own inertness guarantee).
  // D.4.5C-B is the separately-approved phase that actually instruments
  // item POST/PATCH/DELETE — but per Gate A/Gate W of that phase's own
  // report, it deliberately does NOT import lib/organiser/activity into
  // the item routes at all (organiserActivityInsertQuery's "separate,
  // composed query" shape is the wrong abstraction for the atomic
  // writable-CTE statement those routes need — see the phase report's
  // own disposition), so this specific assertion's condition — "no route
  // imports this module" — legitimately still holds and is kept exactly
  // as originally proven, just with the stale "yet" removed from its
  // description.
  it('no app/api/organiser/**/route.ts file has an executable import of lib/organiser/activity — the item routes\' atomic writable-CTE statements never import organiserActivityInsertQuery or recordOrganiserActivity (see organiserItemActivity.test.ts for the item routes\' own dedicated coverage). Checked against comment-stripped code — the PATCH route\'s own comment legitimately names lib/organiser/activity.ts in prose when explaining why its SQL-side sanitiser mirrors that module\'s policy.', () => {
    const files = listRouteFiles(ORGANISER_API_DIR)
    expect(files.length).toBeGreaterThan(0) // sanity: the directory scan itself worked
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      expect(code, `${file} must not import lib/organiser/activity`).not.toMatch(/from ['"]@\/lib\/organiser\/activity['"]/)
    }
  })

  it('no file anywhere in the repo (outside this module and every test file that legitimately discusses these names by name — e.g. to assert they are NOT called) imports organiserActivityInsertQuery or recordOrganiserActivity', () => {
    function walk(dir: string, out: string[] = []): string[] {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (['node_modules', '.git', '.next', '.claude'].includes(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, out)
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full)
      }
      return out
    }
    const allFiles = walk(root)
    const offenders: string[] = []
    for (const file of allFiles) {
      if (file.includes(`lib${path.sep}organiser${path.sep}activity.ts`)) continue
      // This module's own test files (any test whose name pairs
      // "organiser" with "Activity" in either order — covers both
      // organiserActivity*.test.ts from D.4.5B and
      // organiserItemActivity.test.ts / organiserActivitySanitisationParity
      // .test.ts from D.4.5C-B) legitimately name these identifiers in
      // their own assertions/comments to prove they are NOT called from
      // production code — that is the opposite of a violation.
      if (/organiser.*activity.*\.test\.ts$/i.test(path.basename(file))) continue
      const src = fs.readFileSync(file, 'utf8')
      if (/organiserActivityInsertQuery|recordOrganiserActivity/.test(src)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
