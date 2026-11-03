// Recognises the error raised by the database-side booking capacity guard
// (scripts/add-booking-capacity-guard.sql). The guard raises SQLSTATE 'BKCAP' when an
// INSERT into bookings would push a session instance over its max_capacity. The Neon
// serverless driver surfaces the SQLSTATE as `error.code`.
//
// Until the migration is applied the error never occurs, so every caller that maps it to
// its existing "full" response behaves exactly as before.

export const BOOKING_CAPACITY_SQLSTATE = 'BKCAP'

export function isBookingCapacityError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === BOOKING_CAPACITY_SQLSTATE
}
