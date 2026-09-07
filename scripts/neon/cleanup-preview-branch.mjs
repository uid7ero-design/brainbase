#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
// Deletes a single stale Neon preview-database branch after its PR has
// merged. Run by .github/workflows/neon-preview-cleanup.yml on
// pull_request(closed) where merged == true.
//
// Safety design (see PROTECTED_BRANCH_NAMES below and every check in
// computeExpectedPreviewBranchName/selectExactBranch): this script may
// ONLY ever delete a branch whose name is exactly `preview/<head-ref>`,
// found by an EXACT name match against Neon's own branch list, deleted
// by its exact branch id — never a substring match, never a wildcard,
// never "all preview/* branches". A malformed/empty head ref, a target
// that happens to collide with a protected name, more than one exact
// match, or the Neon API being unreachable all fail the script visibly
// (non-zero exit) rather than silently doing nothing AND rather than
// falling back to any other selection strategy.
//
// The exact Neon branch-naming convention (`preview/<git-branch>`) is
// this repo's own working assumption, not something independently
// confirmed against a live Neon project during this script's
// authoring (no NEON_API_KEY/NEON_PROJECT_ID was available in that
// session). This is safe regardless: the script only ever acts on an
// EXACT name match against whatever Neon actually reports, so if the
// real convention differs, the exact-match lookup simply reports "not
// found" and exits successfully — it can never mis-select a different,
// unrelated branch as a result of a wrong naming guess.

const NEON_API_BASE = 'https://console.neon.tech/api/v2';

export const PROTECTED_BRANCH_NAMES = new Set([
  'production',
  'c1-migration-rehearsal',
  'vercel-dev',
]);

// Deliberately conservative character set for a git branch name — this
// isn't used in any shell/SQL context (only as a JSON string in a
// fetch() call), so it isn't a literal injection vector, but rejecting
// anything unexpected here keeps the "malformed branch" failure mode
// (Phase F/G) an explicit, visible rejection rather than an
// accidentally-permissive pass-through.
const VALID_HEAD_REF = /^[A-Za-z0-9._/-]+$/;

/**
 * Pure — computes the expected Neon preview-branch name for a given PR
 * head ref, or a structured failure reason. Never talks to the network.
 * @param {unknown} headRef
 * @returns {{ ok: true, target: string } | { ok: false, reason: string }}
 */
export function computeExpectedPreviewBranchName(headRef) {
  if (typeof headRef !== 'string') {
    return { ok: false, reason: 'headRef must be a string' };
  }
  const trimmed = headRef.trim();
  if (!trimmed) {
    return { ok: false, reason: 'headRef is empty' };
  }
  if (!VALID_HEAD_REF.test(trimmed)) {
    return { ok: false, reason: `headRef "${trimmed}" contains unexpected characters` };
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/') || trimmed.includes('..')) {
    return { ok: false, reason: `headRef "${trimmed}" is not a well-formed branch name` };
  }

  const target = `preview/${trimmed}`;

  // Structurally impossible given the template above, but checked
  // explicitly rather than trusted implicitly — this is the one
  // invariant every downstream deletion decision depends on.
  if (!target.startsWith('preview/')) {
    return { ok: false, reason: 'computed target does not start with preview/' };
  }
  if (PROTECTED_BRANCH_NAMES.has(target)) {
    return { ok: false, reason: `computed target "${target}" matches a protected branch name` };
  }

  return { ok: true, target };
}

/**
 * Pure — given Neon's branch list and the exact target name, selects
 * the single branch to delete, or a structured reason not to. Never
 * talks to the network.
 * @param {Array<{ id: string, name: string }>} branches
 * @param {string} targetName
 * @returns {{ ok: true, found: false } | { ok: true, found: true, branch: { id: string, name: string } } | { ok: false, reason: string }}
 */
