import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient, type QueryResult } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('HR lifecycle workflow integration test requires DATABASE_URL.');
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run HR lifecycle workflow proof against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!/^(localhost|127\.0\.0\.1)$/.test(host)) {
  throw new Error('HR lifecycle workflow proof may only run against localhost.');
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
        for (const spec of build(querySpec)) {
          results.push((await execute(client, spec)).rows);
        }
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

let startLifecycleWorkflow:
  typeof import('@/lib/hr/lifecycleWorkflowMutations').startLifecycleWorkflow;
let cancelLifecycleWorkflow:
  typeof import('@/lib/hr/lifecycleWorkflowMutations').cancelLifecycleWorkflow;

const ORG_ID = 'org-workflows';
const HR_USER = 'hr-workflows';
const MANAGER_USER = 'manager-workflows';
const MANAGER_PERSON_ID = '81111111-1111-4111-8111-111111111111';
const PERSON_ID = '82222222-2222-4222-8222-222222222222';
const TEMPLATE_ID = '83333333-3333-4333-8333-333333333333';
const EMPLOYEE_TEMPLATE_TASK = '84444444-4444-4444-8444-444444444441';
const MANAGER_TEMPLATE_TASK = '84444444-4444-4444-8444-444444444442';

const actor = {
  organisationId: ORG_ID,
  userId: HR_USER,
  isSuperAdmin: false,
};

async function q<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  return (await pool.query(text, values)).rows as T[];
}

