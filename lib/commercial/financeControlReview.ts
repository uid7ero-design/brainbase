import { isFinanceAuditTimestamp } from './financeSetupDisplay';

type CalendarSelection = { id: string; name: string; status: 'OPEN' | 'CLOSED' };
export type FinanceReviewSnapshot = {
  id: string; financialYearId: string; financialPeriodId: string; sourceSystemId: string; currency: string;
  status: 'PREPARED' | 'REVIEWED' | 'SIGNED_OFF' | 'STALE'; closeId: string | null;
  varianceCents: string; unresolvedItemCount: number; snapshotAt: string;
};
export type FinanceControlReviewInput = {
  available: boolean; year: CalendarSelection | null; period: CalendarSelection | null;
  source: string; currency: string; activeClose: { id: string; status: 'CLOSED' | 'INVALIDATED' } | null;
  snapshots: FinanceReviewSnapshot[];
};
export type FinanceReviewStep = { title: string; state: string; detail: string; href: string; action: string };
function describeFinanceControls(input: FinanceControlReviewInput): { summary: string; snapshot: FinanceReviewSnapshot | null; steps: FinanceReviewStep[] } {
  const step = (title: string, state: string, detail: string, href: string, action: string): FinanceReviewStep => ({ title, state, detail, href, action });
  if (!input.available) return { summary: 'Refresh the saved control scope before using this checklist.', snapshot: null, steps: [
    step('Saved controls', 'Unavailable', 'Loading, an action in progress or an unconfirmed save pauses this review. Previously loaded evidence is not used here.', '#finance-control-scope', 'Review scope and refresh'),
  ] };
  if (!input.year || !input.period || !input.source.trim() || !/^[A-Z]{3}$/.test(input.currency)) return {
    summary: 'Choose a financial year, period, External GL source and currency.', snapshot: null, steps: [
      step('Control scope', 'Selection required', 'A reconciliation belongs to one period, source and currency. No saved comparison can be inferred from an incomplete scope.', '#finance-control-scope', 'Complete the control scope'),
    ],
  };
  const { year, period } = input;
  const candidates = input.snapshots.filter(row => row.financialYearId === year.id && row.financialPeriodId === period.id && row.sourceSystemId === input.source && row.currency === input.currency);
  const steps: FinanceReviewStep[] = [step('Selected scope', 'Selected', `${year.name} · ${period.name} · ${input.source} · ${input.currency}. Other sources and currencies are outside this checklist.`, '#finance-control-scope', 'Review control scope')];
  const validClose = input.activeClose?.status === 'CLOSED' && typeof input.activeClose.id === 'string' && input.activeClose.id.trim() ? input.activeClose : null;
  steps.push(step('Financial calendar', `${year.status} year · ${period.status} period`,
    period.status === 'CLOSED' ? validClose ? `Current saved period close: ${validClose.id}.` : 'The period is CLOSED but a current close record is unavailable. Refresh and review close history.'
      : year.status === 'CLOSED' ? 'The financial year is CLOSED. Review its controls before attempting period changes.' : 'The period is OPEN. Closing is a separate action; saved reconciliation state does not close it.',
    year.status === 'CLOSED' ? '#finance-year-controls' : '#finance-period-controls', year.status === 'CLOSED' ? 'Review year controls' : 'Review period controls'));
  steps.push(step('Server close checks', 'Not assessed by this checklist', 'Draft adjustments, overlapping periods, concurrent changes and all other close rules are checked by the server when a close is requested. The selected currency does not limit period-wide checks.', '#finance-adjustment-review', 'Review saved adjustments'));
  if (candidates.length > 1) return { summary: 'Multiple snapshots match this scope. Refresh before relying on a latest state.', snapshot: null, steps: [...steps,
    step('Saved comparison', 'Ambiguous', 'This checklist does not choose between duplicate latest snapshots.', '#finance-control-scope', 'Refresh saved controls'),
  ] };
  const snapshot = candidates[0] ?? null;
  if (!snapshot) return { summary: 'Prepare a saved comparison for this scope.', snapshot: null, steps: [...steps,
    step('Saved comparison', 'Not prepared', 'No loaded reconciliation matches this exact year, period, source and currency. This is not evidence of zero variance.', '#finance-reconciliation-prepare', 'Review preparation controls'),
  ] };
  if (typeof snapshot.id !== 'string' || !snapshot.id.trim() || !['PREPARED', 'REVIEWED', 'SIGNED_OFF', 'STALE'].includes(snapshot.status) || !/^-?(0|[1-9]\d*)$/.test(snapshot.varianceCents)
    || !Number.isSafeInteger(snapshot.unresolvedItemCount) || snapshot.unresolvedItemCount < 0 || !isFinanceAuditTimestamp(snapshot.snapshotAt)
    || (snapshot.closeId !== null && (typeof snapshot.closeId !== 'string' || !snapshot.closeId.trim()))) return {
      summary: 'Saved comparison evidence is incomplete. Refresh the control scope.', snapshot: null, steps: [...steps,
        step('Saved comparison', 'Unavailable', 'Incomplete amounts, identities, counts or timestamps cannot establish a review state.', '#finance-control-scope', 'Refresh saved controls'),
      ],
    };
  const issues = snapshot.unresolvedItemCount > 0;
  const variance = BigInt(snapshot.varianceCents) !== BigInt(0);
  steps.push(step('Saved comparison', snapshot.status, `Snapshot ${snapshot.id}. Unresolved items: ${snapshot.unresolvedItemCount}. ${variance ? 'A non-zero variance is recorded.' : 'A zero variance is recorded; it does not establish approval or a closed period.'}`, '#finance-reconciliation-review', 'Review saved reconciliation'));
  if (issues) steps.push(step('Unresolved comparison items', 'Needs investigation', 'Review source mappings and saved evidence before relying on the comparison. Preparing again is a separate action after corrections.', '/commercial/budgeting/external-gl', 'Review External GL mappings'));
  if (snapshot.status === 'STALE') return { summary: 'The saved comparison is stale. Review changes and prepare a fresh snapshot.', snapshot, steps: [...steps,
    step('Next review step', 'Fresh snapshot required', 'The old snapshot remains history. A zero old variance cannot make stale evidence current.', '#finance-reconciliation-prepare', 'Review preparation controls'),
  ] };
  if (snapshot.status === 'SIGNED_OFF') {
    const linked = period.status === 'CLOSED' && !!validClose && snapshot.closeId === validClose.id;
    return { summary: issues ? 'The saved comparison is marked signed off and still records unresolved items. Inspect its evidence.' : linked ? 'The selected saved comparison is signed off against the current period close.' : 'Review the signed-off comparison’s close linkage.', snapshot, steps: [...steps,
      step('Sign-off linkage', linked ? 'Linked to current close' : 'Needs review', linked ? 'This describes only the selected source and currency. It does not establish year-close readiness or cover other comparisons.' : 'The saved sign-off does not link to the loaded current CLOSED period record. Refresh and inspect the retained close history.', '#finance-reconciliation-review', 'Review sign-off evidence'),
    ] };
  }
  if (snapshot.status === 'PREPARED') return { summary: issues ? 'Investigate unresolved items in the prepared comparison.' : 'Review the prepared comparison and its evidence.', snapshot, steps };
  return { summary: issues ? 'Investigate unresolved items in the reviewed comparison.' : period.status === 'CLOSED' && validClose ? 'Review the saved comparison and current close before sign-off.' : 'The comparison is reviewed; inspect period-close controls before sign-off.', snapshot, steps };
}

