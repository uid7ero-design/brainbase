import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('budgetActivationConcurrency.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) {
  throw new Error('Refusing hosted database.');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type QueryDescriptor = { strings: readonly string[]; values: unknown[] };
function compile(q: QueryDescriptor) {
  let text = q.strings[0];
  for (let i = 0; i < q.values.length; i++) {
    const cast = typeof q.values[i] === 'string' && UUID_RE.test(q.values[i] as string) ? '::uuid' : '';
    text += `$${i + 1}${cast}` + q.strings[i + 1];
  }
  return { text, values: q.values };
}

const sqlMock = Object.assign(
  () => {
    throw new Error('unexpected non-transactional SQL in activation integration test');
  },
  {
    transaction: async (
      builder: (txn: (strings: TemplateStringsArray, ...values: unknown[]) => QueryDescriptor) => QueryDescriptor[],
      options?: { isolationLevel?: string },
    ) => prisma.$transaction(async tx => {
      const descriptors = builder((strings, ...values) => ({ strings, values }));
      const results: unknown[] = [];
      for (const descriptor of descriptors) {
        const q = compile(descriptor);
        results.push(await tx.$queryRawUnsafe(q.text, ...q.values));
      }
      return results;
    }, { isolationLevel: options?.isolationLevel as 'ReadCommitted' | undefined }),
  },
);

vi.doMock('@/lib/db', () => ({ default: sqlMock }));
vi.doMock('@/lib/commercial/auditLog', () => ({
  logBudgetVersionActivated: vi.fn(),
  logBudgetVersionSuperseded: vi.fn(),
}));

const { activateBudgetVersion, BudgetActivationError } = await import('@/lib/commercial/budgetActivation');

const ORG = 'org-c77d';
const USER = 'user-c77d';
const FY = '77777777-0000-0000-0000-000000000001';
const P1 = '77777777-0000-0000-0000-000000000011';
const P2 = '77777777-0000-0000-0000-000000000012';
const CC = '77777777-0000-0000-0000-000000000021';
const ACCOUNT = '77777777-0000-0000-0000-000000000031';
const BUDGET = '77777777-0000-0000-0000-000000000041';
const V1 = '77777777-0000-0000-0000-000000000051';
const V2 = '77777777-0000-0000-0000-000000000052';

async function seedVersion(versionId: string, versionNumber: number) {
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_versions
      (id, organisation_id, budget_id, version_number, status, created_by)
     VALUES ($1::uuid,$2,$3::uuid,$4,'DRAFT',$5)`,
    versionId, ORG, BUDGET, versionNumber, USER,
  );
  const line = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `INSERT INTO commercial_budget_lines
      (organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,10000) RETURNING id`,
    ORG, versionId, ACCOUNT, CC,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_period_allocations
      (organisation_id,budget_line_id,financial_period_id,amount_cents)
     VALUES ($1,$2::uuid,$3::uuid,4000),($1,$2::uuid,$4::uuid,6000)`,
    ORG, line[0].id, P1, P2,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_commitment_mappings
      (organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by)
     VALUES ($1,$2::uuid,$3::uuid,$4::uuid,$5)`,
    ORG, versionId, CC, ACCOUNT, USER,
  );
}
beforeAll(async () => {
  await prisma.$executeRawUnsafe(
    `INSERT INTO organisations(id,name) VALUES ($1,'C7.7D Org') ON CONFLICT (id) DO NOTHING`,
    ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO users(id,organisation_id) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING`,
    USER, ORG,
  );
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_period_allocations WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_commitment_mappings WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_lines WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`UPDATE commercial_budgets SET active_version_id=NULL WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_versions WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budgets WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_accounts WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_periods WHERE organisation_id=$1`, ORG);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_financial_years WHERE organisation_id=$1`, ORG);

  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_years(id,organisation_id,name,starts_on,ends_on,status)
     VALUES ($1::uuid,$2,'FY26','2026-07-01','2027-06-30','OPEN')`,
    FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_financial_periods(id,financial_year_id,organisation_id,name,starts_on,ends_on,status)
     VALUES
      ($1::uuid,$3::uuid,$4,'P1','2026-07-01','2026-07-31','OPEN'),
      ($2::uuid,$3::uuid,$4,'P2','2026-08-01','2026-08-31','OPEN')`,
    P1, P2, FY, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
     VALUES ($1::uuid,$2,'OPS','Operations',true)`,
    CC, ORG,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
     VALUES ($1::uuid,$2,'OPS','Operations',true,$3)`,
    ACCOUNT, ORG, USER,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO commercial_budgets
      (id,organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by)
     VALUES ($1::uuid,$2,$3::uuid,'FY Budget','AUD','INCLUSIVE','PERIODISED',$4)`,
    BUDGET, ORG, FY, USER,
  );
  await seedVersion(V1, 1);
});

