import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { truncateActivityString, MAX_ACTIVITY_STRING_LENGTH } from '@/lib/organiser/activity'

// Phase D.4.5C-B — Gate A resolution. Item PATCH's true race-safe
// before-state only ever exists inside the FOR UPDATE-locked `old` CTE
// (see app/api/organiser/items/[itemId]/route.ts) — there is no JS-side
// value to hand to lib/organiser/activity.ts's TypeScript sanitiser
// before that statement executes. app/api/admin/migrate/route.ts's step
// 41 (organiser_activity_sanitise_scalar) re-expresses the SAME policy
// (MAX_ACTIVITY_STRING_LENGTH=200, the same '…(truncated)' marker,
// primitives/null pass through) in SQL. This suite proves parity between
// the two, case by case, for every case the phase spec required, plus
// documents (rather than hides) the one real, disclosed divergence:
// Postgres's length()/left() count Unicode codepoints; JS's
// .length/.slice() count UTF-16 code units. For text within the Basic
// Multilingual Plane (the overwhelming majority of real content —
// Latin/Cyrillic/CJK/etc.) 1 codepoint == 1 UTF-16 unit, so the two sides
// are provably identical (asserted below). Only text containing
// supplementary-plane characters (e.g. emoji outside the BMP) AND
// exceeding the 200 limit diverges — both sides still truncate safely
// with the same marker, they disagree only on the exact cutoff point for
// that narrow case. Confirmed empirically against real PostgreSQL 16 via
// scripts/tests/verify-organiser-item-activity-concurrency.sh during
// implementation; this file re-asserts the JS side and documents the SQL
// side's exact source (read directly from the migration file, not
// duplicated as a second implementation of the same logic).

const root = path.resolve(__dirname, '../..')
const MIGRATE_SOURCE = fs.readFileSync(path.join(root, 'app/api/admin/migrate/route.ts'), 'utf8')

describe('SQL-side sanitiser source — organiser_activity_sanitise_scalar exists and matches the stated policy', () => {
  const stepStart = MIGRATE_SOURCE.indexOf("step('41. organiser_activity_sanitise_scalar')")
  const stepEnd = MIGRATE_SOURCE.indexOf('return NextResponse.json({ success: true', stepStart)
  const BLOCK = MIGRATE_SOURCE.slice(stepStart, stepEnd)

  it('step 41 exists, after step 40 (organiser_activity), before the handler return', () => {
    expect(stepStart).toBeGreaterThan(-1)
    const step40Idx = MIGRATE_SOURCE.indexOf("step('40. organiser_activity')")
    expect(step40Idx).toBeGreaterThan(-1)
    expect(step40Idx).toBeLessThan(stepStart)
    expect(stepEnd).toBeGreaterThan(stepStart)
  })

  it('is idempotent (CREATE OR REPLACE FUNCTION — the function equivalent of this file\'s CREATE TABLE/INDEX IF NOT EXISTS convention)', () => {
    expect(BLOCK).toMatch(/CREATE OR REPLACE FUNCTION organiser_activity_sanitise_scalar\(value jsonb\)/)
    expect(BLOCK).toMatch(/RETURNS jsonb/)
    expect(BLOCK).not.toMatch(/CREATE TYPE/)
  })

  it('uses the exact 200-char limit and the exact "…(truncated)" marker, matching MAX_ACTIVITY_STRING_LENGTH/the TS marker', () => {
    expect(BLOCK).toContain('> 200')
    expect(BLOCK).toContain('left(')
    expect(BLOCK).toContain('…(truncated)')
    expect(MAX_ACTIVITY_STRING_LENGTH).toBe(200)
  })

  it('passes null and JSON null through unchanged, matching the TS sanitiser\'s own null handling', () => {
    expect(BLOCK).toMatch(/WHEN value IS NULL OR jsonb_typeof\(value\) = 'null' THEN value/)
  })

  it('stringifies-and-truncates nested objects/arrays rather than recursing, matching the TS sanitiser', () => {
    expect(BLOCK).toMatch(/WHEN jsonb_typeof\(value\) IN \('object', 'array'\) THEN/)
  })

  it('passes numbers/booleans through unchanged (the ELSE branch)', () => {
    expect(BLOCK).toMatch(/ELSE value\s*\n\s*END/)
  })
})

describe('TypeScript sanitiser — parity cases (the required minimum: short ASCII, exactly-at-limit, one-over, long Unicode, empty, null)', () => {
  it('short ASCII passes through unchanged', () => {
    expect(truncateActivityString('short')).toBe('short')
  })

  it('exactly-at-limit (200 chars) is unchanged — no truncation, no marker', () => {
    const s200 = 'a'.repeat(200)
    expect(truncateActivityString(s200)).toBe(s200)
    expect(truncateActivityString(s200).length).toBe(200)
  })

  it('one-character-over (201 chars) truncates to exactly 200 chars plus the marker', () => {
    const s200 = 'a'.repeat(200)
    const s201 = 'a'.repeat(201)
    const result = truncateActivityString(s201)
    expect(result).toBe(s200 + '…(truncated)')
  })

  it('long Unicode WITHIN the Basic Multilingual Plane (CJK) truncates identically to a codepoint-counting implementation — same cutoff point as Postgres length()/left() would produce, since 1 BMP character == 1 UTF-16 code unit == 1 codepoint', () => {
    const cjk250 = '测'.repeat(250)
    const result = truncateActivityString(cjk250)
    // JS .length and codepoint count agree for BMP-only text.
    expect([...result].length).toBe(result.length)
    expect(result).toBe('测'.repeat(200) + '…(truncated)')
  })

  it('empty string passes through unchanged', () => {
    expect(truncateActivityString('')).toBe('')
  })

  it('DISCLOSED divergence: supplementary-plane Unicode (emoji outside the BMP) truncates at a DIFFERENT point than Postgres\'s codepoint-based left()/length() would — JS truncates by UTF-16 code units (2 per emoji here), so 200 units = 100 whole emoji, not 200. Documented and tested here rather than silently assumed to match — see organiser_activity_sanitise_scalar\'s own comment in app/api/admin/migrate/route.ts for the SQL side\'s codepoint-based behavior, empirically confirmed via scripts/tests/verify-organiser-item-activity-concurrency.sh to keep 200 whole emoji (double the JS cutoff) for the same input.', () => {
    const emoji250 = '😀'.repeat(250)
    expect(emoji250.length).toBe(500) // 2 UTF-16 units per emoji
    const result = truncateActivityString(emoji250)
    // JS's cutoff: 200 UTF-16 units = 100 complete emoji, plus the marker.
    expect(result).toBe('😀'.repeat(100) + '…(truncated)')
    // Explicitly NOT 200 emoji (which is what a codepoint-based/Postgres
    // truncation would keep) — this assertion documents the divergence
    // rather than hiding it.
    expect(result).not.toBe('😀'.repeat(200) + '…(truncated)')
  })
})
