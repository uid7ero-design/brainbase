import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const design = fs.readFileSync(
  path.resolve(process.cwd(), 'docs/architecture/c7-8-budget-actuals-design.md'),
  'utf8',
);
const supplierSchema = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-supplier-bills.sql'),
  'utf8',
);
const supplierDomain = fs.readFileSync(
  path.resolve(process.cwd(), 'lib/commercial/supplierBills.ts'),
  'utf8',
);
const paymentsSchema = fs.readFileSync(
  path.resolve(process.cwd(), 'scripts/create-commercial-payments.sql'),
  'utf8',
);
const legacyFinancialRoute = fs.readFileSync(
  path.resolve(process.cwd(), 'app/api/financial/[fy]/route.ts'),
  'utf8',
);

describe('C7.8 — governed Budget Actual architecture contract', () => {
  it('selects POSTED supplier-bill lines as the bounded Budget Actual source', () => {
    expect(design).toContain('BrainBase operational payable basis');
    expect(design).toContain('current lifecycle status is POSTED');
    expect(design).toContain('Only supplier_bill.status = POSTED contributes Actual.');
    expect(design).toContain('DRAFT and CANCELLED contribute zero Actual.');
  });

  it('recognises Actual on governed posted_at and explicitly rejects bill_date as accounting recognition', () => {
    expect(design).toContain('actual_recognised_at = commercial_supplier_bills.posted_at');
    expect(design).toContain('bill_date remains supplier-document metadata');
    expect(supplierSchema).toMatch(/bill_date\s+DATE/);
    expect(supplierSchema).toMatch(/posted_at\s+TIMESTAMPTZ/);
    expect(supplierDomain).toMatch(/posted_at = now\(\)/);
  });

  it('keeps Actual non-statutory, non-cash, and distinct from receipt/match evidence', () => {
    expect(design).toContain('not a claim of statutory accounting treatment');
    expect(design).toContain('supplier cash payment');
    expect(design).toContain('receipt posting does not create Budget Actual');
    expect(design).toContain('match allocation does not create Budget Actual');
  });

  it('uses the Budget tax basis consistently for Actual and Committed', () => {
    expect(design).toContain('EXCLUSIVE Budget');
    expect(design).toContain('line_subtotal_cents');
    expect(design).toContain('INCLUSIVE Budget');
    expect(design).toContain('line_total_cents');
    expect(design).toContain('Budget, Actual, and Committed are compared on one consistent basis');
  });

  it('locks the anti-double-counting rule: Actual rises as the same posted value leaves Committed', () => {
    expect(design).toContain('purchasing_exposure = actual_cents + outstanding_commitment_cents');
    expect(design).toContain('Actual rises by posted billed value; Committed falls by the same billed value');
    expect(design).toContain('must never add POSTED billed value on top of the pre-bill full PO commitment');
  });

  it('keeps customer payments outside supplier Budget Actuals', () => {
    expect(paymentsSchema).toContain('commercial_payment_allocations');
    expect(paymentsSchema).toContain('invoice_id');
    expect(design).toContain('commercial_payments tables record customer receipts against sales invoices');
    expect(design).toContain('cannot represent supplier expense payment');
  });

  it('does not adopt legacy financial_models ytd_actual as the governed source', () => {
    expect(legacyFinancialRoute).toContain('ytd_actual');
    expect(design).toContain('financial_models.line_items[].ytd_actual is not the C7.8 Actual source');
    expect(design).toContain('must not');
    expect(design).toContain('copy POSTED supplier-bill Actuals into legacy ytd_actual');
  });

  it('requires one snapshot-consistent Budget vs Actual vs Committed response', () => {
    expect(design).toContain('every report response must correspond to one valid committed database state');
    expect(design).toContain('never a hybrid that double-counts or drops the transitioned amount');
    expect(design).toContain('Disposable PostgreSQL proof is mandatory');
  });

  it('does not authorize a schema migration for the first Actual read model', () => {
    expect(design).toContain('No schema migration required for the first read model');
    expect(design).toContain('preferred first implementation is a derived read model plus tests');
  });
});