beforeAll(async () => {
  ({ startLifecycleWorkflow, cancelLifecycleWorkflow } =
    await import('@/lib/hr/lifecycleWorkflowMutations'));

  await q(
    `INSERT INTO organisations (id, name, slug)
     VALUES ($1, 'Workflow Org', 'org-workflows')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID],
  );
  await q(
    `INSERT INTO users (id, organisation_id, username, name) VALUES
       ($1, $3, 'hr-workflows', 'HR'),
       ($2, $3, 'manager-workflows', 'Manager')
     ON CONFLICT (id) DO NOTHING`,
    [HR_USER, MANAGER_USER, ORG_ID],
  );
  await q(
    `INSERT INTO hr_people (
       id, organisation_id, linked_user_id, first_name, last_name
     ) VALUES ($1, $3, $2, 'Manager', 'Person')
     ON CONFLICT (id) DO NOTHING`,
    [MANAGER_PERSON_ID, MANAGER_USER, ORG_ID],
  );
  await q(
    `INSERT INTO hr_people (
       id, organisation_id, linked_user_id, first_name, last_name, manager_person_id
     ) VALUES ($1, $2, NULL, 'Unlinked', 'Employee', $3)
     ON CONFLICT (id) DO NOTHING`,
    [PERSON_ID, ORG_ID, MANAGER_PERSON_ID],
  );
  await q(
    `INSERT INTO hr_administrators (organisation_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [ORG_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_lifecycle_templates (
       id, organisation_id, template_key, version_number, lifecycle_type,
       name, status, activated_at, created_by
     ) VALUES (
       $1, $2, 'workflow-proof', 1, 'onboarding',
       'Workflow proof', 'ACTIVE', now(), $3
     )
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, ORG_ID, HR_USER],
  );
  await q(
    `INSERT INTO hr_lifecycle_template_tasks (
       id, organisation_id, template_id, sequence, title, description,
       responsibility_type, due_offset_days, requires_approval, approval_type,
       employee_visible, manager_visible, internal_only
     ) VALUES
       ($1,$3,$4,1,'Employee original','Employee instructions','EMPLOYEE',-7,false,'NONE',true,false,false),
       ($2,$3,$4,2,'Manager original','Manager instructions','MANAGER',1,false,'NONE',false,true,false)
     ON CONFLICT (id) DO NOTHING`,
    [EMPLOYEE_TEMPLATE_TASK, MANAGER_TEMPLATE_TASK, ORG_ID, TEMPLATE_ID],
  );
});

beforeEach(async () => {
  await q(
    `DELETE FROM audit_logs
     WHERE organisation_id=$1
       AND resource_type IN ('hr_lifecycle_workflow','hr_lifecycle_task')`,
    [ORG_ID],
  );
  await q(
    `DELETE FROM hr_lifecycle_task_approvals
     WHERE organisation_id=$1`,
    [ORG_ID],
  );
  await q(
    `DELETE FROM hr_lifecycle_tasks
     WHERE organisation_id=$1`,
    [ORG_ID],
  );
  await q(
    `DELETE FROM hr_lifecycle_workflows
     WHERE organisation_id=$1`,
    [ORG_ID],
  );
  await q(
    `UPDATE hr_lifecycle_template_tasks
     SET title = CASE
           WHEN id=$1 THEN 'Employee original'
           ELSE 'Manager original'
         END,
         employee_visible = CASE WHEN id=$1 THEN true ELSE false END,
         manager_visible = CASE WHEN id=$2 THEN true ELSE false END,
         updated_at = now()
     WHERE organisation_id=$3
       AND template_id=$4`,
    [EMPLOYEE_TEMPLATE_TASK, MANAGER_TEMPLATE_TASK, ORG_ID, TEMPLATE_ID],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('HR-7C workflow start/cancel against real Postgres', () => {
  it('starts from the exact ACTIVE template and snapshots assignments, due dates, and audit atomically', async () => {
    const result = await startLifecycleWorkflow({
      actor,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    });

    expect(result.outcome).toBe('started');
    if (result.outcome !== 'started') throw new Error('Expected workflow start');

    const [workflow] = await q<{
      template_id: string;
      lifecycle_type: string;
      status: string;
      anchor_date: string;
    }>(
      `SELECT template_id::text, lifecycle_type, status, anchor_date::text
       FROM hr_lifecycle_workflows
       WHERE organisation_id=$1 AND id=$2`,
      [ORG_ID, result.workflowId],
    );
    expect(workflow).toEqual({
      template_id: TEMPLATE_ID,
      lifecycle_type: 'onboarding',
      status: 'ACTIVE',
      anchor_date: '2026-10-06',
    });

    const tasks = await q<{
      sequence: number;
      title: string;
      assigned_user_id: string | null;
      due_at: Date | null;
      status: string;
    }>(
      `SELECT sequence, title, assigned_user_id, due_at, status
       FROM hr_lifecycle_tasks
       WHERE organisation_id=$1 AND workflow_id=$2
       ORDER BY sequence`,
      [ORG_ID, result.workflowId],
    );

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(expect.objectContaining({
      sequence: 1,
      title: 'Employee original',
      assigned_user_id: null,
      status: 'NOT_STARTED',
    }));
    expect(tasks[1]).toEqual(expect.objectContaining({
      sequence: 2,
      title: 'Manager original',
      assigned_user_id: MANAGER_USER,
      status: 'NOT_STARTED',
    }));
    expect(tasks[0].due_at?.toISOString()).toBe('2026-09-29T00:00:00.000Z');
    expect(tasks[1].due_at?.toISOString()).toBe('2026-10-07T00:00:00.000Z');

    const [audit] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id=$1
         AND resource_id=$2
         AND action='hr_lifecycle_workflow.started'`,
      [ORG_ID, result.workflowId],
    );
    expect(audit.count).toBe('1');
  });

  it('keeps workflow task snapshots unchanged when template-task content later changes', async () => {
    const result = await startLifecycleWorkflow({
      actor,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    });
    expect(result.outcome).toBe('started');
    if (result.outcome !== 'started') throw new Error('Expected workflow start');

    await q(
      `UPDATE hr_lifecycle_template_tasks
       SET title='Employee changed later', employee_visible=false
       WHERE organisation_id=$1 AND id=$2`,
      [ORG_ID, EMPLOYEE_TEMPLATE_TASK],
    );

    const [snapshot] = await q<{
      title: string;
      employee_visible: boolean;
      template_id: string;
      template_task_id: string;
    }>(
      `SELECT title, employee_visible, template_id::text, template_task_id::text
       FROM hr_lifecycle_tasks
       WHERE organisation_id=$1
         AND workflow_id=$2
         AND sequence=1`,
      [ORG_ID, result.workflowId],
    );

    expect(snapshot).toEqual({
      title: 'Employee original',
      employee_visible: true,
      template_id: TEMPLATE_ID,
      template_task_id: EMPLOYEE_TEMPLATE_TASK,
    });
  });

  it('serializes duplicate workflow starts and returns workflow_already_active to the loser', async () => {
    const [a, b] = await Promise.all([
      startLifecycleWorkflow({
        actor,
        personId: PERSON_ID,
        templateId: TEMPLATE_ID,
        anchorDate: '2026-10-06',
      }),
      startLifecycleWorkflow({
        actor,
        personId: PERSON_ID,
        templateId: TEMPLATE_ID,
        anchorDate: '2026-10-06',
      }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'started',
      'workflow_already_active',
    ]);

    const [count] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM hr_lifecycle_workflows
       WHERE organisation_id=$1
         AND person_id=$2
         AND lifecycle_type='onboarding'
         AND status='ACTIVE'`,
      [ORG_ID, PERSON_ID],
    );
    expect(count.count).toBe('1');
  });

  it('cancels the workflow atomically, preserving completed tasks and cancelling only nonterminal tasks', async () => {
    const started = await startLifecycleWorkflow({
      actor,
      personId: PERSON_ID,
      templateId: TEMPLATE_ID,
      anchorDate: '2026-10-06',
    });
    expect(started.outcome).toBe('started');
    if (started.outcome !== 'started') throw new Error('Expected workflow start');

    const [employeeTask] = await q<{ id: string }>(
      `SELECT id::text
       FROM hr_lifecycle_tasks
       WHERE organisation_id=$1 AND workflow_id=$2 AND sequence=1`,
      [ORG_ID, started.workflowId],
    );
    await q(
      `UPDATE hr_lifecycle_tasks
       SET status='COMPLETED', completed_by=$1, completed_at=now()
       WHERE organisation_id=$2 AND id=$3`,
      [HR_USER, ORG_ID, employeeTask.id],
    );

    const cancelled = await cancelLifecycleWorkflow({
      actor,
      workflowId: started.workflowId,
    });
    expect(cancelled.outcome).toBe('cancelled');

    const [workflow] = await q<{ status: string; cancelled_at: Date | null }>(
      `SELECT status, cancelled_at
       FROM hr_lifecycle_workflows
       WHERE organisation_id=$1 AND id=$2`,
      [ORG_ID, started.workflowId],
    );
    expect(workflow.status).toBe('CANCELLED');
    expect(workflow.cancelled_at).not.toBeNull();

    const tasks = await q<{ sequence: number; status: string }>(
      `SELECT sequence, status
       FROM hr_lifecycle_tasks
       WHERE organisation_id=$1 AND workflow_id=$2
       ORDER BY sequence`,
      [ORG_ID, started.workflowId],
    );
    expect(tasks).toEqual([
      { sequence: 1, status: 'COMPLETED' },
      { sequence: 2, status: 'CANCELLED' },
    ]);

    const [audit] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id=$1
         AND resource_id=$2
         AND action='hr_lifecycle_workflow.cancelled'`,
      [ORG_ID, started.workflowId],
    );
    expect(audit.count).toBe('1');

    await expect(cancelLifecycleWorkflow({
      actor,
      workflowId: started.workflowId,
    })).resolves.toEqual(expect.objectContaining({
      outcome: 'already_cancelled',
      workflowId: started.workflowId,
    }));

    const [auditAfterRetry] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id=$1
         AND resource_id=$2
         AND action='hr_lifecycle_workflow.cancelled'`,
      [ORG_ID, started.workflowId],
    );
    expect(auditAfterRetry.count).toBe('1');
  });
});
