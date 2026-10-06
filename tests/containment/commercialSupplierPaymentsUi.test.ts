import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

const PAGE_PATH = path.resolve(process.cwd(), 'app/commercial/purchasing/supplier-bills/[id]/page.tsx');
const PAGE_SRC = fs.readFileSync(PAGE_PATH, 'utf8');

describe('AP-4 supplier bill settlement UI contract', () => {
  it('uses the client-safe payment method module and never imports the server-only supplier payment domain', () => {
    expect(PAGE_SRC).toContain("from '@/lib/commercial/paymentMethods'");
    expect(PAGE_SRC).not.toMatch(/from ['"]@\/lib\/commercial\/supplierPayments['"]/);
    expect(PAGE_SRC).toContain('PAYMENT_METHODS.map');
  });

  it('loads the bill-scoped payment summary for the settlement surface', () => {
    expect(PAGE_SRC).toContain('fetch(`/api/commercial/supplier-bills/${id}/payments`)');
    expect(PAGE_SRC).toContain('setPaymentSummary((await paymentsRes.json()).supplier_bill_payment_summary ?? null)');
  });

  it('shows payment state, Paid, Remaining and history without an admin-only visibility gate', () => {
    expect(PAGE_SRC).toContain('paymentSummary && !isDraft');
    expect(PAGE_SRC).toContain('Supplier Payments');
    expect(PAGE_SRC).toContain('label="Paid"');
    expect(PAGE_SRC).toContain('label="Remaining"');
    expect(PAGE_SRC).toContain('Supplier payment history');
    expect(PAGE_SRC).toContain('paymentSummary.payment_state.replaceAll');
  });

  it('uses the allocation amount for bill-level history rather than the whole remittance amount', () => {
    expect(PAGE_SRC).toContain('formatMoneyCents(payment.allocated_amount_cents, supplierBill.currency)');
  });

  it('preserves reversed payment history and surfaces the reversal reason', () => {
    expect(PAGE_SRC).toContain("payment.status === 'RECORDED'");
    expect(PAGE_SRC).toContain("Reversed{payment.reversal_reason ? `: ${payment.reversal_reason}` : ''}");
  });

  it('gates Record Payment to POSTED bills, admins and a positive outstanding balance', () => {
    expect(PAGE_SRC).toMatch(/isPosted && isAdmin && \(paymentSummary\?\.outstanding_balance_cents \?\? 0\) > 0/);
    expect(PAGE_SRC).toContain('>Record Payment</button>');
  });

  it('records through the governed bill-scoped endpoint with only allowed client fields', () => {
    const start = PAGE_SRC.indexOf('async function recordPayment');
    const end = PAGE_SRC.indexOf('async function reversePayment', start);
    const body = PAGE_SRC.slice(start, end);
    expect(body).toContain('fetch(`/api/commercial/supplier-bills/${id}/payments`');
    expect(body).toContain('amount_cents: amountCents');
    expect(body).toContain('method: paymentMethod');
    expect(body).toContain('reference: paymentReference || null');
    expect(body).toContain('paid_at: paymentPaidDate ? new Date(paymentPaidDate).toISOString() : null');
    expect(body).not.toContain('supplier_id');
    expect(body).not.toContain('currency:');
    expect(body).not.toContain('organisation_id');
    expect(body).not.toContain('provider');
  });

  it('reverses through the exact bill/payment endpoint and requires a reason', () => {
    const start = PAGE_SRC.indexOf('async function reversePayment');
    const end = PAGE_SRC.indexOf('async function deleteAction', start);
    const body = PAGE_SRC.slice(start, end);
    expect(body).toContain("if (!reversalReason.trim())");
    expect(body).toContain('fetch(`/api/commercial/supplier-bills/${id}/payments/${paymentId}/reverse`');
    expect(body).toContain('JSON.stringify({ reason: reversalReason })');
  });

  it('only shows the reversal action for RECORDED payments and admins', () => {
    expect(PAGE_SRC).toContain("payment.status === 'RECORDED' && isAdmin && reversingPaymentId !== payment.id");
    expect(PAGE_SRC).toContain('Reverse Payment</button>');
  });

  it('blocks bill cancellation in the UI while active supplier payments exist', () => {
    expect(PAGE_SRC).toContain('disabled={busy || (paymentSummary?.active_payment_count ?? 0) > 0}');
    expect(PAGE_SRC).toContain('Reverse all recorded supplier payments before cancelling this bill.');
  });

  it('states the finance boundary so settlement is not presented as Budget Actual', () => {
    expect(PAGE_SRC).toContain('Cash settlement is tracked separately from the Budget Actual recognised when this supplier bill was posted.');
  });
});
