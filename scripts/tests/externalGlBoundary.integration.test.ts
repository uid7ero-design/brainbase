import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('externalGlBoundary.integration.test.ts requires DATABASE_URL.');
if (/neon\.tech|amazonaws\.com|\.rds\.|azure\.com/i.test(DATABASE_URL)) throw new Error('Refusing hosted database.');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost','127.0.0.1'].includes(host)) throw new Error('Refusing non-localhost database.');

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Q = { strings: readonly string[]; values: unknown[] };
function compile(q: Q) {
  let text = q.strings[0];
  for (let i=0;i<q.values.length;i++) {
    const cast = typeof q.values[i] === 'string' && UUID_RE.test(q.values[i] as string) ? '::uuid' : '';
    text += `$${i+1}${cast}` + q.strings[i+1];
  }
  return { text, values:q.values };
}

const sqlMock = Object.assign(
  async (strings:TemplateStringsArray,...values:unknown[]) => {
    const q=compile({strings,values}); return prisma.$queryRawUnsafe(q.text,...q.values);
  },
  { transaction: async (builder:(txn:(s:TemplateStringsArray,...v:unknown[])=>Q)=>Q[], options?:{isolationLevel?:string}) =>
      prisma.$transaction(async tx => {
        const descriptors=builder((strings,...values)=>({strings,values}));
        const out:unknown[]=[];
        for(const descriptor of descriptors){ const q=compile(descriptor); out.push(await tx.$queryRawUnsafe(q.text,...q.values)); }
        return out;
      }, { isolationLevel: options?.isolationLevel as 'ReadCommitted' | undefined }) }
);
vi.doMock('@/lib/db',()=>({default:sqlMock}));

const {
  createExternalGlAccountMapping,
  retireExternalGlAccountMapping,
  listExternalGlAccountMappings,
  createExternalGlCostCentreMapping,
  retireExternalGlCostCentreMapping,
  listExternalGlCostCentreMappings,
  importExternalGlEntry,
  listExternalGlSourceSystemIds,
  assertSameReconciliationCurrency,
  ExternalGlError,
} = await import('@/lib/commercial/externalGl');

const ORG='org-c79d';
const OTHER='org-c79d-other';
const USER='user-c79d';
const OTHER_USER='user-c79d-other';
const ACCOUNT='79999999-4000-0000-0000-000000000001';
const OTHER_ACCOUNT='79999999-4000-0000-0000-000000000002';
const COST_CENTRE='79999999-4000-0000-0000-000000000003';
const OTHER_COST_CENTRE='79999999-4000-0000-0000-000000000004';

beforeAll(async()=>{
  await prisma.$executeRawUnsafe(`INSERT INTO organisations(id,name) VALUES ($1,'C7.9D'),($2,'C7.9D Other') ON CONFLICT(id) DO NOTHING`,ORG,OTHER);
  await prisma.$executeRawUnsafe(`INSERT INTO users(id,organisation_id) VALUES ($1,$2),($3,$4) ON CONFLICT(id) DO NOTHING`,USER,ORG,OTHER_USER,OTHER);
});

