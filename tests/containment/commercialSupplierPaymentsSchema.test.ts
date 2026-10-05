import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8');
}

function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const migration = stripComments(readSource('scripts/create-commercial-supplier-payments.sql'));

describe('AP-1 supplier payment schema foundation', () => {
  it('creates separate AP payment and allocation tables without reusing the AR payment tables', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS commercial_supplier_payments/);
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS commercial_supplier_payment_allocations/);
    expect(migration).not.toMatch(/CREATE TABLE IF NOT EXISTS commercial_payments\b/);
    expect(migration).not.toMatch(/ALTER TABLE commercial_payments\b/);
    expect(migration).not.toMatch(/ALTER TABLE commercial_payment_allocations\b/);
  });

  it('stores positive money, explicit currency, method, payment time and immutable-reversal metadata', () => {
    expect(migration).toMatch(/amount_cents\s+INTEGER NOT NULL CHECK \(amount_cents > 0\)/);
    expect(migration).toMatch(/currency\s+TEXT NOT NULL CHECK \(currency ~ '\^\[A-Z\]\{3\}\$'\)/);
    expect(migration).toMatch(/method\s+TEXT NOT NULL[\s\S]*?BANK_TRANSFER[\s\S]*?CASH[\s\S]*?CARD[\s\S]*?CHEQUE[\s\S]*?OTHER/);
    expect(migration).toMatch(/paid_at\s+TIMESTAMPTZ NOT NULL/);
    expect(migration).toMatch(/status\s+TEXT NOT NULL DEFAULT 'RECORDED'[\s\S]*?'RECORDED'[\s\S]*?'REVERSED'/);
    expect(migration).toMatch(/commercial_supplier_payments_reversal_shape/);
  });

  it('structurally scopes a supplier payment to its tenant-owned supplier', () => {
    expect(migration).toMatch(/FOREIGN KEY \(supplier_id, organisation_id\)[\s\S]*?REFERENCES commercial_suppliers\(id, organisation_id\)/);
    expect(migration).toMatch(/UNIQUE \(id, organisation_id, supplier_id, currency\)/);
  });

  it('structurally binds every allocation to the same tenant, supplier and currency on both payment and bill', () => {
    expect(migration).toMatch(/commercial_supplier_bills_payment_identity_key[\s\S]*?commercial_supplier_bills\(id, organisation_id, supplier_id, currency\)/);
    expect(migration).toMatch(/FOREIGN KEY \(supplier_payment_id, organisation_id, supplier_id, currency\)[\s\S]*?REFERENCES commercial_supplier_payments\(id, organisation_id, supplier_id, currency\)/);
    expect(migration).toMatch(/FOREIGN KEY \(supplier_bill_id, organisation_id, supplier_id, currency\)[\s\S]*?REFERENCES commercial_supplier_bills\(id, organisation_id, supplier_id, currency\)/);
  });

  it('supports multi-bill remittances and multiple payments per bill without duplicate allocations to one bill from one payment', () => {
    expect(migration).toMatch(/UNIQUE \(organisation_id, supplier_payment_id, supplier_bill_id\)/);
    expect(migration).not.toMatch(/UNIQUE \(organisation_id, supplier_payment_id\)\s*[,)]/);
    expect(migration).not.toMatch(/UNIQUE \(organisation_id, supplier_bill_id\)\s*[,)]/);
  });

  it('reserves idempotent external provider identity and requires provider when provider_reference exists', () => {
    expect(migration).toMatch(/commercial_supplier_payments_provider_reference_requires_provider/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_supplier_payments_provider_reference[\s\S]*?organisation_id, provider, provider_reference[\s\S]*?WHERE provider_reference IS NOT NULL/);
  });

  it('does not touch C7.8 Actual or C7.9 finance evidence tables', () => {
    expect(migration).not.toMatch(/commercial_finance_adjustments|commercial_finance_reconciliations|commercial_finance_reconciliation_items|commercial_external_gl_entries|commercial_budget_period_allocations/);
  });

  it('contains no destructive data/table operation', () => {
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b|ALTER\s+TABLE[\s\S]*?DROP/i);
  });
});
