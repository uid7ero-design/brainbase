// Phase C5.3B-fix — canonical payment method constants/types, split out
// of lib/commercial/payments.ts so Client Components (e.g.
// app/commercial/invoices/[id]/page.tsx) can import the runtime value
// PAYMENT_METHODS without pulling in lib/commercial/payments.ts's
// server-only `import sql from '@/lib/db'`, which crashed the Production
// invoice-detail route (neon() has no DATABASE_URL in the browser).
//
// This module must never import lib/db, any other server-only module,
// or anything with a Node-only runtime dependency.

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = typeof PAYMENT_METHODS[number];
