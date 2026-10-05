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
  it('serializes concurrent identical retries and emits one payment, allocation and audit event', async () => {
    await resetFacts();
    const { logSupplierPaymentRecorded } = await import('@/lib/commercial/auditLog');
    vi.mocked(logSupplierPaymentRecorded).mockClear();
    const params = { organisationId: ORG, userId: USER, supplierId: SUPPLIER, amountCents: 10000,
      currency: 'AUD', method: 'BANK_TRANSFER' as const, idempotencyKey: 'aaaaaaaa-0000-0000-0000-000000000301',
      allocations: [{ supplierBillId: BILL, amountCents: 10000 }] };
    const results = await Promise.all(Array.from({ length: 6 }, () => recordSupplierPayment(params)));
    expect(new Set(results.map(result => result.payment.id)).size).toBe(1);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    expect(logSupplierPaymentRecorded).toHaveBeenCalledTimes(1);
    expect(await testSql.raw('SELECT count(*)::int AS n FROM commercial_supplier_payment_allocations')).toEqual([{ n: 1 }]);
    expect((await getSupplierBillPaymentSummary(ORG, BILL))?.outstanding_balance_cents).toBe(0);
    // Case-normalized keys and equivalent timestamps/allocations resolve the original intent.
    expect((await recordSupplierPayment({ ...params, idempotencyKey: params.idempotencyKey.toUpperCase() })).replayed).toBe(true);
    await reverseSupplierPayment({ organisationId: ORG, userId: USER, supplierPaymentId: results[0].payment.id, reason: 'Correction' });
    const replay = await recordSupplierPayment(params);
    expect(replay.payment.status).toBe('REVERSED'); expect(replay.replayed).toBe(true);
    expect(logSupplierPaymentRecorded).toHaveBeenCalledTimes(1);
    expect((await getSupplierBillPaymentSummary(ORG, BILL))?.outstanding_balance_cents).toBe(10000);
  });

  it('rejects concurrent key reuse with different bills without writing the second request', async () => {
    await resetFacts();
    const other = '00000000-0000-0000-0000-000000000299';
    await testSql.raw(`INSERT INTO commercial_supplier_bills (id,organisation_id,supplier_id,currency,status,total_cents)
      VALUES ('${other}','${ORG}','${SUPPLIER}','AUD','POSTED',10000)`);
    const attempt = (bill: string) => recordSupplierPayment({ organisationId: ORG, userId: USER, supplierId: SUPPLIER,
      amountCents: 1000, currency: 'AUD', method: 'CASH', idempotencyKey: 'aaaaaaaa-0000-0000-0000-000000000302',
      allocations: [{ supplierBillId: bill, amountCents: 1000 }] });
    const results = await Promise.allSettled([attempt(BILL), attempt(other)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.message).toContain('Idempotency key');
    expect(await testSql.raw('SELECT count(*)::int AS n FROM commercial_supplier_payments')).toEqual([{ n: 1 }]);
  });

  it('canonicalizes allocation order and scopes the same key to its organisation', async () => {
    await resetFacts();
    const second = '00000000-0000-0000-0000-000000000298';
    await testSql.raw(`INSERT INTO commercial_supplier_bills (id,organisation_id,supplier_id,currency,status,total_cents)
      VALUES ('${second}','${ORG}','${SUPPLIER}','AUD','POSTED',10000)`);
    const params = { organisationId: ORG, userId: USER, supplierId: SUPPLIER, amountCents: 2000,
      currency: 'AUD', method: 'CASH' as const, idempotencyKey: 'aaaaaaaa-0000-0000-0000-000000000303',
      allocations: [{ supplierBillId: BILL, amountCents: 1000 }, { supplierBillId: second, amountCents: 1000 }] };
    const first = await recordSupplierPayment(params);
    expect((await recordSupplierPayment({ ...params, allocations: [...params.allocations].reverse() })).payment.id).toBe(first.payment.id);
    await expect(recordSupplierPayment({ ...params, reference: 'different' })).rejects.toThrow('Idempotency key');
    await expect(recordSupplierPayment({ ...params, organisationId: 'other-org' })).rejects.toThrow('could not be recorded');
    const otherSupplier = '00000000-0000-0000-0000-000000000198';
    const otherBill = '00000000-0000-0000-0000-000000000297';
    await testSql.raw("INSERT INTO organisations VALUES ('other-org')");
    await testSql.raw(`INSERT INTO commercial_suppliers VALUES ('${otherSupplier}','other-org')`);
    await testSql.raw(`INSERT INTO commercial_supplier_bills VALUES ('${otherBill}','other-org','${otherSupplier}','AUD','POSTED',10000)`);
    const other = await recordSupplierPayment({ ...params, organisationId: 'other-org', supplierId: otherSupplier,
      allocations: [{ supplierBillId: otherBill, amountCents: 2000 }] });
    expect(other.replayed).toBe(false); expect(other.payment.id).not.toBe(first.payment.id);
  });

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
