import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

function readSource(relPath: string): string {
  return fs.readFileSync(path.resolve(__dirname, '../../', relPath), 'utf-8');
}

const receiptSource = readSource('lib/commercial/purchaseReceipts.ts');
const billSource = readSource('lib/commercial/supplierBills.ts');

describe('Phase C7.5D2 — cancellation serialization contract', () => {
  it('Purchase Receipt cancellation locks affected PO lines before a fresh active-allocation guard', () => {
    const fn = receiptSource.slice(receiptSource.indexOf('export async function cancelPurchaseReceipt'));
    expect(fn).toMatch(/sql\.transaction\s*\(/);
    expect(fn).toMatch(/affected_line_ids AS MATERIALIZED/);
    expect(fn).toMatch(/commercial_purchase_order_lines[\s\S]*?ORDER BY pol\.id[\s\S]*?FOR UPDATE/);
    expect(fn).toMatch(/commercial_purchase_receipt_bill_allocations/);
    expect(fn).toMatch(/a\.reversed_at IS NULL/);
    expect(fn).toMatch(/NOT EXISTS/);
    expect(fn).toMatch(/isolationLevel:\s*'ReadCommitted'/);
    expect(fn).not.toMatch(/DELETE\s+FROM\s+commercial_purchase_receipt_bill_allocations/i);
  });

  it('Supplier Bill cancellation locks affected PO lines before a fresh active-allocation guard', () => {
    const fn = billSource.slice(billSource.indexOf('export async function cancelSupplierBill'));
    expect(fn).toMatch(/sql\.transaction\s*\(/);
    expect(fn).toMatch(/affected_line_ids AS MATERIALIZED/);
    expect(fn).toMatch(/commercial_purchase_order_lines[\s\S]*?ORDER BY pol\.id[\s\S]*?FOR UPDATE/);
    expect(fn).toMatch(/commercial_purchase_receipt_bill_allocations/);
    expect(fn).toMatch(/a\.reversed_at IS NULL/);
    expect(fn).toMatch(/NOT EXISTS/);
    expect(fn).toMatch(/isolationLevel:\s*'ReadCommitted'/);
    expect(fn).not.toMatch(/DELETE\s+FROM\s+commercial_purchase_receipt_bill_allocations/i);
  });

  it('both cancellation paths instruct operators to reverse active match facts rather than deleting them', () => {
    expect(receiptSource).toMatch(/active purchase match allocations; reverse them before cancelling the receipt/);
    expect(billSource).toMatch(/active purchase match allocations; reverse them before cancelling the bill/);
  });
});
