type ReviewLine = { id: string; annual_budget_cents: string };
type ReviewAllocation = { budget_line_id: string; amount_cents: string };

// Reconcile each line separately: offsetting shortages and excesses must not
// make an incomplete Budget appear balanced. Keep aggregate cents exact too.
export function reviewBudgetAllocations(lines: ReviewLine[], allocations: ReviewAllocation[]) {
  const amounts = new Map<string, bigint>();
  for (const allocation of allocations) {
    amounts.set(allocation.budget_line_id, (amounts.get(allocation.budget_line_id) ?? BigInt(0)) + BigInt(allocation.amount_cents));
  }
  let annualTotal = BigInt(0), allocatedTotal = BigInt(0), unbalancedLines = 0;
  const reviewedLines = lines.map(line => {
    const annual = BigInt(line.annual_budget_cents);
    const allocated = amounts.get(line.id) ?? BigInt(0);
    const difference = annual - allocated;
    annualTotal += annual;
    allocatedTotal += allocated;
    if (difference !== BigInt(0)) unbalancedLines++;
    return {
      id: line.id,
      allocatedCents: allocated.toString(),
      differenceCents: difference.toString(),
      state: difference > BigInt(0) ? 'UNDER' as const : difference < BigInt(0) ? 'OVER' as const : 'BALANCED' as const,
    };
  });
  return { annualTotalCents: annualTotal.toString(), allocatedTotalCents: allocatedTotal.toString(), unbalancedLines, lines: reviewedLines };
}