let testSequence = 0;
beforeEach(async()=>{
  testSequence += 1;
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_external_gl_account_mappings WHERE organisation_id IN ($1,$2)`,ORG,OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_external_gl_cost_centre_mappings WHERE organisation_id IN ($1,$2)`,ORG,OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_budget_accounts WHERE organisation_id IN ($1,$2)`,ORG,OTHER);
  await prisma.$executeRawUnsafe(`DELETE FROM commercial_cost_centres WHERE organisation_id IN ($1,$2)`,ORG,OTHER);
  await prisma.$executeRawUnsafe(`INSERT INTO commercial_budget_accounts(id,organisation_id,code,name,active,created_by)
    VALUES ($1::uuid,$2,'OPEX','Operating',true,$3),($4::uuid,$5,'OTHER','Other',true,$6)`,
    ACCOUNT,ORG,USER,OTHER_ACCOUNT,OTHER,OTHER_USER);
  await prisma.$executeRawUnsafe(`INSERT INTO commercial_cost_centres(id,organisation_id,code,name,active)
    VALUES ($1::uuid,$2,'OPS','Operations',true),($3::uuid,$4,'OTHER','Other',true)`,
    COST_CENTRE,ORG,OTHER_COST_CENTRE,OTHER);
});

afterAll(async()=>prisma.$disconnect());

const mappingInput = () => ({
  organisationId:ORG,userId:USER,sourceSystemId:'xero',externalAccountCode:'600',
  externalAccountName:'Repairs',budgetAccountId:ACCOUNT,effectiveFrom:'2026-07-01',effectiveTo:null,
});
const costCentreMappingInput = () => ({
  organisationId:ORG,userId:USER,sourceSystemId:'xero',externalCostCentreCode:'OPS-EXT',
  costCentreId:COST_CENTRE,effectiveFrom:'2026-07-01',effectiveTo:null,
});
const entryInput = () => ({
  organisationId:ORG,userId:USER,sourceSystemId:'xero',externalEntryId:`entry-${testSequence}`,
  externalJournalId:'journal-1',externalAccountCode:'600',externalCostCentreCode:'OPS',
  transactionDate:'2026-09-30',accountingPeriodKey:'2026-09',description:'Repairs',
  currency:'AUD',amountMinorUnits:'12345',sourcePayloadHash:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  sourceLineageId:'import-batch-1',
});

describe('C7.9D — real PostgreSQL external GL boundary',()=>{
  it('creates explicit tenant-scoped mapping and can retire it with effective dating',async()=>{
    const mapping=await createExternalGlAccountMapping(mappingInput());
    expect(mapping).toMatchObject({organisation_id:ORG,source_system_id:'xero',external_gl_account_code:'600',budget_account_id:ACCOUNT,status:'ACTIVE'});
    const retired=await retireExternalGlAccountMapping({organisationId:ORG,userId:USER,mappingId:mapping.id,effectiveTo:'2026-12-31'});
    expect(retired).toMatchObject({status:'RETIRED',effective_to:expect.anything()});
  });

  it('rejects cross-tenant Budget account mapping',async()=>{
    await expect(createExternalGlAccountMapping({...mappingInput(),budgetAccountId:OTHER_ACCOUNT}))
      .rejects.toMatchObject({code:'NOT_FOUND'});
  });

  it('serializes overlapping concurrent mapping creation',async()=>{
    const results=await Promise.allSettled([createExternalGlAccountMapping(mappingInput()),createExternalGlAccountMapping(mappingInput())]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    const rejected=results.find(x=>x.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({code:'OVERLAPPING_MAPPING'});
  });

  it('creates, retires and tenant-isolates explicit cost-centre mappings',async()=>{
    const mapping=await createExternalGlCostCentreMapping(costCentreMappingInput());
    expect(mapping).toMatchObject({
      organisation_id:ORG,
      source_system_id:'xero',
      external_cost_centre_code:'OPS-EXT',
      cost_centre_id:COST_CENTRE,
      status:'ACTIVE',
    });

    await expect(createExternalGlCostCentreMapping({
      ...costCentreMappingInput(),
      costCentreId:OTHER_COST_CENTRE,
    })).rejects.toMatchObject({code:'NOT_FOUND'});

    await expect(retireExternalGlCostCentreMapping({
      organisationId:ORG,
      userId:USER,
      mappingId:mapping.id,
      effectiveTo:' ',
    })).rejects.toMatchObject({code:'INVALID_INPUT'});

    const retired=await retireExternalGlCostCentreMapping({
      organisationId:ORG,
      userId:USER,
      mappingId:mapping.id,
      effectiveTo:'2026-12-31',
    });
    expect(retired).toMatchObject({status:'RETIRED',effective_to:expect.anything()});
  });

  it('serializes overlapping concurrent cost-centre mapping creation',async()=>{
    const results=await Promise.allSettled([
      createExternalGlCostCentreMapping(costCentreMappingInput()),
      createExternalGlCostCentreMapping(costCentreMappingInput()),
    ]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    const rejected=results.find(x=>x.status==='rejected') as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({code:'OVERLAPPING_MAPPING'});
  });

  it('lists account and cost-centre mappings with BrainBase labels and tenant-scoped filters',async()=>{
    const accountMapping=await createExternalGlAccountMapping(mappingInput());
    const costCentreMapping=await createExternalGlCostCentreMapping(costCentreMappingInput());

    await createExternalGlAccountMapping({
      ...mappingInput(),
      organisationId:OTHER,
      userId:OTHER_USER,
      sourceSystemId:'sage',
      externalAccountCode:'700',
      budgetAccountId:OTHER_ACCOUNT,
    });
    await createExternalGlCostCentreMapping({
      ...costCentreMappingInput(),
      organisationId:OTHER,
      userId:OTHER_USER,
      sourceSystemId:'sage',
      externalCostCentreCode:'OTHER-EXT',
      costCentreId:OTHER_COST_CENTRE,
    });

    expect(await listExternalGlAccountMappings({
      organisationId:ORG,
      sourceSystemId:'xero',
      status:'ACTIVE',
    })).toEqual([
      expect.objectContaining({
        id:accountMapping.id,
        source_system_id:'xero',
        external_gl_account_code:'600',
        budget_account_id:ACCOUNT,
        budget_account_code:'OPEX',
        budget_account_name:'Operating',
        status:'ACTIVE',
      }),
    ]);

    expect(await listExternalGlCostCentreMappings({
      organisationId:ORG,
      sourceSystemId:'xero',
      status:'ACTIVE',
    })).toEqual([
      expect.objectContaining({
        id:costCentreMapping.id,
        source_system_id:'xero',
        external_cost_centre_code:'OPS-EXT',
        cost_centre_id:COST_CENTRE,
        cost_centre_code:'OPS',
        cost_centre_name:'Operations',
        status:'ACTIVE',
      }),
    ]);
  });

  it('imports once and returns IDEMPOTENT for the exact same immutable external fact',async()=>{
    const first=await importExternalGlEntry(entryInput());
    const second=await importExternalGlEntry(entryInput());
    expect(first.outcome).toBe('IMPORTED');
    expect(second.outcome).toBe('IDEMPOTENT');
    expect(second.entry.id).toBe(first.entry.id);
  });

  it('fails loud when the same external identity arrives with changed source facts',async()=>{
    await importExternalGlEntry(entryInput());
    await expect(importExternalGlEntry({...entryInput(),amountMinorUnits:'12346',sourcePayloadHash:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'}))
      .rejects.toMatchObject({code:'EXTERNAL_IDENTITY_CONFLICT'});
  });

  it('database trigger rejects UPDATE and DELETE of imported GL facts',async()=>{
    const first=await importExternalGlEntry(entryInput());
    await expect(prisma.$executeRawUnsafe(`UPDATE commercial_external_gl_entries SET description='changed' WHERE id=$1::uuid`,first.entry.id))
      .rejects.toThrow(/immutable source observations/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM commercial_external_gl_entries WHERE id=$1::uuid`,first.entry.id))
      .rejects.toThrow(/immutable source observations/);
  });

  it('allows the same external identity in a different tenant without collision',async()=>{
    const first=await importExternalGlEntry(entryInput());
    const second=await importExternalGlEntry({...entryInput(),organisationId:OTHER,userId:OTHER_USER});
    expect(first.entry.id).not.toBe(second.entry.id);
    expect(second.entry.organisation_id).toBe(OTHER);
  });

  it('lists distinct finance source IDs in sorted order without crossing tenants',async()=>{
    await createExternalGlAccountMapping({
      ...mappingInput(),
      sourceSystemId:'myob',
      externalAccountCode:'601',
    });
    await importExternalGlEntry({
      ...entryInput(),
      externalEntryId:`source-list-org-${testSequence}`,
      sourceSystemId:'xero',
    });
    await importExternalGlEntry({
      ...entryInput(),
      organisationId:OTHER,
      userId:OTHER_USER,
      externalEntryId:`source-list-other-${testSequence}`,
      sourceSystemId:'sage',
    });

    expect(await listExternalGlSourceSystemIds(ORG)).toEqual(['myob','xero']);
    const otherSources=await listExternalGlSourceSystemIds(OTHER);
    expect(otherSources).toContain('sage');
    expect(otherSources).not.toContain('myob');
  });

  it('preserves source currency and rejects cross-currency reconciliation',async()=>{
    const imported=await importExternalGlEntry({...entryInput(),currency:'usd'});
    expect(imported.entry.currency).toBe('USD');
    expect(()=>assertSameReconciliationCurrency('AUD','USD')).toThrowError(ExternalGlError);
    expect(()=>assertSameReconciliationCurrency('AUD','USD')).toThrow(/Cross-currency reconciliation is prohibited/);
    expect(()=>assertSameReconciliationCurrency('AUD','AUD')).not.toThrow();
  });
});