afterAll(async () => {
  await prisma.$disconnect();
});
describe('C7.7D — real PostgreSQL activation concurrency', () => {
  it('activates a valid PERIODISED version and updates the Budget pointer', async () => {
    const activated = await activateBudgetVersion({
      organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V1,
    });
    expect(activated.status).toBe('ACTIVE');

    const rows = await prisma.$queryRawUnsafe<{ active_version_id: string; active_count: bigint }[]>(
      `SELECT b.active_version_id,
        (SELECT COUNT(*) FROM commercial_budget_versions v WHERE v.budget_id=b.id AND v.status='ACTIVE') AS active_count
       FROM commercial_budgets b WHERE b.id=$1::uuid`,
      BUDGET,
    );
    expect(rows[0].active_version_id).toBe(V1);
    expect(Number(rows[0].active_count)).toBe(1);
  });

  it('rejects activation when period allocations do not exactly equal the annual Budget line', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_budget_period_allocations SET amount_cents=5000
       WHERE organisation_id=$1 AND financial_period_id=$2::uuid`,
      ORG, P2,
    );
    await expect(activateBudgetVersion({
      organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V1,
    })).rejects.toMatchObject({ code: 'INVALID_PERIOD_ALLOCATIONS' });
  });

  it('rejects activation once the financial year is CLOSED', async () => {
    await prisma.$executeRawUnsafe(
      `UPDATE commercial_financial_years SET status='CLOSED' WHERE id=$1::uuid`, FY,
    );
    await expect(activateBudgetVersion({
      organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V1,
    })).rejects.toMatchObject({ code: 'FINANCIAL_YEAR_CLOSED' });
  });

  it('serializes two concurrent attempts on the same DRAFT so only one succeeds', async () => {
    const params = { organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V1 };
    const results = await Promise.allSettled([
      activateBudgetVersion(params),
      activateBudgetVersion(params),
    ]);

    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(BudgetActivationError);
    expect(rejected.reason.code).toBe('NOT_DRAFT');

    const rows = await prisma.$queryRawUnsafe<{ active_count: bigint; active_version_id: string }[]>(
      `SELECT b.active_version_id,
        (SELECT COUNT(*) FROM commercial_budget_versions v WHERE v.budget_id=b.id AND v.status='ACTIVE') AS active_count
       FROM commercial_budgets b WHERE b.id=$1::uuid`,
      BUDGET,
    );
    expect(Number(rows[0].active_count)).toBe(1);
    expect(rows[0].active_version_id).toBe(V1);
  });

  it('supersedes the previous ACTIVE version when a later valid DRAFT activates', async () => {
    await activateBudgetVersion({ organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V1 });
    await seedVersion(V2, 2);

    await activateBudgetVersion({ organisationId: ORG, userId: USER, budgetId: BUDGET, budgetVersionId: V2 });

    const rows = await prisma.$queryRawUnsafe<{ id: string; status: string }[]>(
      `SELECT id,status FROM commercial_budget_versions WHERE budget_id=$1::uuid ORDER BY version_number`,
      BUDGET,
    );
    expect(rows).toEqual([
      { id: V1, status: 'SUPERSEDED' },
      { id: V2, status: 'ACTIVE' },
    ]);
  });
});
