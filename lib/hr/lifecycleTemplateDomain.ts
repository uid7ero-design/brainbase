export type LifecycleTemplateType = 'onboarding' | 'offboarding';
export type LifecycleTemplateResponsibility = 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';
export type LifecycleTemplateApproval = 'NONE' | 'MANAGER' | 'HR_ADMIN';

export type LifecycleTemplateTaskInput = {
  sequence: number;
  title: string;
  description: string | null;
  responsibilityType: LifecycleTemplateResponsibility;
  dueOffsetDays: number | null;
  requiresApproval: boolean;
  approvalType: LifecycleTemplateApproval;
  employeeVisible: boolean;
  managerVisible: boolean;
  internalOnly: boolean;
};

export type LifecycleTemplateInput = {
  templateKey?: string;
  lifecycleType?: LifecycleTemplateType;
  name: string;
  description: string | null;
  tasks: LifecycleTemplateTaskInput[];
};

export type LifecycleTemplateValidation =
  | { ok: true; value: LifecycleTemplateInput }
  | { ok: false; error: string };

const RESPONSIBILITIES = new Set(['EMPLOYEE', 'MANAGER', 'HR_ADMIN']);
const APPROVALS = new Set(['NONE', 'MANAGER', 'HR_ADMIN']);
const TYPES = new Set(['onboarding', 'offboarding']);

function optionalNullableString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  return value.trim() || null;
}

export function validateLifecycleTemplatePayload(
  body: Record<string, unknown>,
  options: { requireFamilyFields: boolean },
): LifecycleTemplateValidation {
  const allowed = new Set([
    ...(options.requireFamilyFields ? ['template_key', 'lifecycle_type'] : []),
    'name',
    'description',
    'tasks',
  ]);
  const unknown = Object.keys(body).find(key => !allowed.has(key));
  if (unknown) return { ok: false, error: `Unknown or server-managed field: ${unknown}` };

  const templateKey = options.requireFamilyFields && typeof body.template_key === 'string'
    ? body.template_key.trim()
    : undefined;
  if (options.requireFamilyFields && !templateKey) {
    return { ok: false, error: 'template_key is required.' };
  }

  const lifecycleType = options.requireFamilyFields && typeof body.lifecycle_type === 'string'
    ? body.lifecycle_type
    : undefined;
  if (options.requireFamilyFields && !TYPES.has(lifecycleType ?? '')) {
    return { ok: false, error: 'lifecycle_type must be onboarding or offboarding.' };
  }

  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'name is required.' };

  const description = optionalNullableString(body.description);
  if (body.description !== undefined && body.description !== null && typeof body.description !== 'string') {
    return { ok: false, error: 'description must be a string or null.' };
  }

  if (!Array.isArray(body.tasks) || body.tasks.length === 0) {
    return { ok: false, error: 'tasks must contain at least one task.' };
  }

  const tasks: LifecycleTemplateTaskInput[] = [];
  const sequences = new Set<number>();

  for (const [index, raw] of body.tasks.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, error: `tasks[${index}] must be an object.` };
    }
    const task = raw as Record<string, unknown>;
    const taskAllowed = new Set([
      'sequence', 'title', 'description', 'responsibility_type', 'due_offset_days',
      'requires_approval', 'approval_type', 'employee_visible', 'manager_visible', 'internal_only',
    ]);
    const taskUnknown = Object.keys(task).find(key => !taskAllowed.has(key));
    if (taskUnknown) {
      return { ok: false, error: `Unknown or server-managed field in tasks[${index}]: ${taskUnknown}` };
    }

    const sequence = task.sequence;
    if (!Number.isInteger(sequence) || (sequence as number) <= 0) {
      return { ok: false, error: `tasks[${index}].sequence must be a positive integer.` };
    }
    if (sequences.has(sequence as number)) {
      return { ok: false, error: 'Task sequence values must be unique.' };
    }
    sequences.add(sequence as number);

    const title = typeof task.title === 'string' ? task.title.trim() : '';
    if (!title) return { ok: false, error: `tasks[${index}].title is required.` };

    const taskDescription = optionalNullableString(task.description);
    if (task.description !== undefined && task.description !== null && typeof task.description !== 'string') {
      return { ok: false, error: `tasks[${index}].description must be a string or null.` };
    }

    if (typeof task.responsibility_type !== 'string' || !RESPONSIBILITIES.has(task.responsibility_type)) {
      return { ok: false, error: `tasks[${index}].responsibility_type is invalid.` };
    }

    const dueOffsetDays = task.due_offset_days ?? null;
    if (dueOffsetDays !== null && !Number.isInteger(dueOffsetDays)) {
      return { ok: false, error: `tasks[${index}].due_offset_days must be an integer or null.` };
    }

    if (typeof task.requires_approval !== 'boolean') {
      return { ok: false, error: `tasks[${index}].requires_approval must be boolean.` };
    }
    if (typeof task.approval_type !== 'string' || !APPROVALS.has(task.approval_type)) {
      return { ok: false, error: `tasks[${index}].approval_type is invalid.` };
    }
    if (!task.requires_approval && task.approval_type !== 'NONE') {
      return { ok: false, error: `tasks[${index}] without approval must use approval_type NONE.` };
    }
    if (task.requires_approval && task.approval_type === 'NONE') {
      return { ok: false, error: `tasks[${index}] requiring approval must use MANAGER or HR_ADMIN.` };
    }

    if (
      typeof task.employee_visible !== 'boolean'
      || typeof task.manager_visible !== 'boolean'
      || typeof task.internal_only !== 'boolean'
    ) {
      return { ok: false, error: `tasks[${index}] visibility fields must be boolean.` };
    }
    if (task.internal_only && (task.employee_visible || task.manager_visible)) {
      return { ok: false, error: `tasks[${index}] internal_only cannot be employee- or manager-visible.` };
    }

    tasks.push({
      sequence: sequence as number,
      title,
      description: taskDescription ?? null,
      responsibilityType: task.responsibility_type as LifecycleTemplateResponsibility,
      dueOffsetDays: dueOffsetDays as number | null,
      requiresApproval: task.requires_approval,
      approvalType: task.approval_type as LifecycleTemplateApproval,
      employeeVisible: task.employee_visible,
      managerVisible: task.manager_visible,
      internalOnly: task.internal_only,
    });
  }

  return {
    ok: true,
    value: {
      ...(templateKey ? { templateKey } : {}),
      ...(lifecycleType ? { lifecycleType: lifecycleType as LifecycleTemplateType } : {}),
      name,
      description: description ?? null,
      tasks: tasks.sort((a, b) => a.sequence - b.sequence),
    },
  };
}
