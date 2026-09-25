import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('C7.5C migration integration test requires disposable local DATABASE_URL');
}
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) {
  throw new Error('Refusing C7.5C migration integration test against a non-local database');
}

const prisma = new PrismaClient({ datasourceUrl: DATABASE_URL });
const migration = fs.readFileSync(
  path.resolve(__dirname, '../widen-commercial-supplier-bill-quantity-c7-5c.sql'),
  'utf-8',
);

beforeAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bill_lines');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE commercial_supplier_bill_lines (
      id UUID PRIMARY KEY,
      quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0)
    )
  `);
  await prisma.$executeRawUnsafe(`
    INSERT INTO commercial_supplier_bill_lines (id, quantity) VALUES
      ('00000000-0000-0000-0000-000000000001', 1),
      ('00000000-0000-0000-0000-000000000005', 5),
      ('00000000-0000-0000-0000-000000000010', 10)
  `);
  await prisma.$executeRawUnsafe(migration);
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS commercial_supplier_bill_lines');
  await prisma.$disconnect();
});

describe('C7.5C — real Postgres Supplier Bill quantity migration', () => {
  it('widens quantity to NUMERIC(14,4)', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{
      data_type: string; numeric_precision: number; numeric_scale: number;
    }>>(`
      SELECT data_type, numeric_precision, numeric_scale
      FROM information_schema.columns
      WHERE table_schema='public'
        AND table_name='commercial_supplier_bill_lines'
        AND column_name='quantity'
    `);
    expect(rows[0]).toMatchObject({
      data_type: 'numeric',
      numeric_precision: 14,
      numeric_scale: 4,
    });
  });

  it('migrates existing integer rows losslessly to four-decimal numeric values', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ quantity: string }>>(`
      SELECT quantity::text AS quantity
      FROM commercial_supplier_bill_lines
      ORDER BY id
    `);
    expect(rows.map(r => r.quantity)).toEqual(['1.0000', '5.0000', '10.0000']);
  });

  it('is idempotent when applied a second time', async () => {
    await expect(prisma.$executeRawUnsafe(migration)).resolves.not.toThrow();
  });

  it('persists fractional quantities exactly and retains the positive CHECK', async () => {
    await prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_bill_lines (id, quantity) VALUES
        ('00000000-0000-0000-0000-000000000065', 6.5000),
        ('00000000-0000-0000-0000-000000000101', 0.0001),
        ('00000000-0000-0000-0000-000000000123', 1.2345)
    `);
    const rows = await prisma.$queryRawUnsafe<Array<{ quantity: string }>>(`
      SELECT quantity::text AS quantity
      FROM commercial_supplier_bill_lines
      WHERE id IN (
        '00000000-0000-0000-0000-000000000065',
        '00000000-0000-0000-0000-000000000101',
        '00000000-0000-0000-0000-000000000123'
      )
      ORDER BY quantity
    `);
    expect(rows.map(r => r.quantity)).toEqual(['0.0001', '1.2345', '6.5000']);

    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_bill_lines (id, quantity)
      VALUES ('00000000-0000-0000-0000-000000000200', 0)
    `)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`
      INSERT INTO commercial_supplier_bill_lines (id, quantity)
      VALUES ('00000000-0000-0000-0000-000000000201', -1)
    `)).rejects.toThrow();
  });

  it('rollback guard detects fractional data instead of truncating it', async () => {
    const [{ count }] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`
      SELECT COUNT(*)::bigint AS count
      FROM commercial_supplier_bill_lines
      WHERE quantity <> trunc(quantity)
    `);
    expect(Number(count)).toBeGreaterThan(0);
  });
});
