// Inspection / Audit execution readiness — pure, client-safe rules shared by
// the services (list, detail, completion) and the pages, so the register,
// the detail page and the completion guard can never disagree.
//
// Readiness is FACTUAL: it only reflects the rules completion already
// enforces (status, required items answered, at least one ad hoc item).
// Findings, open Actions and evidence are shown as operational information
// and never block completion — that is not an existing business rule.

export type ExecutionStatus = 'PLANNED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';

export type ExecutionReadiness = {
  /** Items/criteria in the bound template version (ad hoc: the ones recorded so far). */
  total: number;
  answered: number;
  requiredTotal: number;
  requiredAnswered: number;
  /** Human-readable reasons completion would be refused right now. Empty when ready. */
  blockers: string[];
  /** IN_PROGRESS and nothing blocks completion. */
  ready: boolean;
  /** IN_PROGRESS with at least one blocker. */
  incomplete: boolean;
};

export function executionReadiness(input: {
  status: ExecutionStatus;
  adHoc: boolean;
  items: { key: string; required: boolean }[];
  answeredKeys: Iterable<string>;
  noun: 'inspection' | 'audit';
}): ExecutionReadiness {
  const answeredKeys = new Set(input.answeredKeys);
  const items = input.adHoc ? [...answeredKeys].map(key => ({ key, required: false })) : input.items;
  const required = items.filter(i => i.required);
  const requiredAnswered = required.filter(i => answeredKeys.has(i.key)).length;
  const answered = items.filter(i => answeredKeys.has(i.key)).length;
  const itemWord = input.noun === 'audit' ? 'criterion' : 'item';
  const itemWords = input.noun === 'audit' ? 'criteria' : 'items';

  const blockers: string[] = [];
  if (input.status === 'PLANNED') blockers.push(`The ${input.noun} has not been started.`);
  else if (input.status === 'COMPLETED') blockers.push(`The ${input.noun} is already completed.`);
  else if (input.status === 'CANCELLED') blockers.push(`The ${input.noun} is cancelled.`);
  if (input.status === 'PLANNED' || input.status === 'IN_PROGRESS') {
    const missing = required.length - requiredAnswered;
    if (missing > 0) blockers.push(`${missing} required ${missing === 1 ? itemWord : itemWords} ${missing === 1 ? 'has' : 'have'} no response yet.`);
    if (input.adHoc && answeredKeys.size === 0) blockers.push(`Record at least one ${itemWord} before completing an ad hoc ${input.noun}.`);
  }
  const ready = input.status === 'IN_PROGRESS' && blockers.length === 0;
  return {
    total: items.length, answered, requiredTotal: required.length, requiredAnswered,
    blockers, ready, incomplete: input.status === 'IN_PROGRESS' && !ready,
  };
}

/** Register views that are derivable from real statuses and readiness. */
export const EXECUTION_VIEWS = ['planned', 'in_progress', 'incomplete', 'findings', 'ready', 'completed', 'cancelled'] as const;
export type ExecutionView = (typeof EXECUTION_VIEWS)[number] | 'due' | 'all';

export function parseExecutionView(raw: unknown): ExecutionView {
  if (raw === 'due') return 'due';
  return (EXECUTION_VIEWS as readonly string[]).includes(raw as string) ? raw as ExecutionView : 'all';
}

/** Whether a register row belongs in a view (status views are also applied in SQL). */
export function matchesExecutionView(view: ExecutionView, row: { status: ExecutionStatus; finding_count: number; readiness: ExecutionReadiness }): boolean {
  switch (view) {
    case 'planned': return row.status === 'PLANNED';
    case 'in_progress': return row.status === 'IN_PROGRESS';
    case 'incomplete': return row.readiness.incomplete;
    case 'ready': return row.readiness.ready;
    case 'findings': return row.finding_count > 0;
    case 'completed': return row.status === 'COMPLETED';
    case 'cancelled': return row.status === 'CANCELLED';
    default: return true;
  }
}
