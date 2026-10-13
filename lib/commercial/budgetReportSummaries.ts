type Basis = 'EXCLUSIVE' | 'INCLUSIVE';
type LegacyInput = {
  currency: string; taxBasis: Basis; budgetCents: number; actualCents: number;
  committedCents: number; exposureCents: number; budgetLessActualAndCommittedCents: number;
};
type FinanceInput = {
  currency: string; taxBasis: Basis | null; budgetCents: string; sourceActualCents: string;
  financeAdjustmentCents: string; effectiveActualCents: string; committedCents: string; exposureCents: string;
  externalGlActualCents: string | null; reconciliationVarianceCents: string | null;
  reconciliationStatus: 'SIGNED_OFF' | 'STALE' | null; reconciliationId: string | null; sourceSystemId: string | null;
};
const zero = BigInt(0);
const groupKey = (row: { currency: string; taxBasis: Basis | null }) => JSON.stringify([row.currency, row.taxBasis]);
const sort = (a: { currency: string; taxBasis: Basis | null }, b: { currency: string; taxBasis: Basis | null }) =>
  a.currency.localeCompare(b.currency) || String(a.taxBasis).localeCompare(String(b.taxBasis));

export function budgetBasisLabel(basis: Basis | null): string {
  return basis === null ? 'Budget basis unavailable' : basis === 'INCLUSIVE' ? 'Tax inclusive' : 'Tax exclusive';
}

/** Each wire amount is safe, but its grouped total need not fit a JavaScript number. */
export function buildLegacyBudgetSummaries(rows: readonly LegacyInput[]) {
  const byCurrency = new Map<string, {
    currency: string; taxBasis: Basis; rowCount: number; budgetCents: bigint; actualCents: bigint;
    committedCents: bigint; exposureCents: bigint; remainingCents: bigint;
  }>();
  for (const row of rows) {
    const key = groupKey(row);
    const total = byCurrency.get(key) ?? { currency: row.currency, taxBasis: row.taxBasis, rowCount: 0,
      budgetCents: zero, actualCents: zero, committedCents: zero, exposureCents: zero, remainingCents: zero };
    if (![row.budgetCents, row.actualCents, row.committedCents, row.exposureCents, row.budgetLessActualAndCommittedCents].every(Number.isSafeInteger)) throw new Error('Unsafe legacy report amount.');
    total.rowCount++;
    total.budgetCents += BigInt(row.budgetCents); total.actualCents += BigInt(row.actualCents);
    total.committedCents += BigInt(row.committedCents); total.exposureCents += BigInt(row.exposureCents);
    total.remainingCents += BigInt(row.budgetLessActualAndCommittedCents); byCurrency.set(key, total);
  }
  return [...byCurrency.values()].sort(sort).map(row => ({ ...row,
    budgetCents: row.budgetCents.toString(), actualCents: row.actualCents.toString(),
    committedCents: row.committedCents.toString(), exposureCents: row.exposureCents.toString(), remainingCents: row.remainingCents.toString() }));
}

/** Display qualification only; it does not approve or refresh a stored snapshot. */
export function hasFinanceSnapshotIdentity(row: Pick<FinanceInput, 'reconciliationId' | 'sourceSystemId' | 'reconciliationStatus'>): boolean {
  return !!row.reconciliationId?.trim() && !!row.sourceSystemId?.trim()
    && (row.reconciliationStatus === 'SIGNED_OFF' || row.reconciliationStatus === 'STALE');
}

export function hasCompleteFinanceEvidence(row: Pick<FinanceInput, 'reconciliationId' | 'sourceSystemId' | 'reconciliationStatus' | 'externalGlActualCents' | 'reconciliationVarianceCents'>): boolean {
  return hasFinanceSnapshotIdentity(row) && row.externalGlActualCents !== null && row.reconciliationVarianceCents !== null;
}

export function buildFinanceBudgetSummaries(rows: readonly FinanceInput[]) {
  const byCurrency = new Map<string, {
    currency: string; taxBasis: Basis | null; rowCount: number; evidenceRowCount: number; signedOffRowCount: number; staleRowCount: number;
    budgetCents: bigint; sourceActualCents: bigint; financeAdjustmentCents: bigint; effectiveActualCents: bigint;
    committedCents: bigint; exposureCents: bigint; externalGlActualCents: bigint; reconciliationVarianceCents: bigint;
  }>();
  for (const row of rows) {
    const key = groupKey(row);
    const total = byCurrency.get(key) ?? { currency: row.currency, taxBasis: row.taxBasis, rowCount: 0,
      evidenceRowCount: 0, signedOffRowCount: 0, staleRowCount: 0, budgetCents: zero, sourceActualCents: zero,
      financeAdjustmentCents: zero, effectiveActualCents: zero, committedCents: zero, exposureCents: zero,
      externalGlActualCents: zero, reconciliationVarianceCents: zero };
    total.rowCount++;
    for (const field of ['budgetCents', 'sourceActualCents', 'financeAdjustmentCents', 'effectiveActualCents', 'committedCents', 'exposureCents'] as const) total[field] += BigInt(row[field]);
    const identified = hasFinanceSnapshotIdentity(row);
    if (identified) {
      if (row.reconciliationStatus === 'STALE') total.staleRowCount++; else total.signedOffRowCount++;
    }
    const evidence = hasCompleteFinanceEvidence(row);
    if (evidence) {
      total.evidenceRowCount++;
      total.externalGlActualCents += BigInt(row.externalGlActualCents!);
      total.reconciliationVarianceCents += BigInt(row.reconciliationVarianceCents!);
    }
    byCurrency.set(key, total);
  }
  return [...byCurrency.values()].sort(sort).map(row => ({ ...row,
    budgetCents: row.taxBasis === null ? null : row.budgetCents.toString(), sourceActualCents: row.sourceActualCents.toString(),
    financeAdjustmentCents: row.financeAdjustmentCents.toString(), effectiveActualCents: row.effectiveActualCents.toString(),
    committedCents: row.committedCents.toString(), exposureCents: row.exposureCents.toString(),
    externalGlActualCents: row.evidenceRowCount === row.rowCount ? row.externalGlActualCents.toString() : null,
    reconciliationVarianceCents: row.evidenceRowCount === row.rowCount ? row.reconciliationVarianceCents.toString() : null }));
}
