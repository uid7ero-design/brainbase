import 'server-only';
import sql from '@/lib/db';
/** Deployment preflight only; acceptance must separately rehearse PR #462's exact capacity guard. */
export async function coachingCapacityReady(): Promise<boolean> {
  const [row] = await sql`SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_proc p ON p.oid=t.tgfoid
    WHERE t.tgrelid='public.bookings'::regclass AND t.tgname='bookings_capacity_guard'
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A') AND t.tgtype=7
      AND p.proname='booking_capacity_guard' AND p.pronamespace='public'::regnamespace
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%pg_advisory_xact_lock%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%BKCAP%'
      AND pg_catalog.pg_get_functiondef(p.oid) LIKE '%BKISO%'
  ) AS ready`;
  return row?.ready === true;
}
