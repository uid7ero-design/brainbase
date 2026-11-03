import { execFileSync } from 'node:child_process';
// Deliberate prerequisite, not an implicit merge or a live migration. Fetch PR #462's
// branch before this test if the pinned object is absent. Never use its mutable head.
export const CAPACITY_PROOF_COMMIT = '777f9148eace08bd3ad541c5963586d37c134ef1';
export function capacityFixtureSql() {
  return execFileSync('git', ['show', `${CAPACITY_PROOF_COMMIT}:scripts/add-booking-capacity-guard.sql`], { encoding: 'utf8', windowsHide: true });
}
