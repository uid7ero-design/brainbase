import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const source = fs.readFileSync(
  path.resolve(__dirname, '../../app/commercial/purchasing/purchase-orders/[id]/page.tsx'),
  'utf-8',
);

describe('Phase C7.5D3 — explicit Purchase Receipt ↔ Supplier Bill matching UI', () => {
  it('loads the governed match workspace and sends create/reverse mutations through the PO-scoped routes', () => {
    expect(source).toMatch(/fetch\(\`\/api\/commercial\/purchase-orders\/\$\{id\}\/matches\`\)/);
    expect(source).toMatch(/purchaseReceiptLineId:\s*matchReceiptLineId/);
    expect(source).toMatch(/supplierBillLineId:\s*matchBillLineId/);
    expect(source).toMatch(/matches\/\$\{allocationId\}\/reverse/);
  });

  it('states that common PO-line lineage is not itself a match and renders explicit matched quantity', () => {
    expect(source).toContain('Only explicit allocations count as matched. Sharing the same PO line does not create a match.');
    expect(source).toContain('line.matchedQuantity');
    expect(source).toContain('lines explicitly matched');
  });

  it('keeps matching mutation affordances behind ISSUED + manager UX gating while history remains renderable', () => {
    expect(source).toMatch(/\{isIssued && canEdit && \(\s*<form onSubmit=\{createMatchAction\}/);
    expect(source).toMatch(/!a\.reversed_at && isIssued && canEdit/);
    expect(source).toMatch(/matchWorkspace\.allocations\.map/);
    expect(source).toContain("a.reversed_at ? 'REVERSED' : 'ACTIVE'");
  });
});