export function selectExactBranch(branches, targetName) {
  if (typeof targetName !== 'string' || !targetName.startsWith('preview/')) {
    return { ok: false, reason: 'refusing to select a non-preview/ branch name' };
  }
  if (PROTECTED_BRANCH_NAMES.has(targetName)) {
    return { ok: false, reason: 'refusing to select a protected branch name' };
  }
  if (!Array.isArray(branches)) {
    return { ok: false, reason: 'branches list is not an array' };
  }

  const matches = branches.filter(b => b && b.name === targetName);

  if (matches.length === 0) {
    return { ok: true, found: false };
  }
  if (matches.length > 1) {
    return { ok: false, reason: `multiple branches matched exact name "${targetName}" — refusing to guess` };
  }

  const branch = matches[0];
  if (PROTECTED_BRANCH_NAMES.has(branch.name)) {
    return { ok: false, reason: 'matched branch resolves to a protected name — refusing' };
  }

  return { ok: true, found: true, branch: { id: branch.id, name: branch.name } };
}

async function fetchBranches(apiKey, projectId) {
  const res = await fetch(`${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Neon API list-branches failed: ${res.status} ${body}`);
  }
  const json = await res.json();
  return json.branches ?? [];
}

async function deleteBranch(apiKey, projectId, branchId) {
  const res = await fetch(`${NEON_API_BASE}/projects/${encodeURIComponent(projectId)}/branches/${encodeURIComponent(branchId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Neon API delete-branch failed: ${res.status} ${body}`);
  }
}

export async function run({ headRef, apiKey, projectId, dryRun }) {
  const computed = computeExpectedPreviewBranchName(headRef);
  if (!computed.ok) {
    throw new Error(`Refusing to proceed: ${computed.reason}`);
  }
  const target = computed.target;
  console.log(`[neon-cleanup] expected preview branch: ${target}`);

  if (!apiKey || !projectId) {
    throw new Error('NEON_API_KEY and NEON_PROJECT_ID must both be set — refusing to proceed without them.');
  }

  const branches = await fetchBranches(apiKey, projectId);
  const selection = selectExactBranch(branches, target);
  if (!selection.ok) {
    throw new Error(`Refusing to proceed: ${selection.reason}`);
  }
  if (!selection.found) {
    console.log(`[neon-cleanup] preview branch "${target}" already absent — nothing to do.`);
    return { deleted: false };
  }

  const { branch } = selection;
  if (dryRun) {
    console.log(`[neon-cleanup] DRY RUN — would delete branch id=${branch.id} name=${branch.name}`);
    return { deleted: false, dryRun: true, branch };
  }

  await deleteBranch(apiKey, projectId, branch.id);
  console.log(`[neon-cleanup] deleted branch id=${branch.id} name=${branch.name}`);
  return { deleted: true, branch };
}

// Only executes when run directly (`node scripts/neon/cleanup-preview-branch.mjs`),
// never when imported by tests — keeps the pure functions above
// importable without triggering any network call or process.exit().
// Compared via fileURLToPath() rather than a raw `file://${...}`
// string template: on Windows, import.meta.url is a URL
// (file:///C:/...) while process.argv[1] is an OS-native path
// (C:\...) — a naive string comparison never matches, which silently
// skipped this entire block (a real bug caught by manually exercising
// the CLI, not by the mocked unit tests above, which import the pure
// functions directly and never exercise this guard at all).
const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMainModule) {
  const headRef = process.env.HEAD_REF ?? '';
  const apiKey = process.env.NEON_API_KEY ?? '';
  const projectId = process.env.NEON_PROJECT_ID ?? '';
  const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');

  run({ headRef, apiKey, projectId, dryRun })
    .then(result => {
      if (result.deleted) console.log('[neon-cleanup] done — branch deleted.');
      process.exit(0);
    })
    .catch(err => {
      console.error(`[neon-cleanup] FAILED: ${err.message}`);
      process.exit(1);
    });
}
