export const D4D5Q_BLOB = 'cc7f948944b1f0bd772a140d33be901736c5ca26';
export const FIXTURE_PREPARATION = 'Synthetic raw staging; existing normalization route and profiler service';
export const ARTIFACTS = ['evidence.json', 'next-server.log', 'counts-mobile.png', 'planning-mobile.png', 'planning-timeout-mobile.png', 'planning-paging-mobile.png'];
export const PROOF_LIMITS = [
  'Hosted authenticated Neon transport is unverified.',
  'File upload, inspection and raw staging are outside this fixture.',
  'Larger tenant workloads, screen-reader and color-contrast acceptance remain separate.',
  'Target migration state, backup/restore readiness and owner release authorization are unverified.',
];

// A local validation record, never a release grant or independent attestation.
// Project only fixed fields and hashes; never copy diagnostics, actor data or URLs.
export function createAcceptanceReceipt(input) {
  const invalid = () => { throw new Error('ACCEPTANCE_RECEIPT_INVALID'); };
  if (!input || !/^[0-9a-f]{40}$/.test(input.candidateCommit) || input.finalCommit !== input.candidateCommit ||
      input.migrationBlob !== D4D5Q_BLOB || typeof input.buildId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(input.buildId) ||
      ![input.startedAt, input.completedAt].every(value => typeof value === 'string' && Number.isFinite(Date.parse(value))) ||
      Date.parse(input.completedAt) < Date.parse(input.startedAt) || input.cleanWorktree !== true) invalid();
  const evidence = input.evidence;
  if (!evidence || evidence.passed !== true || evidence.productionTouched !== false ||
      evidence.transport !== 'Local Neon transport; real application and PostgreSQL' ||
      evidence.fixturePreparation !== FIXTURE_PREPARATION || !Array.isArray(evidence.checks) || evidence.checks.length < 1 ||
      evidence.checks.some(value => typeof value !== 'string' || !value.trim())) invalid();
  if (!input.cleanup || ['ownedDatabaseRemoved', 'loginFixtureRemoved', 'localListenerClosed']
    .some(key => input.cleanup[key] !== true)) invalid();
  if (!input.artifactHashes || Object.keys(input.artifactHashes).length !== ARTIFACTS.length ||
      ARTIFACTS.some(name => !/^[0-9a-f]{64}$/.test(input.artifactHashes[name]))) invalid();
  return {
    receiptVersion: 'v1', status: 'passed', candidateCommit: input.candidateCommit,
    startedAt: input.startedAt, completedAt: input.completedAt, buildId: input.buildId,
    migrationGitBlob: D4D5Q_BLOB, environment: 'Owned loopback PostgreSQL and built local application',
    validation: { optimizedBuild: true, postgresAndBrowserHarness: true, browserCheckCount: evidence.checks.length },
    fixturePreparation: FIXTURE_PREPARATION,
    cleanup: { ownedDatabaseRemoved: true, loginFixtureRemoved: true, localListenerClosed: true },
    artifactSha256: Object.fromEntries(ARTIFACTS.map(name => [name, input.artifactHashes[name]])),
    productionTouched: false, releaseAuthorized: false, proofLimits: [...PROOF_LIMITS],
  };
}
