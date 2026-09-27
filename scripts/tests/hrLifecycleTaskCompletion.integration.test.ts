import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Pool, type PoolClient, type QueryResult } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    'hrLifecycleTaskCompletion.integration.test.ts requires DATABASE_URL from the disposable Docker harness.',
  );
}
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing to run HR lifecycle concurrency proof against a hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!/^(localhost|127\.0\.0\.1)$/.test(host)) {
  throw new Error('HR lifecycle concurrency proof may only run against localhost.');
}

type QuerySpec = { text: string; values: unknown[] };

const pool = new Pool({ connectionString: DATABASE_URL });

function querySpec(strings: TemplateStringsArray, ...values: unknown[]): QuerySpec {
  return {
    text: strings.join('?'),
    values,
  };
}

function toPg(spec: QuerySpec): QuerySpec {
  let index = 0;
  return {
    text: spec.text.replace(/\?/g, () => `$${++index}`),
    values: spec.values,
  };
}

async function execute(client: PoolClient, spec: QuerySpec): Promise<QueryResult> {
  const pg = toPg(spec);
  return client.query(pg.text, pg.values);
}

const sqlMock = Object.assign(
  (...args: [TemplateStringsArray, ...unknown[]]) => querySpec(...args),
  {
    transaction: async (build: (txn: typeof querySpec) => QuerySpec[]) => {
      const specs = build(querySpec);
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const results: unknown[][] = [];
        for (const spec of specs) {
          const result = await execute(client, spec);
          results.push(result.rows);
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

let completeLifecycleTask:
  typeof import('@/lib/hr/lifecycleMutations').completeLifecycleTask;

const ORG_ID = 'org-a';
const USER_ID = 'employee-user';
const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222';
const TARGET_TEMPLATE_TASK_ID = '33333333-3333-4333-8333-333333333331';
const BLOCKER_TEMPLATE_TASK_ID = '33333333-3333-4333-8333-333333333332';
const WORKFLOW_ID = '44444444-4444-4444-8444-444444444444';
const TARGET_TASK_ID = '55555555-5555-4555-8555-555555555551';
const BLOCKER_TASK_ID = '55555555-5555-4555-8555-555555555552';

const ACTOR = {
  organisationId: ORG_ID,
  userId: USER_ID,
  isSuperAdmin: false,
  ipAddress: '203.0.113.10',
  userAgent: 'integration-test',
};

async function q<T extends Record<string, unknown>>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, values);
  return result.rows as T[];
}

beforeAll(async () => {
  ({ completeLifecycleTask } = await import('@/lib/hr/lifecycleMutations'));

  await q(
    `INSERT INTO organisations (id, name, slug)
     VALUES ($1, 'Org A', 'org-a')
     ON CONFLICT (id) DO NOTHING`,
    [ORG_ID],
  );

  await q(
    `INSERT INTO users (id, organisation_id, username, name)
     VALUES ($1, $2, 'employee-user', 'Employee User')
     ON CONFLICT (id) DO NOTHING`,
    [USER_ID, ORG_ID],
  );

  await q(
    `INSERT INTO hr_people (
       id, organisation_id, linked_user_id, first_name, last_name
     )
     VALUES ($1, $2, $3, 'Employee', 'User')
     ON CONFLICT (id) DO NOTHING`,
    [PERSON_ID, ORG_ID, USER_ID],
  );

  await q(
    `INSERT INTO hr_lifecycle_templates (
       id, organisation_id, template_key, version_number, lifecycle_type,
       name, status, activated_at, created_by
     )
     VALUES (
       $1, $2, 'race-onboarding', 1, 'onboarding',
       'Race onboarding', 'ACTIVE', now(), $3
     )
     ON CONFLICT (id) DO NOTHING`,
    [TEMPLATE_ID, ORG_ID, USER_ID],
  );

  await q(
    `INSERT INTO hr_lifecycle_template_tasks (
       id, organisation_id, template_id, sequence, title,
       responsibility_type, requires_approval, approval_type,
       employee_visible, manager_visible, internal_only
     )
     VALUES
       ($1, $3, $4, 1, 'Target task', 'EMPLOYEE', false, 'NONE', true, false, false),
       ($2, $3, $4, 2, 'Blocker task', 'EMPLOYEE', false, 'NONE', true, false, false)
     ON CONFLICT (id) DO NOTHING`,
    [
      TARGET_TEMPLATE_TASK_ID,
      BLOCKER_TEMPLATE_TASK_ID,
      ORG_ID,
      TEMPLATE_ID,
    ],
  );

  await q(
    `INSERT INTO hr_lifecycle_workflows (
       id, organisation_id, person_id, template_id, lifecycle_type,
       status, anchor_date, started_by
     )
     VALUES ($1, $2, $3, $4, 'onboarding', 'ACTIVE', DATE '2026-10-06', $5)
     ON CONFLICT (id) DO NOTHING`,
    [WORKFLOW_ID, ORG_ID, PERSON_ID, TEMPLATE_ID, USER_ID],
  );

  await q(
    `INSERT INTO hr_lifecycle_tasks (
       id, organisation_id, workflow_id, person_id, template_id,
       template_task_id, sequence, title, responsibility_type,
       assigned_user_id, requires_approval, approval_type,
       employee_visible, manager_visible, internal_only, status
     )
     VALUES
       ($1, $3, $4, $5, $6, $7, 1, 'Target task', 'EMPLOYEE', $9, false, 'NONE', true, false, false, 'IN_PROGRESS'),
       ($2, $3, $4, $5, $6, $8, 2, 'Blocker task', 'EMPLOYEE', $9, false, 'NONE', true, false, false, 'IN_PROGRESS')
     ON CONFLICT (id) DO NOTHING`,
    [
      TARGET_TASK_ID,
      BLOCKER_TASK_ID,
      ORG_ID,
      WORKFLOW_ID,
      PERSON_ID,
      TEMPLATE_ID,
      TARGET_TEMPLATE_TASK_ID,
      BLOCKER_TEMPLATE_TASK_ID,
      USER_ID,
    ],
  );
});

beforeEach(async () => {
  await q(
    `UPDATE hr_lifecycle_workflows
     SET status = 'ACTIVE', completed_at = NULL, cancelled_at = NULL, updated_at = now()
     WHERE organisation_id = $1 AND id = $2`,
    [ORG_ID, WORKFLOW_ID],
  );

  await q(
    `UPDATE hr_lifecycle_tasks
     SET status = 'IN_PROGRESS',
         completed_by = NULL,
         completed_at = NULL,
         waived_by = NULL,
         waived_at = NULL,
         waiver_reason = NULL,
         updated_at = now()
     WHERE organisation_id = $1
       AND id IN ($2, $3)`,
    [ORG_ID, TARGET_TASK_ID, BLOCKER_TASK_ID],
  );

  await q(
    `DELETE FROM audit_logs
     WHERE organisation_id = $1
       AND (
         (resource_type = 'hr_lifecycle_task' AND resource_id = $2)
         OR
         (resource_type = 'hr_lifecycle_workflow' AND resource_id = $3)
       )`,
    [ORG_ID, TARGET_TASK_ID, WORKFLOW_ID],
  );
});

afterAll(async () => {
  await pool.end();
});

describe('HR-7C real Postgres double-completion race', () => {
  it('allows one winner and one already_completed loser, with exactly one task audit', async () => {
    const [a, b] = await Promise.all([
      completeLifecycleTask({ actor: ACTOR, taskId: TARGET_TASK_ID }),
      completeLifecycleTask({ actor: ACTOR, taskId: TARGET_TASK_ID }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'already_completed',
      'completed',
    ]);

    const [task] = await q<{
      status: string;
      completed_by: string | null;
      completed_at: Date | null;
    }>(
      `SELECT status, completed_by, completed_at
       FROM hr_lifecycle_tasks
       WHERE organisation_id = $1 AND id = $2`,
      [ORG_ID, TARGET_TASK_ID],
    );

    expect(task.status).toBe('COMPLETED');
    expect(task.completed_by).toBe(USER_ID);
    expect(task.completed_at).not.toBeNull();

    const [workflow] = await q<{ status: string; completed_at: Date | null }>(
      `SELECT status, completed_at
       FROM hr_lifecycle_workflows
       WHERE organisation_id = $1 AND id = $2`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflow).toEqual({ status: 'ACTIVE', completed_at: null });

    const taskAudits = await q<{
      action: string;
      user_id: string | null;
      after_state: Record<string, unknown>;
    }>(
      `SELECT action, user_id, after_state
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_task'
         AND resource_id = $2
         AND action = 'hr_lifecycle_task.completed'`,
      [ORG_ID, TARGET_TASK_ID],
    );

    expect(taskAudits).toHaveLength(1);
    expect(taskAudits[0].user_id).toBe(USER_ID);
    expect(taskAudits[0].after_state).toEqual(expect.objectContaining({
      status: 'COMPLETED',
      completed_by: USER_ID,
    }));

    const workflowAudits = await q(
      `SELECT id
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_workflow'
         AND resource_id = $2
         AND action = 'hr_lifecycle_workflow.completed'`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflowAudits).toHaveLength(0);
  });



  it('serializes different final tasks on the workflow lock so exactly one derives workflow completion', async () => {
    const [a, b] = await Promise.all([
      completeLifecycleTask({ actor: ACTOR, taskId: TARGET_TASK_ID }),
      completeLifecycleTask({ actor: ACTOR, taskId: BLOCKER_TASK_ID }),
    ]);

    expect(a.outcome).toBe('completed');
    expect(b.outcome).toBe('completed');

    const completedResults = [a, b].filter(result => result.outcome === 'completed');
    expect(completedResults).toHaveLength(2);
    const workflowStatuses = completedResults
      .map(result => result.workflow.status)
      .sort();
    expect(workflowStatuses).toEqual(['ACTIVE', 'COMPLETED']);

    const [workflow] = await q<{ status: string; completed_at: Date | null }>(
      `SELECT status, completed_at
       FROM hr_lifecycle_workflows
       WHERE organisation_id = $1 AND id = $2`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflow.status).toBe('COMPLETED');
    expect(workflow.completed_at).not.toBeNull();

    const [taskAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_task'
         AND resource_id IN ($2, $3)
         AND action = 'hr_lifecycle_task.completed'`,
      [ORG_ID, TARGET_TASK_ID, BLOCKER_TASK_ID],
    );
    expect(taskAuditCount.count).toBe('2');

    const [workflowAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_workflow'
         AND resource_id = $2
         AND action = 'hr_lifecycle_workflow.completed'`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflowAuditCount.count).toBe('1');
  });

  it('completes the workflow exactly once when both callers race on the final outstanding task', async () => {
    await q(
      `UPDATE hr_lifecycle_tasks
       SET status = 'COMPLETED',
           completed_by = $1,
           completed_at = now(),
           updated_at = now()
       WHERE organisation_id = $2
         AND id = $3`,
      [USER_ID, ORG_ID, BLOCKER_TASK_ID],
    );

    const [a, b] = await Promise.all([
      completeLifecycleTask({ actor: ACTOR, taskId: TARGET_TASK_ID }),
      completeLifecycleTask({ actor: ACTOR, taskId: TARGET_TASK_ID }),
    ]);

    expect([a.outcome, b.outcome].sort()).toEqual([
      'already_completed',
      'completed',
    ]);

    const winner = [a, b].find(result => result.outcome === 'completed');
    expect(winner).toEqual(expect.objectContaining({
      outcome: 'completed',
      workflow: expect.objectContaining({
        id: WORKFLOW_ID,
        status: 'COMPLETED',
      }),
    }));

    const [workflow] = await q<{ status: string; completed_at: Date | null }>(
      `SELECT status, completed_at
       FROM hr_lifecycle_workflows
       WHERE organisation_id = $1 AND id = $2`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflow.status).toBe('COMPLETED');
    expect(workflow.completed_at).not.toBeNull();

    const [taskAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_task'
         AND resource_id = $2
         AND action = 'hr_lifecycle_task.completed'`,
      [ORG_ID, TARGET_TASK_ID],
    );
    expect(taskAuditCount.count).toBe('1');

    const [workflowAuditCount] = await q<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM audit_logs
       WHERE organisation_id = $1
         AND resource_type = 'hr_lifecycle_workflow'
         AND resource_id = $2
         AND action = 'hr_lifecycle_workflow.completed'`,
      [ORG_ID, WORKFLOW_ID],
    );
    expect(workflowAuditCount.count).toBe('1');
  });
});
