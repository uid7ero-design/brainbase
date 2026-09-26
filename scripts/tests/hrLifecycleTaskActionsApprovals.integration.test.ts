import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient, type QueryResult } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('HR lifecycle task actions integration test requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run HR lifecycle task actions proof against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!/^(localhost|127\.0\.0\.1)$/.test(host)) {
  throw new Error('HR lifecycle task actions proof may only run against localhost.');
}

type QuerySpec = { text: string; values: unknown[] };
const pool = new Pool({ connectionString: DATABASE_URL });

function querySpec(strings: TemplateStringsArray, ...values: unknown[]): QuerySpec {
  return { text: strings.join('?'), values };
}
function toPg(spec: QuerySpec): QuerySpec {
  let index = 0;
  return { text: spec.text.replace(/\?/g, () => `$${++index}`), values: spec.values };
}
async function execute(client: PoolClient, spec: QuerySpec): Promise<QueryResult> {
  const pg = toPg(spec);
  return client.query(pg.text, pg.values);
}
const sqlMock = Object.assign(
  (...args: [TemplateStringsArray, ...unknown[]]) => querySpec(...args),
  {
    transaction: async (build: (txn: typeof querySpec) => QuerySpec[]) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results: unknown[][] = [];
        for (const spec of build(querySpec)) results.push((await execute(client, spec)).rows);
        await client.query('COMMIT');
        return results;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    },
  },
);
vi.doMock('@/lib/db', () => ({ default: sqlMock }));

let startLifecycleTask: typeof import('@/lib/hr/lifecycleMutations').startLifecycleTask;
let waiveLifecycleTask: typeof import('@/lib/hr/lifecycleMutations').waiveLifecycleTask;
let completeLifecycleTask: typeof import('@/lib/hr/lifecycleMutations').completeLifecycleTask;
let recordLifecycleTaskApproval: typeof import('@/lib/hr/lifecycleMutations').recordLifecycleTaskApproval;

const ORG_ID = 'org-actions';
const EMPLOYEE_USER = 'employee-actions';
const MANAGER_USER = 'manager-actions';
const HR_USER = 'hr-actions';
const PERSON_ID = '71111111-1111-4111-8111-111111111111';
const MANAGER_PERSON_ID = '72222222-2222-4222-8222-222222222222';
const HR_PERSON_ID = '73333333-3333-4333-8333-333333333333';
const TEMPLATE_ID = '74444444-4444-4444-8444-444444444444';
const START_TEMPLATE_TASK = '75555555-5555-4555-8555-555555555551';
const WAIVE_TEMPLATE_TASK = '75555555-5555-4555-8555-555555555552';
const APPROVAL_TEMPLATE_TASK = '75555555-5555-4555-8555-555555555553';
const WORKFLOW_ID = '76666666-6666-4666-8666-666666666666';
const START_TASK = '77777777-7777-4777-8777-777777777771';
const WAIVE_TASK = '77777777-7777-4777-8777-777777777772';
const APPROVAL_TASK = '77777777-7777-4777-8777-777777777773';

const employeeActor = {
  organisationId: ORG_ID,
  userId: EMPLOYEE_USER,
  isSuperAdmin: false,
};
const managerActor = {
  organisationId: ORG_ID,
  userId: MANAGER_USER,
  isSuperAdmin: false,
};
const hrActor = {
  organisationId: ORG_ID,
  userId: HR_USER,
  isSuperAdmin: false,
};

async function q<T extends Record<string, unknown>>(text: string, values: unknown[] = []): Promise<T[]> {
  return (await pool.query(text, values)).rows as T[];
}

