// @ticketing/core — the shared ticketing domain primitives.
//
// Rules for this package (enforced by packages/ticketing/tests/boundary.test.ts):
//   - pure TypeScript only: no 'server-only', no Next.js, no React, no DB
//     client, no Stripe, no Resend, no process.env, no application shell;
//   - no import from any application (BrainBase lib/, app/, components/
//     or the standalone product's app);
//   - no product name inside domain code — identity comes in through
//     productConfig.
//
// Risky, stateful code (SQL reservation gates, order state transitions,
// Stripe/Resend integration, auth) deliberately stays in the application
// that owns the database connection; see docs/architecture/decisions/
// 0007-monorepo-boundary-standalone-ticketing.md.

export * from './domain';
export * from './productConfig';
export * from './feeCalculation';
export * from './ticketValidity';
export * from './saleWindow';
export * from './orderGrouping';
export * from './receipt';
export * from './ticketEmailEligibility';
export * from './validation';
export * from './artworkConstants';
export * from './sessionPolicy';
export * from './paymentsView';
export * from './legalVersions';
