-- LD Tennis booking capacity guard.
--
-- Run once against the production database AFTER the application code that maps the
-- BKCAP error to the existing "full" responses is deployed (see docs/architecture/
-- ld-tennis-booking-capacity-guard.md for the order, verification and rollback). Safe to
-- re-run: CREATE OR REPLACE FUNCTION plus DROP TRIGGER IF EXISTS / CREATE TRIGGER.
-- Additive: changes no column, no data, no existing constraint or index.
--
-- WHY: every path that adds a booking to a session instance reads the live count, compares
-- it with session_instances.max_capacity and then INSERTs as separate statements with no
-- lock, so concurrent requests for the last place can all succeed (reproduced against real
-- Postgres by scripts/tests/verify-booking-capacity-concurrency.sh). A trigger is the one
-- place every writer passes through (public booking, staff enrolment by name, staff
-- enrolment from a contact, the super_admin booking route and recurring propagation), and it
-- needs no interactive transaction, so it works over the Neon HTTP driver the app uses.
--
-- HOW: a BEFORE INSERT trigger takes a transaction-scoped advisory lock keyed on the
-- instance id, then counts live bookings and refuses the insert when the instance is full.
-- Concurrent inserts for the SAME instance queue on the lock; inserts for different
-- instances do not contend. Each statement inside a PL/pgSQL function takes a fresh
-- snapshot under READ COMMITTED (the default), so after acquiring the lock the count sees
-- every row committed by the previous holder. An advisory lock is used deliberately instead
-- of SELECT ... FOR UPDATE on session_instances: it cannot interact with the row locks that
-- reconcile/archive take on session_instances and bookings, so it cannot introduce a
-- deadlock cycle with them.
--
-- SEMANTICS (identical to the checks the routes already make):
--   * a booking counts when status != 'cancelled' (same predicate as every route's count);
--   * only rows with a session_instance_id are limited (legacy one-off appointments have none);
--   * a row inserted already cancelled is never refused (history/backfill stays possible);
--   * capacity is session_instances.max_capacity at insert time; lowering it later never
--     removes existing bookings, it only blocks new ones;
--   * UPDATEs are not guarded: no code path un-cancels a booking or moves it to another
--     instance (verified by search), so inserts are the only way the count grows.
-- The error carries SQLSTATE 'BKCAP' (lib/bookingCapacity.ts maps it to the existing 409s).
--
-- ISOLATION: correctness relies on READ COMMITTED (the default, and what every booking path uses:
-- plain autocommit statements, or sql.transaction with ReadCommitted). Under REPEATABLE READ the
-- transaction keeps its first snapshot, so the count taken after the lock wait could be stale and
-- admit an extra booking. The guard therefore REFUSES to run in a REPEATABLE READ transaction
-- (SQLSTATE 'BKISO') instead of silently weakening the guarantee. SERIALIZABLE is not used by any
-- booking path and is not covered by the tests.
--
-- LOCKING: the advisory lock is the only lock the guard takes. It never takes a row lock on
-- session_instances or bookings, and no booking-writing transaction in the application also
-- updates instances or bookings, so the guard cannot take part in a lock-ordering cycle. The key is
-- hashtextextended('booking_capacity:' || instance_id, 0): a 64-bit hash with a prefix no other
-- advisory lock in the application uses; a (vanishingly unlikely) collision between two instances
-- would only make their inserts queue behind each other, never admit a wrong booking.
-- A manual SQL session that INSERTs a booking and then idles in an open transaction holds the lock
-- for that instance until it ends; booking inserts for that one instance would wait. All
-- application paths are single statements.
--
-- PRE-CHECK (read-only; lists instances ALREADY over capacity. The guard does not touch
-- them, it only blocks further inserts into them):
--   SELECT si.id, si.date, si.max_capacity,
--          COUNT(b.*) FILTER (WHERE b.status != 'cancelled') AS live
--   FROM session_instances si JOIN bookings b ON b.session_instance_id = si.id
--   GROUP BY si.id, si.date, si.max_capacity
--   HAVING COUNT(b.*) FILTER (WHERE b.status != 'cancelled') > si.max_capacity;
--
-- VERIFY after applying (expect one row, tgenabled = 'O'):
--   SELECT tgname, tgenabled FROM pg_trigger
--   WHERE tgrelid = 'public.bookings'::regclass AND tgname = 'bookings_capacity_guard';
--
-- ROLLBACK (instant, no data change; removes the guard and nothing else):
--   DROP TRIGGER IF EXISTS bookings_capacity_guard ON public.bookings;
--   DROP FUNCTION IF EXISTS public.booking_capacity_guard();

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION public.booking_capacity_guard() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  instance_capacity integer;
  live_count integer;
BEGIN
  IF NEW.session_instance_id IS NULL OR NEW.status IS NOT DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;

  IF current_setting('transaction_isolation') = 'repeatable read' THEN
    RAISE EXCEPTION 'booking_capacity_guard requires READ COMMITTED'
      USING ERRCODE = 'BKISO';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('booking_capacity:' || NEW.session_instance_id, 0));

  SELECT max_capacity INTO instance_capacity
  FROM session_instances
  WHERE id = NEW.session_instance_id;

  IF NOT FOUND THEN
    RETURN NEW; -- unknown instance: leave to the existing foreign key / route checks
  END IF;

  SELECT COUNT(*) INTO live_count
  FROM bookings
  WHERE session_instance_id = NEW.session_instance_id
    AND status != 'cancelled';

  IF live_count >= instance_capacity THEN
    RAISE EXCEPTION 'session_instance_full'
      USING ERRCODE = 'BKCAP',
            DETAIL = format('instance %s holds %s of %s places', NEW.session_instance_id, live_count, instance_capacity);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bookings_capacity_guard ON public.bookings;

CREATE TRIGGER bookings_capacity_guard
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.booking_capacity_guard();
