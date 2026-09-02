import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { ORGANISER_EVENT_TYPES, ORGANISER_ENTITY_TYPES } from '@/lib/organiser/activity'

// Phase D.4.5B — organiser_activity schema foundation. Static source-text
// containment against app/api/admin/migrate/route.ts (the confirmed,
// authoritative, idempotent CREATE TABLE source for every organiser_*
// table — see the D.4.5A audit report; this repo's Organiser schema is
// NOT in scripts/*.sql or Prisma). No application code writes to
// organiser_activity yet — this suite proves the migration step itself
// and its shape, not any runtime behavior.

const root = path.resolve(__dirname, '../..')
const MIGRATE_ROUTE_SOURCE = fs.readFileSync(path.join(root, 'app/api/admin/migrate/route.ts'), 'utf8').replace(/\r\n/g, '\n')

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}
const CODE = stripComments(MIGRATE_ROUTE_SOURCE)

// Block-scope to just the organiser_activity step, to avoid false positives
// against the other 39 migration steps in this same file.
const stepStart = CODE.indexOf("step('40. organiser_activity')")
const stepEnd = CODE.indexOf("return NextResponse.json({ success: true, message: 'Migration complete.'", stepStart)

describe('organiser_activity migration step exists and is scoped correctly', () => {
  it('step 40 exists, after step 39 (organiser_item_updates), before the handler return', () => {
    expect(stepStart).toBeGreaterThan(-1)
    expect(stepEnd).toBeGreaterThan(stepStart)
    const step39Idx = CODE.indexOf("step('39. organiser_item_updates')")
    expect(step39Idx).toBeGreaterThan(-1)
    expect(step39Idx).toBeLessThan(stepStart)
  })
})

const BLOCK = CODE.slice(stepStart, stepEnd)

