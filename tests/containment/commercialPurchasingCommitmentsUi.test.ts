import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE_PATH = path.resolve(
  process.cwd(),
  'app/commercial/purchasing/purchase-orders/[id]/page.tsx',
);
const source = fs.readFileSync(PAGE_PATH, 'utf8');

describe('Phase C7.6C — purchase-order commitment UI contract', () => {
  it('loads the governed PO-local commitment endpoint', () => {
    expect(source).toContain('/api/commercial/purchase-orders/${id}/commitment');
    expect(source).toContain('setCommitment(commitmentData.commitment ?? null)');
  });

  it('renders ordered, billed and outstanding values supplied by the commitment read model', () => {
    expect(source).toContain('formatMoneyCents(commitment.orderedTotalCents, commitment.currency)');
    expect(source).toContain('formatMoneyCents(commitment.billedTotalCents, commitment.currency)');
    expect(source).toContain('formatMoneyCents(commitment.outstandingTotalCents, commitment.currency)');
  });

  it('surfaces unresolved period attribution and effective cost-centre lineage without inventing mappings', () => {
    expect(source).toContain('commitment.periodResolution.replaceAll');
    expect(source).toContain("line.effectiveCostCentreId ?? 'Unassigned'");
    expect(source).not.toMatch(/financialModel|financial_models|forecast_params|line_items/);
  });

  it('keeps receipt and match facts outside the C7.6C commitment card', () => {
    const start = source.indexOf('Phase C7.6C — governed PO-local commitment surface');
    const end = source.indexOf('Phase C7.5B/C7.5C — one derived reconciliation view', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const commitmentBlock = source.slice(start, end);
    expect(commitmentBlock).not.toMatch(/purchaseReceipt|matchWorkspace|matchedQuantity/);
    expect(commitmentBlock).toContain('commitment.outstandingTotalCents');
  });
});
