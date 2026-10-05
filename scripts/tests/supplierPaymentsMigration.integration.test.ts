import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('AP-1 supplier payment migration test requires disposable local DATABASE_URL');
}

const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing AP-1 supplier payment migration test against a non-local database');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const migration = fs.readFileSync(
  path.resolve(__dirname, '../create-commercial-supplier-payments.sql'),
  'utf-8',
);

async function executeSqlScript(sql: string): Promise<void> {
  const executable = sql.replace(/--.*$/gm, '');
  for (const statement of executable.split(';').map(part => part.trim()).filter(Boolean)) {
    await prisma.$executeRawUnsafe(statement);
  }
}

const SUPPLIER_A = '00000000-0000-0000-0000-000000000101';
const SUPPLIER_B = '00000000-0000-0000-0000-000000000102';
const BILL_A1 = '00000000-0000-0000-0000-000000000201';
const BILL_A2 = '00000000-0000-0000-0000-000000000202';
const BILL_B = '00000000-0000-0000-0000-000000000203';
const BILL_USD = '00000000-0000-0000-0000-000000000204';
const PAYMENT_1 = '00000000-0000-0000-0000-000000000301';
const PAYMENT_2 = '00000000-0000-0000-0000-000000000302';

beforeAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_payment_allocations');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_payments');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bills');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_suppliers');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS users');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS organisations');

  await prisma.$executeRawUnsafe('CREATE TABLE organisations (id TEXT PRIMARY KEY)');
  await prisma.$executeRawUnsafe('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE commercial_suppliers (
      id UUID PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      UNIQUE (id, organisation_id)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE commercial_supplier_bills (
      id UUID PRIMARY KEY,
      organisation_id TEXT NOT NULL REFERENCES organisations(id),
      supplier_id UUID NOT NULL,
      currency TEXT NOT NULL,
      status TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      UNIQUE (id, organisation_id),
      FOREIGN KEY (supplier_id, organisation_id)
        REFERENCES commercial_suppliers(id, organisation_id)
    )
  `);

  await prisma.$executeRawUnsafe("INSERT INTO organisations (id) VALUES ('org-a'), ('org-b')");
  await prisma.$executeRawUnsafe("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");

  await prisma.$executeRawUnsafe(`
    INSERT INTO commercial_suppliers (id, organisation_id) VALUES
      ('${SUPPLIER_A}', 'org-a'),
      ('${SUPPLIER_B}', 'org-a'),
      ('00000000-0000-0000-0000-000000000199', 'org-b')
  `);

  await prisma.$executeRawUnsafe(`
    INSERT INTO commercial_supplier_bills
      (id, organisation_id, supplier_id, currency, status, total_cents)
    VALUES
      ('${BILL_A1}', 'org-a', '${SUPPLIER_A}', 'AUD', 'POSTED', 10000),
      ('${BILL_A2}', 'org-a', '${SUPPLIER_A}', 'AUD', 'POSTED', 20000),
      ('${BILL_B}', 'org-a', '${SUPPLIER_B}', 'AUD', 'POSTED', 9000),
      ('${BILL_USD}', 'org-a', '${SUPPLIER_A}', 'USD', 'POSTED', 5000)
  `);

  await executeSqlScript(migration);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_payment_allocations');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_payments');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bills');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_suppliers');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS users');
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS organisations');
  await prisma.$disconnect();
});

describe('AP-1 supplier payment schema migration', () => {
  it('is idempotent and creates both supplier payment tables', async () => {
    await expect(executeSqlScript(migration)).resolves.not.toThrow();

    const rows = await prisma.$queryRawUnsafe<Array<{ payments: boolean; allocations: boolean }>>(`
      SELECT
        to_regclass('public.commercial_supplier_payments') IS NOT NULL AS payments,
        to_regclass('public.commercial_supplier_payment_allocations') IS NOT NULL AS allocations
    `);

    expect(rows[0]).toEqual({ payments: true, allocations: true });
  });

  it('rejects a supplier payment whose supplier belongs to another tenant', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (organisation_id, supplier_id, amount_cents, currency, method, paid_at, recorded_by)
      VALUES
        ('org-a', '00000000-0000-0000-0000-000000000199', 1000, 'AUD', 'BANK_TRANSFER', now(), 'user-1')
    `)).rejects.toThrow();
  });

  it('requires positive payment/allocation cents and complete provider identity', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (organisation_id, supplier_id, amount_cents, currency, method, provider_reference, paid_at, recorded_by)
      VALUES
        ('org-a', '${SUPPLIER_A}', 1000, 'AUD', 'BANK_TRANSFER', 'evt-1', now(), 'user-1')
    `)).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (organisation_id, supplier_id, amount_cents, currency, method, paid_at, recorded_by)
      VALUES
        ('org-a', '${SUPPLIER_A}', 0, 'AUD', 'BANK_TRANSFER', now(), 'user-1')
    `)).rejects.toThrow();

    await prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (id, organisation_id, supplier_id, amount_cents, currency, method, paid_at, recorded_by)
      VALUES
        ('00000000-0000-0000-0000-000000000399', 'org-a', '${SUPPLIER_A}', 1000, 'AUD', 'BANK_TRANSFER', now(), 'user-1')
    `);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payment_allocations
        (organisation_id, supplier_payment_id, supplier_bill_id, supplier_id, currency, allocated_amount_cents)
      VALUES
        ('org-a', '00000000-0000-0000-0000-000000000399', '${BILL_A1}', '${SUPPLIER_A}', 'AUD', 0)
    `)).rejects.toThrow();
  });

  it('enforces provider/reference idempotency', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (organisation_id, supplier_id, amount_cents, currency, method, provider, provider_reference, paid_at, recorded_by)
      VALUES
        ('org-a', '${SUPPLIER_A}', 1000, 'AUD', 'BANK_TRANSFER', 'bank-feed', 'txn-1', now(), 'user-1')
    `);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (organisation_id, supplier_id, amount_cents, currency, method, provider, provider_reference, paid_at, recorded_by)
      VALUES
        ('org-a', '${SUPPLIER_A}', 1000, 'AUD', 'BANK_TRANSFER', 'bank-feed', 'txn-1', now(), 'user-1')
    `)).rejects.toThrow();
  });

  it('allows one payment to allocate across multiple bills for the same supplier and currency', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (id, organisation_id, supplier_id, amount_cents, currency, method, paid_at, recorded_by)
      VALUES
        ('${PAYMENT_1}', 'org-a', '${SUPPLIER_A}', 12000, 'AUD', 'BANK_TRANSFER', now(), 'user-1')
    `);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payment_allocations
        (organisation_id, supplier_payment_id, supplier_bill_id, supplier_id, currency, allocated_amount_cents)
      VALUES
        ('org-a', '${PAYMENT_1}', '${BILL_A1}', '${SUPPLIER_A}', 'AUD', 5000),
        ('org-a', '${PAYMENT_1}', '${BILL_A2}', '${SUPPLIER_A}', 'AUD', 7000)
    `)).resolves.not.toThrow();
  });

  it('allows one bill to receive allocations from multiple payments', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payments
        (id, organisation_id, supplier_id, amount_cents, currency, method, paid_at, recorded_by)
      VALUES
        ('${PAYMENT_2}', 'org-a', '${SUPPLIER_A}', 2000, 'AUD', 'CASH', now(), 'user-1')
    `);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payment_allocations
        (organisation_id, supplier_payment_id, supplier_bill_id, supplier_id, currency, allocated_amount_cents)
      VALUES
        ('org-a', '${PAYMENT_2}', '${BILL_A1}', '${SUPPLIER_A}', 'AUD', 2000)
    `)).resolves.not.toThrow();
  });

  it('rejects cross-supplier allocation structurally', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payment_allocations
        (organisation_id, supplier_payment_id, supplier_bill_id, supplier_id, currency, allocated_amount_cents)
      VALUES
        ('org-a', '${PAYMENT_1}', '${BILL_B}', '${SUPPLIER_A}', 'AUD', 100)
    `)).rejects.toThrow();
  });

  it('rejects cross-currency allocation structurally', async () => {
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_payment_allocations
        (organisation_id, supplier_payment_id, supplier_bill_id, supplier_id, currency, allocated_amount_cents)
      VALUES
        ('org-a', '${PAYMENT_1}', '${BILL_USD}', '${SUPPLIER_A}', 'AUD', 100)
    `)).rejects.toThrow();
  });

  it('requires complete reversal metadata', async () => {
    await expect(prisma.$executeRawUnsafe(`
      UPDATE commercial_supplier_payments
      SET status='REVERSED', reversed_at=now(), reversed_by='user-2'
      WHERE id='${PAYMENT_2}'
    `)).rejects.toThrow();

    await expect(prisma.$executeRawUnsafe(`
      UPDATE commercial_supplier_payments
      SET status='REVERSED', reversed_at=now(), reversed_by='user-2', reversal_reason='Correction'
      WHERE id='${PAYMENT_2}'
    `)).resolves.not.toThrow();
  });
});
