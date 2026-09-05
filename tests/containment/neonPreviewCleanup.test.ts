import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  computeExpectedPreviewBranchName,
  selectExactBranch,
  run,
  PROTECTED_BRANCH_NAMES,
} from '../../scripts/neon/cleanup-preview-branch.mjs'

// Neon preview-branch cleanup — pure branch-name derivation/selection
// logic, plus the run() orchestration with a stubbed fetch (no real
// Neon API call is ever made by this file). See
// scripts/neon/cleanup-preview-branch.mjs's own header for the full
// safety design this proves: exact-name lookup, exact-id deletion,
// fail-safe on anything ambiguous/malformed/protected.

describe('computeExpectedPreviewBranchName — valid branch names', () => {
  it('feat/events-ticket-email-resend -> preview/feat/events-ticket-email-resend', () => {
    expect(computeExpectedPreviewBranchName('feat/events-ticket-email-resend')).toEqual({
      ok: true, target: 'preview/feat/events-ticket-email-resend',
    })
  })

  it('fix/events-dropdown-consistency -> preview/fix/events-dropdown-consistency', () => {
    expect(computeExpectedPreviewBranchName('fix/events-dropdown-consistency')).toEqual({
      ok: true, target: 'preview/fix/events-dropdown-consistency',
    })
  })

  it('trims surrounding whitespace before computing the target', () => {
    expect(computeExpectedPreviewBranchName('  feat/foo  ')).toEqual({ ok: true, target: 'preview/feat/foo' })
  })
})

describe('computeExpectedPreviewBranchName — protected-name branches always end up prefixed, never bypassed', () => {
  for (const name of PROTECTED_BRANCH_NAMES) {
    it(`a git branch literally named "${name}" computes to "preview/${name}", never the bare protected name`, () => {
      const result = computeExpectedPreviewBranchName(name)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.target).toBe(`preview/${name}`)
        expect(PROTECTED_BRANCH_NAMES.has(result.target)).toBe(false)
      }
    })
  }
})

describe('computeExpectedPreviewBranchName — malformed/empty input never produces a deletable target', () => {
  it('empty string is rejected', () => {
    expect(computeExpectedPreviewBranchName('').ok).toBe(false)
  })

  it('whitespace-only string is rejected', () => {
    expect(computeExpectedPreviewBranchName('   ').ok).toBe(false)
  })

  it('non-string input is rejected', () => {
    expect(computeExpectedPreviewBranchName(undefined).ok).toBe(false)
    expect(computeExpectedPreviewBranchName(null).ok).toBe(false)
    expect(computeExpectedPreviewBranchName(123).ok).toBe(false)
  })

  it('a branch name containing ".." is rejected', () => {
    expect(computeExpectedPreviewBranchName('feat/../production').ok).toBe(false)
  })

  it('a branch name starting or ending with "/" is rejected', () => {
    expect(computeExpectedPreviewBranchName('/feat/foo').ok).toBe(false)
    expect(computeExpectedPreviewBranchName('feat/foo/').ok).toBe(false)
  })

  it('a branch name with unexpected characters (spaces, shell metacharacters) is rejected', () => {
    expect(computeExpectedPreviewBranchName('feat/foo bar').ok).toBe(false)
    expect(computeExpectedPreviewBranchName('feat/foo;rm -rf').ok).toBe(false)
    expect(computeExpectedPreviewBranchName('feat/foo$(whoami)').ok).toBe(false)
  })
})

