import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('C7.5D1 allocation migration test requires disposable local DATABASE_URL');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing C7.5D1 allocation migration test against a non-local database');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const migration = fs.readFileSync(
  path.resolve(__dirname, '../create-commercial-purchase-match-allocations.sql'),
  'utf-8',
);

async function executeSqlScript(sql: string): Promise<void> {
  const executable = sql.replace(/--.*$/gm, '');
  for (const statement of executable.split(';').map(part => part.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

beforeAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_purchase_receipt_bill_allocations');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_purchase_receipt_lines');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bill_lines');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS users');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS organisations');
  await prisma.$executeRawUnsafe('CREATE TABLE organisations (id TEXT PRIMARY KEY)');
  await prisma.$executeRawUnsafe('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE commercial_purchase_receipt_lines (
      id UUID PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      source_purchase_order_line_id UUID NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE commercial_supplier_bill_lines (
      id UUID PRIMARY KEY,
      organisation_id TEXT NOT NULL,
      source_purchase_order_line_id UUID NOT NULL
    )
  `);

  await prisma.$executeRawUnsafe("INSERT INTO organisations (id) VALUES ('org-a')");
  await prisma.$executeRawUnsafe("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
  await prisma.$executeRawUnsafe(`
    INSERT INTO commercial_purchase_receipt_lines
      (id, organisation_id, source_purchase_order_line_id)
    VALUES
      ('00000000-0000-0000-0000-000000000101', 'org-a', '00000000-0000-0000-0000-000000000001')
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO commercial_supplier_bill_lines
      (id, organisation_id, source_purchase_order_line_id)
    VALUES
      ('00000000-0000-0000-0000-000000000201', 'org-a', '00000000-0000-0000-0000-000000000001'),
      ('00000000-0000-0000-0000-000000000202', 'org-a', '00000000-0000-0000-0000-000000000002')
  `);

  await executeSqlScript(migration);
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_purchase_receipt_bill_allocations');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_purchase_receipt_lines');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bill_lines');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS users');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS organisations');
  await prisma.$disconnect();
});

describe('C7.5D1 — real Postgres allocation migration', () => {
  it('is idempotent and creates the explicit allocation table', async () => {
    await expect(executeSqlScript(migration)).resolves.not.toThrow();
    const [{ exists }] = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(`
      SELECT to_regclass('public.commercial_purchase_receipt_bill_allocations') IS NOT NULL AS exists
    `);
    expect(exists).toBe(true);
  });

  it('adds both composite source-line identity anchors', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname='public'
        AND indexname IN (
          'commercial_purchase_receipt_lines_match_identity_key',
          'commercial_supplier_bill_lines_match_identity_key'
        )
      ORDER BY indexname
    `);
    expect(rows.map(r => r.indexname)).toEqual([
      'commercial_purchase_receipt_lines_match_identity_key',
      'commercial_supplier_bill_lines_match_identity_key',
    ]);
  });
  it('accepts an exact same-tenant same-PO-line allocation', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_purchase_receipt_bill_allocations (
        organisation_id, purchase_order_line_id,
        purchase_receipt_line_id, supplier_bill_line_id,
        quantity_allocated, created_by
      ) VALUES (
        'org-a', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000201',
        6.5000, 'user-1'
      )
    `)).resolves.not.toThrow();
  });

  it('rejects a bill line from a different PO line structurally', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_purchase_receipt_bill_allocations (
        organisation_id, purchase_order_line_id,
        purchase_receipt_line_id, supplier_bill_line_id,
        quantity_allocated, created_by
      ) VALUES (
        'org-a', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000202',
        1.0000, 'user-1'
      )
    `)).rejects.toThrow();
  });

  it('rejects zero and negative allocation quantities', async () => {
    for (const quantity of ['0', '-0.0001']) {
      await expect(prisma.$executeRawUnsafe(`
        INSERT INTO commercial_purchase_receipt_bill_allocations (
          organisation_id, purchase_order_line_id,
          purchase_receipt_line_id, supplier_bill_line_id,
          quantity_allocated, created_by
        ) VALUES (
          'org-a', '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000101',
          '00000000-0000-0000-0000-000000000201',
          ${quantity}, 'user-1'
        )
      `)).rejects.toThrow();
    }
  });
  it('allows only one active allocation per line pair, then permits replacement after reversal', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_purchase_receipt_bill_allocations (
        organisation_id, purchase_order_line_id,
        purchase_receipt_line_id, supplier_bill_line_id,
        quantity_allocated, created_by
      ) VALUES (
        'org-a', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000201',
        1.0000, 'user-1'
      )
    `)).rejects.toThrow();

    await prisma.$executeRawUnsafe(`
      UPDATE commercial_purchase_receipt_bill_allocations
      SET reversed_by='user-2', reversed_at=now(), reversal_reason='Correction'
      WHERE organisation_id='org-a'
        AND purchase_receipt_line_id='00000000-0000-0000-0000-000000000101'
        AND supplier_bill_line_id='00000000-0000-0000-0000-000000000201'
        AND reversed_at IS NULL
    `);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_purchase_receipt_bill_allocations (
        organisation_id, purchase_order_line_id,
        purchase_receipt_line_id, supplier_bill_line_id,
        quantity_allocated, created_by
      ) VALUES (
        'org-a', '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000201',
        3.5000, 'user-2'
      )
    `)).resolves.not.toThrow();
  });
  it('requires complete reversal metadata rather than allowing partial reversal state', async () => {
    await expect(prisma.$executeRawUnsafe(`
      UPDATE commercial_purchase_receipt_bill_allocations
      SET reversed_at=now()
      WHERE reversed_at IS NULL
    `)).rejects.toThrow();
  });

  it('rejects missing or blank reversal reasons and upgrades the legacy check without changing facts', async () => {
    const rejectMissingReasons = async () => {
      for (const reason of ['NULL', "''", "'   '"]) {
        await expect(prisma.$executeRawUnsafe(`
          UPDATE commercial_purchase_receipt_bill_allocations
          SET reversed_at=now(), reversed_by='user-2', reversal_reason=${reason}
          WHERE reversed_at IS NULL
        `)).rejects.toThrow();
      }
    };
    await rejectMissingReasons();
    const before = await prisma.$queryRawUnsafe('SELECT * FROM commercial_purchase_receipt_bill_allocations ORDER BY id');
    await prisma.$executeRawUnsafe(`
      ALTER TABLE commercial_purchase_receipt_bill_allocations
      DROP CONSTRAINT commercial_match_allocation_reversal_check,
      ADD CONSTRAINT commercial_match_allocation_reversal_check CHECK (
        (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
        OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND btrim(reversal_reason) <> '')
      )
    `);
    await executeSqlScript(migration);
    await executeSqlScript(migration);
    await rejectMissingReasons();
    expect(await prisma.$queryRawUnsafe('SELECT * FROM commercial_purchase_receipt_bill_allocations ORDER BY id')).toEqual(before);
  });

  it('fails a legacy upgrade atomically when invalid reversal facts already exist', async () => {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE commercial_purchase_receipt_bill_allocations
      DROP CONSTRAINT commercial_match_allocation_reversal_check,
      ADD CONSTRAINT commercial_match_allocation_reversal_check CHECK (
        (reversed_at IS NULL AND reversed_by IS NULL AND reversal_reason IS NULL)
        OR (reversed_at IS NOT NULL AND reversed_by IS NOT NULL AND btrim(reversal_reason) <> '')
      )
    `);
    await prisma.$executeRawUnsafe(`
      UPDATE commercial_purchase_receipt_bill_allocations
      SET reversed_at=now(), reversed_by='user-2', reversal_reason=NULL
      WHERE reversed_at IS NULL
    `);
    const before = await prisma.$queryRawUnsafe('SELECT * FROM commercial_purchase_receipt_bill_allocations ORDER BY id');
    await expect(executeSqlScript(migration)).rejects.toThrow();
    expect(await prisma.$queryRawUnsafe('SELECT * FROM commercial_purchase_receipt_bill_allocations ORDER BY id')).toEqual(before);
    // Failed replacement retains the original constraint, not an unguarded table.
    await expect(prisma.$executeRawUnsafe(`
      UPDATE commercial_purchase_receipt_bill_allocations
      SET reversal_reason='' WHERE reversal_reason IS NULL
    `)).rejects.toThrow();
  });
});
