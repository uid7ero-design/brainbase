/** Loaded history summaries do not assess present year-close readiness. */
export function describeYearCloseHistoryTotals(totals:Record<string,unknown>|undefined):string{
  if(totals?.basis!=='C7_9_YEAR_CLOSE')return 'No recognised year-count summary. Inspect the saved evidence and raw totals.';
  const periods=totals.financialPeriodCount,closes=totals.currentPeriodCloseCount;
  if(typeof periods!=='number'||!Number.isSafeInteger(periods)||periods<0||typeof closes!=='number'||!Number.isSafeInteger(closes)||closes<0||closes>periods)return 'Saved year counts are incomplete. Inspect the saved evidence.';
  return `At close: ${periods} financial periods · ${closes} current period closes.`;
}
