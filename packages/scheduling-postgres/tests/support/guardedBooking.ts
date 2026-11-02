// TEST FIXTURE ONLY. The guarded booking statement of docs/architecture/scheduling-phase2c-availability-at-commit.md (option C), as the 2C.3 repository will have to write it.
// It is NOT application code, no route calls it, and nothing in app/, lib/ or packages/*/src imports this file (a containment test pins that).
//
// ONE statement, because one statement is the only atomic unit the Neon HTTP driver offers: take FOR SHARE on the offering's version row, the offering, the resource's version row
// and the resource (offering first, then resource: the order every version bump uses), require the versions the application read, then insert the reservation and its hold.
// A stale version, an inactive resource, an archived offering or a wrong organisation makes a CTE empty and the statement inserts nothing (zero rows, no error).
// An idempotency key that already exists inserts nothing either (zero rows): the caller then reads the existing reservation by key.
//
// $1 organisation, $2 offering, $3 offering version, $4 resource, $5 resource version, $6 reservation id, $7 hold id, $8 schedule, $9 starts, $10 ends, $11 idempotency key.
export const GUARDED_BOOKING_SQL = `
  WITH lov AS (
    SELECT 1 FROM scheduling_availability_versions v
     WHERE v.organisation_id = $1 AND v.owner_kind = 'offering' AND v.owner_id = $2 AND v.version = $3::bigint
       FOR SHARE OF v
  ), lo AS (
    SELECT o.id, o.organisation_id, o.schedule_id FROM scheduling_offerings o, lov
     WHERE o.organisation_id = $1 AND o.id = $2 AND o.archived_at IS NULL
       FOR SHARE OF o
  ), lrv AS (
    SELECT 1 FROM scheduling_availability_versions v, lo
     WHERE v.organisation_id = $1 AND v.owner_kind = 'resource' AND v.owner_id = $4 AND v.version = $5::bigint
       FOR SHARE OF v
  ), lr AS (
    SELECT r.id FROM scheduling_resources r, lrv
     WHERE r.organisation_id = $1 AND r.id = $4 AND r.active
       FOR SHARE OF r
  ), res AS (
    INSERT INTO scheduling_reservations (id, organisation_id, schedule_id, preset_key, preset_version, offering_id, span_kind, occurrence_id, resource_id, series_id, customer_id,
      customer_name, customer_email, customer_email_normalised, customer_phone, contact_link, timezone, local_start_date, local_start_time, local_end_date, local_end_time,
      starts_at, ends_at, party_size, price_cents, currency, notes, idempotency_key, created_by)
    SELECT $6, lo.organisation_id, lo.schedule_id, 'resource_hire', 1, lo.id, 'slot', NULL, lr.id, NULL, NULL,
           'Hirer', NULL, NULL, NULL, 'none', 'Australia/Adelaide',
           ($9::timestamptz AT TIME ZONE 'Australia/Adelaide')::date, ($9::timestamptz AT TIME ZONE 'Australia/Adelaide')::time,
           ($10::timestamptz AT TIME ZONE 'Australia/Adelaide')::date, ($10::timestamptz AT TIME ZONE 'Australia/Adelaide')::time,
           $9::timestamptz, $10::timestamptz, 1, 0, 'AUD', NULL, $11::text, 'staff:test'
      FROM lo, lr WHERE $8::text = lo.schedule_id
    ON CONFLICT (organisation_id, idempotency_key) DO NOTHING
    RETURNING id, organisation_id, resource_id, starts_at, ends_at
  ), hold AS (
    INSERT INTO scheduling_resource_holds (id, organisation_id, resource_id, during, reservation_id)
    SELECT $7, organisation_id, resource_id, tstzrange(starts_at, ends_at, '[)'), id FROM res
    RETURNING id
  )
  SELECT id FROM res`;

/** The same statement with a pause inside it after the locks and the insert, to hold the version rows share-locked while another request arrives. */
export const SLOW_GUARDED_BOOKING_SQL = (seconds: number) => GUARDED_BOOKING_SQL.replace('SELECT id FROM res', `SELECT id, pg_sleep(${seconds}) FROM res`);

/** A writer that bumps an owner's version and then holds the row (and its transaction) for `seconds`: a configuration write still committing, as a single statement. */
export const SLOW_BUMP_SQL = (seconds: number) =>
  `WITH bump AS (UPDATE scheduling_availability_versions SET version = version + 1 WHERE organisation_id = $1 AND owner_kind = $2 AND owner_id = $3 RETURNING 1) SELECT pg_sleep(${seconds}) FROM bump`;
