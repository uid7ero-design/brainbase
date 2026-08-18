import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// Static source-text assertion, not a claim of proven rendering behaviour —
// this project has no jsdom/React Testing Library harness. See
// tennisInitialFrequencyStaticChecks.test.ts for the same caveat spelled
// out in full.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static source checks (selected-date metrics)', () => {
  it('PLAYERS/FILL RATE derive from the selected instance roster, not the session-wide enrolled_count', () => {
    expect(source).toContain('const selectedPlayers        = instanceDetail ? instanceDetail.bookings.length : (selectedSession?.enrolled_count ?? 0)')
    expect(source).toContain('const selectedCapacity       = instanceDetail ? instanceDetail.instance.max_capacity : (selectedSession?.max_capacity ?? 0)')
    // Must not have regressed to reading straight off the session-wide aggregate.
    expect(source).not.toMatch(/\{selectedSession\.enrolled_count\}/)
  })

  it('PAID (this date) already correctly used instanceDetail.bookings and is unchanged', () => {
    expect(source).toContain('Paid (this date)')
    expect(source).toContain('{paidCount}')
  })
})