beforeAll(async () => {
  ({ startLifecycleTask, waiveLifecycleTask, completeLifecycleTask, recordLifecycleTaskApproval } =
    await import('@/lib/hr/lifecycleMutations'));

  await q(`INSERT INTO organisations (id, name, slug) VALUES ($1, 'Actions Org', 'org-actions') ON CONFLICT (id) DO NOTHING`, [ORG_ID]);
  await q(
    `INSERT INTO users (id, organisation_id, username, name) VALUES
      ($1, $4, 'employee-actions', 'Employee'),
      ($2, $4, 'manager-actions', 'Manager'),
      ($3, $4, 'hr-actions', 'HR')
     ON CONFLICT (id) DO NOTHING`,
    [EMPLOYEE_USER, MANAGER_USER, HR_USER, ORG_ID],
  );
  await q(
    `INSERT INTO hr_people (id, organisation_id, linked_user_id, first_name, last_name) VALUES
      ($1, $4, $2, 'Manager', 'Person'),
      ($3, $4, $5, 'HR', 'Person')
     ON CONFLICT (id) DO NOTHING`,
    [MANAGER_PERSON_ID, MANAGER_USER, HR_PERSON_ID, ORG_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_people (id, organisation_id, linked_user_id, first_name, last_name, manager_person_id)
     VALUES ($1, $2, $3, 'Employee', 'Person', $4)
     ON CONFLICT (id) DO NOTHING`,
    [PERSON_ID, ORG_ID, EMPLOYEE_USER, MANAGER_PERSON_ID],
  );
  await q(
    `INSERT INTO hr_administrators (organisation_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [ORG_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_lifecycle_templates (
       id, organisation_id, template_key, version_number, lifecycle_type, name, status, activated_at, created_by
     ) VALUES ($1, $2, 'actions', 1, 'onboarding', 'Actions', 'ACTIVE', now(), $3)
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, ORG_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_lifecycle_template_tasks (
       id, organisation_id, template_id, sequence, title, responsibility_type,
       requires_approval, approval_type, employee_visible, manager_visible, internal_only
     ) VALUES
       ($1, $4, $5, 1, 'Start', 'EMPLOYEE', false, 'NONE', true, false, false),
       ($2, $4, $5, 2, 'Waive', 'EMPLOYEE', false, 'NONE', true, false, false),
       ($3, $4, $5, 3, 'Approval', 'EMPLOYEE', true, 'MANAGER', true, true, false)
     ON CONFLICT (id) DO NOTHING`,
    [START_TEMPLATE_TASK, WAIVE_TEMPLATE_TASK, APPROVAL_TEMPLATE_TASK, ORG_ID, TEMPLATE_ID],
  );
  await q(
    `INSERT INTO hr_lifecycle_workflows (
       id, organisation_id, person_id, template_id, lifecycle_type, status, anchor_date, started_by
     ) VALUES ($1, $2, $3, $4, 'onboarding', 'ACTIVE', DATE '2026-10-06', $5)
     ON CONFLICT (id) DO NOTHING`,
    [WORKFLOW_ID, ORG_ID, PERSON_ID, TEMPLATE_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_lifecycle_tasks (
       id, organisation_id, workflow_id, person_id, template_id, template_task_id, sequence,
       title, responsibility_type, assigned_user_id, requires_approval, approval_type,
       employee_visible, manager_visible, internal_only, status
     ) VALUES
       ($1,$4,$5,$6,$7,$8,1,'Start','EMPLOYEE',$11,false,'NONE',true,false,false,'NOT_STARTED'),
       ($2,$4,$5,$6,$7,$9,2,'Waive','EMPLOYEE',$11,false,'NONE',true,false,false,'IN_PROGRESS'),
       ($3,$4,$5,$6,$7,$10,3,'Approval','EMPLOYEE',$11,true,'MANAGER',true,true,false,'AWAITING_APPROVAL')
     ON CONFLICT (id) DO NOTHING`,
    [
      START_TASK, WAIVE_TASK, APPROVAL_TASK, ORG_ID, WORKFLOW_ID, PERSON_ID, TEMPLATE_ID,
      START_TEMPLATE_TASK, WAIVE_TEMPLATE_TASK, APPROVAL_TEMPLATE_TASK, EMPLOYEE_USER,
    ],
  );
});

beforeEach(async () => {
  await q(`UPDATE hr_people SET manager_person_id=$1 WHERE organisation_id=$2 AND id=$3`, [MANAGER_PERSON_ID, ORG_ID, PERSON_ID]);
  await q(`UPDATE hr_lifecycle_workflows SET status='ACTIVE', completed_at=NULL, cancelled_at=NULL WHERE organisation_id=$1 AND id=$2`, [ORG_ID, WORKFLOW_ID]);
  await q(`UPDATE hr_lifecycle_tasks SET status='NOT_STARTED', completed_by=NULL, completed_at=NULL, waived_by=NULL, waived_at=NULL, waiver_reason=NULL WHERE organisation_id=$1 AND id=$2`, [ORG_ID, START_TASK]);
  await q(`UPDATE hr_lifecycle_tasks SET status='IN_PROGRESS', completed_by=NULL, completed_at=NULL, waived_by=NULL, waived_at=NULL, waiver_reason=NULL WHERE organisation_id=$1 AND id=$2`, [ORG_ID, WAIVE_TASK]);
  await q(`UPDATE hr_lifecycle_tasks SET status='AWAITING_APPROVAL', completed_by=NULL, completed_at=NULL, waived_by=NULL, waived_at=NULL, waiver_reason=NULL WHERE organisation_id=$1 AND id=$2`, [ORG_ID, APPROVAL_TASK]);
  await q(`DELETE FROM hr_lifecycle_task_approvals WHERE organisation_id=$1 AND workflow_id=$2`, [ORG_ID, WORKFLOW_ID]);
  await q(`DELETE FROM audit_logs WHERE organisation_id=$1 AND resource_id IN ($2,$3,$4,$5)`, [ORG_ID, START_TASK, WAIVE_TASK, APPROVAL_TASK, WORKFLOW_ID]);
});

afterAll(async () => {
  await pool.end();
});

describe('HR-7C task actions and approvals against real Postgres', () => {
  it('starts a task once with one audit row', async () => {
    await expect(startLifecycleTask({ actor: employeeActor, taskId: START_TASK })).resolves.toEqual({
      outcome: 'started',
      task: { id: START_TASK, status: 'IN_PROGRESS' },
    });
    const [audit] = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE organisation_id=$1 AND resource_id=$2 AND action='hr_lifecycle_task.started'`,
      [ORG_ID, START_TASK],
    );
    expect(audit.count).toBe('1');
  });

  it('allows HR admin to waive with one redacted audit and keeps the workflow active while another task is outstanding', async () => {
    const result = await waiveLifecycleTask({ actor: hrActor, taskId: WAIVE_TASK, reason: 'Sensitive HR reason' });
    expect(result.outcome).toBe('waived');
    if (result.outcome !== 'waived') throw new Error('Expected waived');
    expect(result.workflow.status).toBe('ACTIVE');

    const [row] = await q<{ status: string; waiver_reason: string }>(
      `SELECT status, waiver_reason FROM hr_lifecycle_tasks WHERE organisation_id=$1 AND id=$2`,
      [ORG_ID, WAIVE_TASK],
    );
    expect(row).toEqual({ status: 'WAIVED', waiver_reason: 'Sensitive HR reason' });

    const [audit] = await q<{ count: string; reason: string }>(
      `SELECT count(*)::text AS count, max(after_state->>'waiver_reason') AS reason
       FROM audit_logs WHERE organisation_id=$1 AND resource_id=$2 AND action='hr_lifecycle_task.waived'`,
      [ORG_ID, WAIVE_TASK],
    );
    expect(audit).toEqual({ count: '1', reason: '[redacted]' });
  });

  it('serializes two current-manager approvals so one appends and one becomes no_longer_applicable', async () => {
    const [a, b] = await Promise.all([
      recordLifecycleTaskApproval({ actor: managerActor, taskId: APPROVAL_TASK, decision: 'APPROVED', comment: 'Ready' }),
      recordLifecycleTaskApproval({ actor: managerActor, taskId: APPROVAL_TASK, decision: 'APPROVED', comment: 'Ready' }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual(['approval_no_longer_applicable', 'recorded']);

    const [approvalCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM hr_lifecycle_task_approvals WHERE organisation_id=$1 AND task_id=$2`,
      [ORG_ID, APPROVAL_TASK],
    );
    expect(approvalCount.count).toBe('1');

    const [approvalAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE organisation_id=$1 AND resource_type='hr_lifecycle_task_approval'
         AND action='hr_lifecycle_task_approval.recorded'`,
      [ORG_ID],
    );
    expect(approvalAuditCount.count).toBe('1');

    const [taskAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM audit_logs
       WHERE organisation_id=$1 AND resource_id=$2 AND action='hr_lifecycle_task.completed'`,
      [ORG_ID, APPROVAL_TASK],
    );
    expect(taskAuditCount.count).toBe('1');
  });

  it('re-resolves the current manager at decision time and denies the former manager', async () => {
    await q(`UPDATE hr_people SET manager_person_id=$1 WHERE organisation_id=$2 AND id=$3`, [HR_PERSON_ID, ORG_ID, PERSON_ID]);

    await expect(recordLifecycleTaskApproval({
      actor: managerActor,
      taskId: APPROVAL_TASK,
      decision: 'APPROVED',
      comment: null,
    })).resolves.toEqual({ outcome: 'forbidden' });

    const [approvalCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count FROM hr_lifecycle_task_approvals WHERE organisation_id=$1 AND task_id=$2`,
      [ORG_ID, APPROVAL_TASK],
    );
    expect(approvalCount.count).toBe('0');
  });

  it('preserves append-only approval history across rejection, resubmission, and approval', async () => {
    const rejected = await recordLifecycleTaskApproval({
      actor: managerActor,
      taskId: APPROVAL_TASK,
      decision: 'REJECTED',
      comment: 'Fix it',
    });
    expect(rejected.outcome).toBe('recorded');

    const resubmitted = await completeLifecycleTask({ actor: employeeActor, taskId: APPROVAL_TASK });
    expect(resubmitted.outcome).toBe('awaiting_approval');

    const approved = await recordLifecycleTaskApproval({
      actor: managerActor,
      taskId: APPROVAL_TASK,
      decision: 'APPROVED',
      comment: 'Ready now',
    });
    expect(approved.outcome).toBe('recorded');

    const approvals = await q<{ decision: string; comment: string | null }>(
      `SELECT decision, comment FROM hr_lifecycle_task_approvals
       WHERE organisation_id=$1 AND task_id=$2 ORDER BY decided_at, id`,
      [ORG_ID, APPROVAL_TASK],
    );
    expect(approvals).toEqual([
      { decision: 'REJECTED', comment: 'Fix it' },
      { decision: 'APPROVED', comment: 'Ready now' },
    ]);
  });
});
