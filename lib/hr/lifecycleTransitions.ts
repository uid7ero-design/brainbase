export type LifecycleTemplateStatus = 'DRAFT' | 'ACTIVE' | 'RETIRED';
export type LifecycleWorkflowStatus = 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
export type LifecycleTaskStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'AWAITING_APPROVAL'
  | 'COMPLETED'
  | 'WAIVED'
  | 'CANCELLED';

const TEMPLATE_TRANSITIONS: Readonly<Record<LifecycleTemplateStatus, ReadonlySet<LifecycleTemplateStatus>>> = {
  DRAFT: new Set(['ACTIVE', 'RETIRED']),
  ACTIVE: new Set(['RETIRED']),
  RETIRED: new Set(),
};

const WORKFLOW_TRANSITIONS: Readonly<Record<LifecycleWorkflowStatus, ReadonlySet<LifecycleWorkflowStatus>>> = {
  ACTIVE: new Set(['COMPLETED', 'CANCELLED']),
  COMPLETED: new Set(),
  CANCELLED: new Set(),
};

const TASK_TRANSITIONS: Readonly<Record<LifecycleTaskStatus, ReadonlySet<LifecycleTaskStatus>>> = {
  NOT_STARTED: new Set(['IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'WAIVED', 'CANCELLED']),
  IN_PROGRESS: new Set(['AWAITING_APPROVAL', 'COMPLETED', 'WAIVED', 'CANCELLED']),
  AWAITING_APPROVAL: new Set(['IN_PROGRESS', 'COMPLETED', 'WAIVED', 'CANCELLED']),
  COMPLETED: new Set(),
  WAIVED: new Set(),
  CANCELLED: new Set(),
};

function assertTransition<T extends string>(
  kind: string,
  allowed: Readonly<Record<T, ReadonlySet<T>>>,
  from: T,
  to: T,
): void {
  if (from === to || !allowed[from].has(to)) {
    throw new Error(`Invalid ${kind} transition: ${from} -> ${to}`);
  }
}

export function assertLifecycleTemplateTransition(
  from: LifecycleTemplateStatus,
  to: LifecycleTemplateStatus,
): void {
  assertTransition('lifecycle template', TEMPLATE_TRANSITIONS, from, to);
}

/** Template content is mutable only while DRAFT. ACTIVE and RETIRED versions
 * are historical records; changes require a new version. */
export function assertLifecycleTemplateEditable(
  status: LifecycleTemplateStatus,
): void {
  if (status !== 'DRAFT') {
    throw new Error(`Lifecycle template ${status} versions are immutable; create a new version instead.`);
  }
}

/** Workflows may only be instantiated from an ACTIVE template version. */
export function assertLifecycleTemplateStartable(
  status: LifecycleTemplateStatus,
): void {
  if (status !== 'ACTIVE') {
    throw new Error(`Lifecycle workflows require an ACTIVE template, got ${status}.`);
  }
}

export function assertLifecycleWorkflowTransition(
  from: LifecycleWorkflowStatus,
  to: LifecycleWorkflowStatus,
): void {
  assertTransition('lifecycle workflow', WORKFLOW_TRANSITIONS, from, to);
}

export function assertLifecycleTaskTransition(
  from: LifecycleTaskStatus,
  to: LifecycleTaskStatus,
): void {
  assertTransition('lifecycle task', TASK_TRANSITIONS, from, to);
}
