import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

// This project has no jsdom/React Testing Library set up (vitest.config.ts
// uses environment: 'node'), so these are deliberately static source-text
// assertions, not proof of actual rendering/re-render behaviour — that
// distinction matters and is not glossed over: these tests prove the
// correct logic/wiring is present in the source, not that a browser
// genuinely re-renders correctly. They exist to catch a regression where
// someone edits the gating condition back to the previously-broken form
// without adding a rendering harness this project doesn't have.

const SOURCE_PATH = path.resolve(__dirname, '../../app/dashboard/sessions/page.tsx')
const source = fs.readFileSync(SOURCE_PATH, 'utf-8')

describe('app/dashboard/sessions/page.tsx — static source checks (Bug 1: initial frequency gate)', () => {
  it('the Weekly/Once selector is gated on canOfferWeekly, not on sessionRecurring alone', () => {
    // The production bug: sessions can have future instances to propagate
    // into (generate-instances / session creation both run unconditionally
    // of the `recurring` flag) even when `recurring` is false, so gating
    // purely on the flag wrongly hid the choice. canOfferWeekly must OR in
    // a real-data signal (hasOtherInstances), not just the flag.
    expect(source).toContain('const canOfferWeekly = sessionRecurring || hasOtherInstances')
    expect(source).toContain('{canOfferWeekly && (')
    // Must not have regressed back to gating on the flag alone.
    expect(source).not.toContain('{sessionRecurring && (')
  })

  it('hasOtherInstances is computed from the real per-session instances list, not hardcoded', () => {
    expect(source).toMatch(/hasOtherInstances=\{instances\.some\(i => i\.id !== instanceDetail\.instance\.id\)\}/)
  })

  it('InstanceRoster is keyed by instance id, so its frequency default resets when Luke switches dates (no stale closure)', () => {
    expect(source).toMatch(/<InstanceRoster\s*\n\s*key=\{instanceDetail\.instance\.id\}/)
  })
})
