// Shared ticketing core — this module now lives in packages/ticketing
// (packages/ticketing/src/orderGrouping.ts) so the standalone ticketing product and
// BrainBase derive it from ONE source. This file is a stable re-export so
// every existing BrainBase import path keeps working unchanged. Add new
// behaviour in the package, never here.
export * from '@ticketing/core/orderGrouping';
