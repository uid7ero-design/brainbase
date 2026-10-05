import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createNeonCompatibleSql } from './helpers/neonCompatiblePgSql';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('AP-2 supplier payment concurrency test requires disposable local DATABASE_URL');
const host = new URL(DATABASE_URL.replace(/^postgres(ql)?:\/\//, 'http://')).hostname;
if (!['localhost', '127.0.0.1'].includes(host)) throw new Error('Refusing AP-2 concurrency test against a non-local database');

const testSql = createNeonCompatibleSql(DATABASE_URL);
vi.doMock('@/lib/db', () => ({ default: testSql }));
vi.doMock('@/lib/commercial/auditLog', () => ({
  logSupplierPaymentRecorded: vi.fn(async () => undefined),
  logSupplierPaymentReversed: vi.fn(async () => undefined),
}));

const ORG = 'org-a';
const USER = 'user-1';
const SUPPLIER = '00000000-0000-0000-0000-000000000101';
const BILL = '00000000-0000-0000-0000-000000000201';

let recordSupplierPayment: typeof import('@/lib/commercial/supplierPayments').recordSupplierPayment;
let reverseSupplierPayment: typeof import('@/lib/commercial/supplierPayments').reverseSupplierPayment;
let getSupplierBillPaymentSummary: typeof import('@/lib/commercial/supplierPayments').getSupplierBillPaymentSummary;

async function execScript(sql: string) {
  const executable = sql.replace(/--.*$/gm, '');
  for (const statement of executable.split(';').map(s => s.trim()).filter(Boolean)) {
    await testSql.raw(statement);
  }
}

async function resetFacts() {
  await testSql.raw('DELETE FROM commercial_supplier_payment_allocations');
  await testSql.raw('DELETE FROM commercial_supplier_payments');
}

beforeAll(async () => {
  await testSql.raw('CREATE TABLE organisations (id TEXT PRIMARY KEY)');
  await testSql.raw('CREATE TABLE users (id TEXT PRIMARY KEY)');
  await testSql.raw(`CREATE TABLE commercial_suppliers (
    id UUID PRIMARY KEY,
    organisation_id TEXT NOT NULL REFERENCES organisations(id),
    UNIQUE (id, organisation_id)
  )`);
  await testSql.raw(`CREATE TABLE commercial_supplier_bills (
    id UUID PRIMARY KEY,
    organisation_id TEXT NOT NULL REFERENCES organisations(id),
    supplier_id UUID NOT NULL,
    currency TEXT NOT NULL,
    status TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    UNIQUE (id, organisation_id),
    FOREIGN KEY (supplier_id, organisation_id) REFERENCES commercial_suppliers(id, organisation_id)
  )`);
  await testSql.raw(`INSERT INTO organisations (id) VALUES ('${ORG}')`);
  await testSql.raw(`INSERT INTO users (id) VALUES ('${USER}')`);
  await testSql.raw(`INSERT INTO commercial_suppliers (id, organisation_id) VALUES ('${SUPPLIER}', '${ORG}')`);
  await testSql.raw(`INSERT INTO commercial_supplier_bills (id, organisation_id, supplier_id, currency, status, total_cents)
    VALUES ('${BILL}', '${ORG}', '${SUPPLIER}', 'AUD', 'POSTED', 10000)`);
  const migration = fs.readFileSync(path.resolve(__dirname, '../create-commercial-supplier-payments.sql'), 'utf8');
  await execScript(migration);
  ({ recordSupplierPayment, reverseSupplierPayment, getSupplierBillPaymentSummary } = await import('@/lib/commercial/supplierPayments'));
});

afterAll(async () => {
  await testSql.end();
});

describe('AP-2 real-Postgres supplier settlement concurrency', () => {
  it('records a multi-bill remittance atomically and reverses all allocations together', async () => {
    await resetFacts();
    const secondBill = '00000000-0000-0000-0000-000000000202';
    await testSql.raw(`INSERT INTO commercial_supplier_bills (id,organisation_id,supplier_id,currency,status,total_cents)
      VALUES ('${secondBill}','${ORG}','${SUPPLIER}','AUD','POSTED',5000) ON CONFLICT (id) DO NOTHING`);
    const payment = await recordSupplierPayment({ organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 7500, currency: 'AUD', method: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: BILL, amountCents: 2500 }, { supplierBillId: secondBill, amountCents: 5000 }] });
    expect(payment.allocations).toHaveLength(2);
    expect((await getSupplierBillPaymentSummary(ORG, BILL))?.outstanding_balance_cents).toBe(7500);
    expect((await getSupplierBillPaymentSummary(ORG, secondBill))?.outstanding_balance_cents).toBe(0);
    await reverseSupplierPayment({ organisationId: ORG, userId: USER, supplierPaymentId: payment.payment.id, reason: 'Replace remittance' });
    expect((await getSupplierBillPaymentSummary(ORG, BILL))?.outstanding_balance_cents).toBe(10000);
    expect((await getSupplierBillPaymentSummary(ORG, secondBill))?.outstanding_balance_cents).toBe(5000);
    await expect(recordSupplierPayment({ organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 8500, currency: 'AUD', method: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: BILL, amountCents: 2500 }, { supplierBillId: secondBill, amountCents: 6000 }] })).rejects.toThrow('could not be recorded');
    expect((await getSupplierBillPaymentSummary(ORG, BILL))?.outstanding_balance_cents).toBe(10000);
  });
  it('two concurrent payments cannot both consume the same bill balance', async () => {
    await resetFacts();
    const attempt = () => recordSupplierPayment({
      organisationId: ORG,
      userId: USER,
      supplierId: SUPPLIER,
      amountCents: 7000,
      currency: 'AUD',
      method: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: BILL, amountCents: 7000 }],
    });

    const results = await Promise.allSettled([attempt(), attempt()]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);

    const summary = await getSupplierBillPaymentSummary(ORG, BILL);
    expect(summary).toMatchObject({
      total_cents: 10000,
      amount_paid_cents: 7000,
      outstanding_balance_cents: 3000,
      payment_state: 'PARTIALLY_PAID',
      active_payment_count: 1,
    });
  });

  it('reversal restores the balance so a replacement payment can settle it', async () => {
    await resetFacts();
    const first = await recordSupplierPayment({
      organisationId: ORG,
      userId: USER,
      supplierId: SUPPLIER,
      amountCents: 4000,
      currency: 'AUD',
      method: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: BILL, amountCents: 4000 }],
    });
    await reverseSupplierPayment({
      organisationId: ORG,
      userId: USER,
      supplierPaymentId: first.payment.id,
      reason: 'Replace incorrect remittance',
    });

    const replacement = await recordSupplierPayment({
      organisationId: ORG,
      userId: USER,
      supplierId: SUPPLIER,
      amountCents: 10000,
      currency: 'AUD',
      method: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: BILL, amountCents: 10000 }],
    });
    expect(replacement.payment.status).toBe('RECORDED');

    const summary = await getSupplierBillPaymentSummary(ORG, BILL);
    expect(summary).toMatchObject({
      amount_paid_cents: 10000,
      outstanding_balance_cents: 0,
      payment_state: 'PAID',
      active_payment_count: 1,
    });
    expect(summary?.payments.some(p => p.status === 'REVERSED')).toBe(true);
  });

  it('concurrent reversal permits exactly one RECORDED -> REVERSED transition', async () => {
    await resetFacts();
    const recorded = await recordSupplierPayment({
      organisationId: ORG,
      userId: USER,
      supplierId: SUPPLIER,
      amountCents: 2500,
      currency: 'AUD',
      method: 'CASH',
      allocations: [{ supplierBillId: BILL, amountCents: 2500 }],
    });

    const results = await Promise.allSettled([
      reverseSupplierPayment({ organisationId: ORG, userId: USER, supplierPaymentId: recorded.payment.id, reason: 'Correction A' }),
      reverseSupplierPayment({ organisationId: ORG, userId: USER, supplierPaymentId: recorded.payment.id, reason: 'Correction B' }),
    ]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);

    const summary = await getSupplierBillPaymentSummary(ORG, BILL);
    expect(summary).toMatchObject({ amount_paid_cents: 0, outstanding_balance_cents: 10000, payment_state: 'UNPAID' });
  });
});
