import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8');
}
function stripComments(sql: string): string {
  return sql.replace(/--.*$/gm, '');
}

const migration = stripComments(readSource('scripts/create-commercial-purchase-match-allocations.sql'));
const receiptSource = stripComments(readSource('scripts/create-commercial-purchase-receipts.sql'));
const billSource = stripComments(readSource('scripts/create-commercial-supplier-bills.sql'));

describe('Phase C7.5D1 — allocation structural anchors', () => {
  it('adds id+organisation+PO-line unique anchors to both source line tables', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS commercial_purchase_receipt_lines_match_identity_key\s*ON commercial_purchase_receipt_lines\(id, organisation_id, source_purchase_order_line_id\)/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS commercial_supplier_bill_lines_match_identity_key\s*ON commercial_supplier_bill_lines\(id, organisation_id, source_purchase_order_line_id\)/);
  });

  it('keeps fresh-schema Receipt and Supplier Bill line definitions aligned', () => {
    expect(receiptSource).toMatch(/commercial_purchase_receipt_lines_match_identity_key\s*UNIQUE \(id, organisation_id, source_purchase_order_line_id\)/);
    expect(billSource).toMatch(/commercial_supplier_bill_lines_match_identity_key\s*UNIQUE \(id, organisation_id, source_purchase_order_line_id\)/);
  });
});
describe('Phase C7.5D1 — allocation table shape', () => {
  it('creates one additive explicit allocation ledger', () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS commercial_purchase_receipt_bill_allocations/);
  });

  it('stores tenant, both line ids, common PO-line id, and NUMERIC(14,4) quantity', () => {
    expect(migration).toMatch(/organisation_id\s+TEXT NOT NULL REFERENCES organisations\(id\)/);
    expect(migration).toMatch(/purchase_order_line_id\s+UUID NOT NULL/);
    expect(migration).toMatch(/purchase_receipt_line_id\s+UUID NOT NULL/);
    expect(migration).toMatch(/supplier_bill_line_id\s+UUID NOT NULL/);
    expect(migration).toMatch(/quantity_allocated\s+NUMERIC\(14,4\) NOT NULL CHECK \(quantity_allocated > 0\)/);
  });

  it('composite-FKs both source lines through the same organisation and PO line', () => {
    expect(migration).toMatch(/FOREIGN KEY \(purchase_receipt_line_id, organisation_id, purchase_order_line_id\)[\s\S]*?REFERENCES commercial_purchase_receipt_lines[\s\S]*?\(id, organisation_id, source_purchase_order_line_id\)/);
    expect(migration).toMatch(/FOREIGN KEY \(supplier_bill_line_id, organisation_id, purchase_order_line_id\)[\s\S]*?REFERENCES commercial_supplier_bill_lines[\s\S]*?\(id, organisation_id, source_purchase_order_line_id\)/);
  });

  it('uses reversal metadata instead of deleting allocation history', () => {
    expect(migration).toMatch(/reversed_by\s+TEXT REFERENCES users\(id\)/);
    expect(migration).toMatch(/reversed_at\s+TIMESTAMPTZ/);
    expect(migration).toMatch(/reversal_reason\s+TEXT/);
    expect(migration).toMatch(/commercial_match_allocation_reversal_check/);
  });
});
describe('Phase C7.5D1 — active allocation indexes and containment', () => {
  it('permits only one active allocation per receipt-line/bill-line pair', () => {
    expect(migration).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS commercial_match_allocations_active_pair_unique[\s\S]*?organisation_id, purchase_receipt_line_id, supplier_bill_line_id[\s\S]*?WHERE reversed_at IS NULL/);
  });

  it('indexes active PO-line, receipt-line, and bill-line allocation reads', () => {
    expect(migration).toMatch(/idx_commercial_match_allocations_po_line[\s\S]*?WHERE reversed_at IS NULL/);
    expect(migration).toMatch(/idx_commercial_match_allocations_receipt_line[\s\S]*?WHERE reversed_at IS NULL/);
    expect(migration).toMatch(/idx_commercial_match_allocations_bill_line[\s\S]*?WHERE reversed_at IS NULL/);
  });

  it('does not add cached matched quantities, values, status, payments, or GL fields', () => {
    expect(migration).not.toMatch(/ADD COLUMN[\s\S]*?(matched_quantity|matched_value|match_status|paid_cents|payment_id|encumbrance|committed)/i);
  });

  it('contains no destructive table/data operation', () => {
    expect(migration).not.toMatch(/\bDROP\s+TABLE\b|\bDELETE\s+FROM\b|\bTRUNCATE\b/i);
  });
});
