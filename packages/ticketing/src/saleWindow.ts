// Phase 4 — per-ticket-type sale windows. Pure, dependency-free (no
// 'server-only', no DB) so the public page, the organiser page and the
// server all derive a ticket type's on-sale state from ONE rule:
//
//   on sale  iff  (sale_starts_at IS NULL OR now >= sale_starts_at)
//             AND (sale_ends_at   IS NULL OR now <  sale_ends_at)
//
// Half-open: the start instant is on sale, the end instant is not. The
// SERVER is the authority — lib/events/services/cart.ts re-evaluates this
// on every submit with the database's NOW(), and the reservation gate
// re-asserts it inside the locked statement — so a buyer keeping a page
// open across a boundary gets a 409 at submit, never a sale. What the
// clients compute here is display state only.
//
// Display vocabulary (brief §3): COMING_SOON | ON_SALE | SOLD_OUT |
// SALES_ENDED | ACCESS_REQUIRED. SOLD_OUT and ACCESS_REQUIRED are
// refinements of ON_SALE (a type outside its window is never "sold out",
// it is simply not on sale yet / any more).

export type SaleWindowFields = {
  sale_starts_at: string | Date | null;
  sale_ends_at: string | Date | null;
};

export type SaleStatus = 'COMING_SOON' | 'ON_SALE' | 'SOLD_OUT' | 'SALES_ENDED' | 'ACCESS_REQUIRED';

function toMillis(value: string | Date | null): number | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function isWithinSaleWindow(fields: SaleWindowFields, now: Date = new Date()): boolean {
  const t = now.getTime();
  const starts = toMillis(fields.sale_starts_at);
  const ends = toMillis(fields.sale_ends_at);
  if (starts !== null && t < starts) return false;
  if (ends !== null && t >= ends) return false;
  return true;
}

export function saleWindowPhase(fields: SaleWindowFields, now: Date = new Date()): 'COMING_SOON' | 'ON_SALE' | 'SALES_ENDED' {
  const t = now.getTime();
  const starts = toMillis(fields.sale_starts_at);
  const ends = toMillis(fields.sale_ends_at);
  if (starts !== null && t < starts) return 'COMING_SOON';
  if (ends !== null && t >= ends) return 'SALES_ENDED';
  return 'ON_SALE';
}

// Full display status for one ticket type. `unlocked` is whether the
// visitor has already supplied an access code that unlocks this type.
export function computeSaleStatus(
  fields: SaleWindowFields & { requires_access_code: boolean; remaining: number },
  options: { now?: Date; unlocked?: boolean } = {},
): SaleStatus {
  const phase = saleWindowPhase(fields, options.now ?? new Date());
  if (phase !== 'ON_SALE') return phase;
  if (fields.requires_access_code && !options.unlocked) return 'ACCESS_REQUIRED';
  if (fields.remaining <= 0) return 'SOLD_OUT';
  return 'ON_SALE';
}

export const SALE_STATUS_LABELS: Readonly<Record<SaleStatus, string>> = Object.freeze({
  COMING_SOON: 'Coming soon',
  ON_SALE: 'On sale',
  SOLD_OUT: 'Sold out',
  SALES_ENDED: 'Sales ended',
  ACCESS_REQUIRED: 'Access code required',
});
