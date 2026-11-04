import { assessTennisMigration, type MigrationProblem } from './migrationAssessment';
import { readTennisMigrationSnapshot, type MigrationReadExecutor } from './migrationSnapshot';

export interface TennisImportReceipt { source_hash: string; target_hash: string; counts: Record<string, number>; warnings?: MigrationProblem[] }

/** Operator-only, injected executor. No route imports this staged importer. The
 * SQL function rechecks the frozen full-source hash and configuration atomically. */
export async function importTennisHistory(sql: MigrationReadExecutor, organisationId: string, expectedFullHash: string): Promise<TennisImportReceipt> {
  if (!/^[a-f0-9]{64}$/.test(expectedFullHash)) throw Error('Invalid Tennis history manifest');
  const snapshot = await readTennisMigrationSnapshot(sql, organisationId);
  const assessment = assessTennisMigration(snapshot);
  if (!assessment.compatibleProjection) throw Error(`Tennis import requires source review: ${[...new Set(assessment.problems.map(p => p.code))].sort().join(',')}`);
  const result = await sql.query<TennisImportReceipt>('SELECT * FROM scheduling_tennis_import_history($1,$2,$3,$4)',
    [organisationId, expectedFullHash, snapshot.timezone, snapshot.currency]);
  if (result.length !== 1 || result[0].source_hash !== expectedFullHash || !/^[a-f0-9]{64}$/.test(result[0].target_hash)) throw Error('Invalid Tennis import receipt');
  return { ...result[0], warnings: assessment.warnings };
}