describe('selectExactBranch — exact-match selection', () => {
  const branches = [
    { id: 'br-1', name: 'preview/feat/events-ticket-email-resend' },
    { id: 'br-2', name: 'preview/fix/events-dropdown-consistency' },
    { id: 'br-3', name: 'preview/feat/events-ticket-email-resend-old' },
  ]

  it('selects the single exact-name match', () => {
    const result = selectExactBranch(branches, 'preview/feat/events-ticket-email-resend')
    expect(result).toEqual({ ok: true, found: true, branch: { id: 'br-1', name: 'preview/feat/events-ticket-email-resend' } })
  })

  it('does NOT select a similarly-named branch via substring/prefix matching', () => {
    // 'preview/feat/events-ticket-email-resend-old' must never be picked
    // when looking for the shorter exact name.
    const result = selectExactBranch(branches, 'preview/feat/events-ticket-email-resend')
    expect(result.ok && result.found && result.branch.id).toBe('br-1')
  })

  it('reports not-found when no branch matches exactly', () => {
    const result = selectExactBranch(branches, 'preview/does-not-exist')
    expect(result).toEqual({ ok: true, found: false })
  })

  it('refuses when multiple branches somehow share the exact same name', () => {
    const dup = [...branches, { id: 'br-4', name: 'preview/feat/events-ticket-email-resend' }]
    const result = selectExactBranch(dup, 'preview/feat/events-ticket-email-resend')
    expect(result.ok).toBe(false)
  })
})

describe('selectExactBranch — protected branches are never selectable, even via a direct call', () => {
  const branches = [
    { id: 'prod-1', name: 'production' },
    { id: 'mig-1', name: 'c1-migration-rehearsal' },
    { id: 'dev-1', name: 'vercel-dev' },
  ]

  for (const name of PROTECTED_BRANCH_NAMES) {
    it(`refuses to select "${name}" even if it were passed directly as the target`, () => {
      const result = selectExactBranch(branches, name)
      expect(result.ok).toBe(false)
    })
  }

  it('refuses any target name that does not start with "preview/"', () => {
    expect(selectExactBranch(branches, 'main').ok).toBe(false)
    expect(selectExactBranch(branches, 'staging').ok).toBe(false)
  })
})

describe('run() — full orchestration against a stubbed Neon API (no real network call)', () => {
  const apiKey = 'test-neon-key'
  const projectId = 'test-project-id'

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('dry-run mode: finds the exact branch but never calls DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ branches: [{ id: 'br-1', name: 'preview/feat/events-ticket-email-resend' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: true })

    expect(result).toEqual({ deleted: false, dryRun: true, branch: { id: 'br-1', name: 'preview/feat/events-ticket-email-resend' } })
    expect(fetchMock).toHaveBeenCalledTimes(1) // list only — no DELETE call
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/branches')
    expect(opts?.method).not.toBe('DELETE')
  })

  it('full flow: finds and deletes the exact branch by id', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ branches: [{ id: 'br-1', name: 'preview/feat/events-ticket-email-resend' }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: false })

    expect(result).toEqual({ deleted: true, branch: { id: 'br-1', name: 'preview/feat/events-ticket-email-resend' } })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [deleteUrl, deleteOpts] = fetchMock.mock.calls[1]
    expect(deleteUrl).toContain('/branches/br-1')
    expect(deleteOpts.method).toBe('DELETE')
  })

  it('branch already absent: succeeds without calling DELETE', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ branches: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    const result = await run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: false })

    expect(result).toEqual({ deleted: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('Neon API unavailable (list-branches fails): throws, no fallback deletion', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => 'unavailable' })
    vi.stubGlobal('fetch', fetchMock)

    await expect(run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: false })).rejects.toThrow()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('missing NEON_API_KEY/PROJECT_ID: throws before any network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(run({ headRef: 'feat/events-ticket-email-resend', apiKey: '', projectId: '', dryRun: false })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('malformed head ref: throws before any network call', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(run({ headRef: '', apiKey, projectId, dryRun: false })).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('multiple exact matches: throws rather than guessing which to delete', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        branches: [
          { id: 'br-1', name: 'preview/feat/events-ticket-email-resend' },
          { id: 'br-2', name: 'preview/feat/events-ticket-email-resend' },
        ],
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: false })).rejects.toThrow()
  })

  it('an unrelated preview branch present in the list is never selected/deleted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ branches: [{ id: 'br-unrelated', name: 'preview/fix/some-other-branch' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await run({ headRef: 'feat/events-ticket-email-resend', apiKey, projectId, dryRun: false })
    expect(result).toEqual({ deleted: false })
    expect(fetchMock).toHaveBeenCalledTimes(1) // list only, never a DELETE against the unrelated branch
  })
})