export function reviewFinanceControls(input:FinanceControlReviewInput){
  const review=describeFinanceControls(input),snapshot=review.snapshot;
  const find=(title:string)=>review.steps.find(step=>step.title===title);
  let next:FinanceReviewStep|undefined=review.steps[review.steps.length-1];
  if(snapshot){
    if(snapshot.status==='STALE')next=find('Next review step');
    else if(snapshot.unresolvedItemCount>0||BigInt(snapshot.varianceCents)!==BigInt(0))next={
      title:'Inspect saved comparison evidence',state:'Needs investigation',
      detail:'Inspect the saved items and their outcomes before deciding what needs correction. Net variance and unresolved-item count describe different issues; zero net variance can still include unresolved items.',
      href:'#finance-reconciliation-review',action:'Review saved reconciliation controls',
    };
    else if(snapshot.status==='SIGNED_OFF')next=find('Sign-off linkage');
    else if(snapshot.status==='PREPARED')next=find('Saved comparison');
    else next=input.period?.status==='CLOSED'&&input.activeClose?.status==='CLOSED'?find('Saved comparison'):find('Financial calendar');
  }
  const summary=snapshot?.status==='SIGNED_OFF'&&(snapshot.unresolvedItemCount>0||BigInt(snapshot.varianceCents)!==BigInt(0))
    ?'The saved comparison is marked signed off but records unresolved items or a non-zero variance. Inspect its evidence.'
    :review.summary;
  return {...review,summary,next:next??review.steps[0]??null};
}