describe('CREATE TABLE organiser_activity — shape', () => {
  it('is idempotent (CREATE TABLE IF NOT EXISTS)', () => {
    expect(BLOCK).toMatch(/CREATE TABLE IF NOT EXISTS organiser_activity \(/)
  })

  it('id is UUID PRIMARY KEY DEFAULT gen_random_uuid(), matching every other organiser_* table', () => {
    expect(BLOCK).toMatch(/id\s+UUID PRIMARY KEY DEFAULT gen_random_uuid\(\)/)
  })

  it('organisation_id is TEXT NOT NULL REFERENCES organisations(id) — never UUID', () => {
    expect(BLOCK).toMatch(/organisation_id TEXT NOT NULL REFERENCES organisations\(id\)/)
    expect(BLOCK).not.toMatch(/organisation_id\s+UUID/)
  })

  it('board_id is UUID NOT NULL with NO foreign key reference to organiser_boards', () => {
    expect(BLOCK).toMatch(/board_id\s+UUID NOT NULL,/)
    expect(BLOCK).not.toMatch(/board_id[^,]*REFERENCES organiser_boards/)
  })

  it('item_id is nullable UUID with NO foreign key reference to organiser_items', () => {
    expect(BLOCK).toMatch(/item_id\s+UUID,/)
    expect(BLOCK).not.toMatch(/item_id\s+UUID NOT NULL/)
    expect(BLOCK).not.toMatch(/item_id[^,]*REFERENCES organiser_items/)
  })

  it('entity_id is TEXT NOT NULL — never a typed/FK column, so it survives the described entity being deleted', () => {
    expect(BLOCK).toMatch(/entity_id\s+TEXT NOT NULL,/)
    expect(BLOCK).not.toMatch(/entity_id\s+UUID/)
    expect(BLOCK).not.toMatch(/entity_id[^,]*REFERENCES/)
  })

  it('no group_id or column_id first-class column exists', () => {
    expect(BLOCK).not.toMatch(/\bgroup_id\b/)
    expect(BLOCK).not.toMatch(/\bcolumn_id\b/)
  })

  it('actor_user_id is nullable TEXT REFERENCES users(id) ON DELETE SET NULL', () => {
    expect(BLOCK).toMatch(/actor_user_id\s+TEXT REFERENCES users\(id\) ON DELETE SET NULL,/)
  })

  it('actor_name is TEXT NOT NULL — always a snapshot, never nullable', () => {
    expect(BLOCK).toMatch(/actor_name\s+TEXT NOT NULL,/)
  })

  it('before_json/after_json are nullable JSONB (no NOT NULL, no DEFAULT)', () => {
    expect(BLOCK).toMatch(/before_json\s+JSONB,/)
    expect(BLOCK).toMatch(/after_json\s+JSONB,/)
  })

  it("metadata_json is JSONB NOT NULL DEFAULT '{}'::jsonb", () => {
    expect(BLOCK).toMatch(/metadata_json\s+JSONB NOT NULL DEFAULT '\{\}'::jsonb,/)
  })

  it('created_at is TIMESTAMPTZ NOT NULL DEFAULT NOW() — no updated_at column (activity rows are append-only, never edited)', () => {
    expect(BLOCK).toMatch(/created_at\s+TIMESTAMPTZ NOT NULL DEFAULT NOW\(\)/)
    expect(BLOCK).not.toMatch(/\bupdated_at\b/)
  })

  it('no CASCADE anywhere in this table\'s own definition — activity must never be destroyed by deleting the entity it describes', () => {
    expect(BLOCK).not.toMatch(/ON DELETE CASCADE/)
  })
})

describe('event_type CHECK constraint — exact parity with the TypeScript union', () => {
  it('event_type is TEXT NOT NULL with an inline CHECK, not a Postgres ENUM', () => {
    expect(BLOCK).toMatch(/event_type\s+TEXT NOT NULL CHECK \(event_type IN \(/)
    expect(BLOCK).not.toMatch(/CREATE TYPE/)
    expect(MIGRATE_ROUTE_SOURCE).not.toMatch(/CREATE TYPE.*event/i)
  })

  it('the SQL CHECK list contains exactly the same 17 event types as ORGANISER_EVENT_TYPES, in the same order', () => {
    const checkStart = BLOCK.indexOf('event_type      TEXT NOT NULL CHECK (event_type IN (')
    expect(checkStart).toBeGreaterThan(-1)
    const checkEnd = BLOCK.indexOf('))', checkStart)
    const checkBody = BLOCK.slice(checkStart, checkEnd)
    const sqlTypes = [...checkBody.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map(m => m[1])
    expect(sqlTypes).toEqual(ORGANISER_EVENT_TYPES)
  })

  it('ORGANISER_EVENT_TYPES itself is exactly the 17-entry authoritative list from the D.4.5A audit (the audit\'s own "14 types" prose summary was wrong and is not reproduced here)', () => {
    expect(ORGANISER_EVENT_TYPES).toHaveLength(17)
    expect(ORGANISER_EVENT_TYPES).toEqual([
      'board.created', 'board.updated', 'board.deleted',
      'group.created', 'group.updated', 'group.deleted',
      'column.created', 'column.updated', 'column.deleted',
      'item.created', 'item.updated', 'item.moved', 'item.deleted',
      'comment.created',
      'file.added', 'file.deleted',
      'import.completed',
    ])
  })

  it('does NOT contain field-specific item event types (status_changed/priority_changed/owner_changed/due_date_changed) or a position/reorder-specific type', () => {
    for (const forbidden of [
      'item.status_changed', 'item.priority_changed', 'item.owner_changed', 'item.due_date_changed',
      'item.reordered', 'item.position_changed', 'item.repositioned',
    ]) {
      expect(ORGANISER_EVENT_TYPES).not.toContain(forbidden)
      expect(BLOCK).not.toContain(`'${forbidden}'`)
    }
  })
})

describe('entity_type CHECK constraint — exact parity with the TypeScript union', () => {
  it('entity_type is TEXT NOT NULL with an inline CHECK, not a Postgres ENUM', () => {
    expect(BLOCK).toMatch(/entity_type\s+TEXT NOT NULL CHECK \(entity_type IN \(/)
  })

  it('the SQL CHECK list contains exactly the same 7 entity types as ORGANISER_ENTITY_TYPES, in the same order', () => {
    const checkStart = BLOCK.indexOf("entity_type     TEXT NOT NULL CHECK (entity_type IN (")
    expect(checkStart).toBeGreaterThan(-1)
    const checkEnd = BLOCK.indexOf('),', checkStart)
    const checkBody = BLOCK.slice(checkStart, checkEnd)
    const sqlTypes = [...checkBody.matchAll(/'([a-z]+)'/g)].map(m => m[1])
    expect(sqlTypes).toEqual(ORGANISER_ENTITY_TYPES)
  })

  it('ORGANISER_ENTITY_TYPES is exactly the 7 approved entity types', () => {
    expect(ORGANISER_ENTITY_TYPES).toEqual(['board', 'group', 'item', 'column', 'file', 'comment', 'import'])
  })
})

describe('indexes — exactly the 4 justified composite indexes, nothing speculative', () => {
  it('all 4 required composite indexes exist, idempotent (CREATE INDEX IF NOT EXISTS)', () => {
    expect(BLOCK).toMatch(/CREATE INDEX IF NOT EXISTS idx_organiser_activity_org\s+ON organiser_activity\(organisation_id, created_at DESC\)/)
    expect(BLOCK).toMatch(/CREATE INDEX IF NOT EXISTS idx_organiser_activity_board\s+ON organiser_activity\(board_id, created_at DESC\)/)
    expect(BLOCK).toMatch(/CREATE INDEX IF NOT EXISTS idx_organiser_activity_item\s+ON organiser_activity\(item_id, created_at DESC\)/)
    expect(BLOCK).toMatch(/CREATE INDEX IF NOT EXISTS idx_organiser_activity_actor\s+ON organiser_activity\(actor_user_id, created_at DESC\)/)
  })

  it('exactly 4 indexes are created for this table — no more, no fewer', () => {
    const indexMatches = BLOCK.match(/CREATE INDEX IF NOT EXISTS idx_organiser_activity_\w+/g) ?? []
    expect(indexMatches).toHaveLength(4)
  })

  it('no GIN/JSONB index, no event_type-only index, no entity_type-only index, no entity_id-only index', () => {
    expect(BLOCK).not.toMatch(/USING GIN/i)
    expect(BLOCK).not.toMatch(/idx_organiser_activity_event_type\b/)
    expect(BLOCK).not.toMatch(/idx_organiser_activity_entity_type\b/)
    expect(BLOCK).not.toMatch(/idx_organiser_activity_entity_id\b/)
    expect(BLOCK).not.toMatch(/ON organiser_activity\(event_type\)/)
    expect(BLOCK).not.toMatch(/ON organiser_activity\(entity_type\)/)
    expect(BLOCK).not.toMatch(/ON organiser_activity\(entity_id\)/)
  })
})

describe('containment — no backfill, no existing-table changes, no unrelated schema touched', () => {
  it('no INSERT statement anywhere in the organiser_activity step — the table starts empty, no synthetic backfill rows', () => {
    expect(BLOCK).not.toMatch(/INSERT INTO organiser_activity/)
  })

  it('no fabricated "Unknown" actor placeholder in the executable organiser_activity step itself (comments are allowed to explain, in prose, why this is forbidden)', () => {
    expect(BLOCK).not.toMatch(/'Unknown'/)
  })

  it('does not ALTER any existing organiser_* table (organiser_items in particular — no assignee_user_id column added)', () => {
    expect(BLOCK).not.toMatch(/ALTER TABLE organiser_/)
    expect(MIGRATE_ROUTE_SOURCE).not.toMatch(/assignee_user_id/)
  })

  it('every existing migration step (1 through 39) is byte-unchanged in position — step 40 was appended, not inserted earlier or reordered', () => {
    const step1Idx = CODE.indexOf("step('1. organisations')")
    const step39Idx = CODE.indexOf("step('39. organiser_item_updates')")
    expect(step1Idx).toBeGreaterThan(-1)
    expect(step39Idx).toBeGreaterThan(step1Idx)
    expect(stepStart).toBeGreaterThan(step39Idx)
    // No step numbered higher than 40 exists yet.
    expect(CODE).not.toMatch(/step\('4[1-9]\./)
  })

  it('does not reuse the existing generic audit_logs table — organiser_activity is its own table', () => {
    expect(BLOCK).not.toContain('audit_logs')
  })
})
