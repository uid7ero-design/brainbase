-- Scheduling Phase 2B.0 — BrainBase CRM link (version 2b.0-crm-link)
--
-- STATUS: NOT APPLIED ANYWHERE. Manual Neon SQL Editor handoff, Preview first, backup branch first, separate
-- approval for Production. Run only AFTER packages/scheduling/sql/010_shared_schema.sql.
--
-- WHAT: ONE function, brainbase_scheduling_find_or_create_contact(...), that links a scheduling reservation to a
--   CRM contact (public.crm_contacts). It is a HOST function: the shared scheduling DDL never references crm_contacts
--   (reservations hold customer_id as plain TEXT). The name deliberately does not start with "scheduling_" so the
--   shared inventory checks in 020_verify.sql and the per-kind fingerprints (which count scheduling_* objects) are
--   unaffected.
--
-- CONTRACT
--   Input   organisation (the authenticated session's organisation, never a request value), an email, STRUCTURED
--           first and last names, optionally a phone number and the creating user's id.
--   Output  one row: contact_id (uuid) and outcome ('matched' or 'created').
--
-- MATCHING: by organisation AND normalised email only, where normalised = lower(btrim(email)), the same rule as the
--   Events CRM sync (lib/crm/eventSync.ts normalizeEmail). A NAME IS NEVER USED TO MATCH. If several contacts already
--   share the email (the CRM has no unique index and other writers can duplicate), the OLDEST is returned, so the
--   answer is stable; nothing is merged, edited or deleted.
--   A matched contact is returned EXACTLY AS IT IS: its names, phone and classification are not touched.
--
-- CREATION happens only when no contact matches, and then:
--   * first_name and last_name must be non-blank after trimming, or the function RAISES (SQLSTATE SCCNM) and creates
--     nothing. It never defaults, derives, splits or substitutes a value: there is no placeholder anywhere in this
--     file. A caller with only a display name must not call this function; it saves the booking unlinked.
--   * classification is 'LEAD'. created_by is the supplied user id (or NULL). notes stay empty. Nothing else is written.
--   * an email is REQUIRED (SQLSTATE SCCEM): without one there is no stable identity to match on, so each call would
--     create another duplicate. Email-less customers are saved unlinked.
--
-- CONCURRENCY: takes pg_advisory_xact_lock(hashtext(organisation), hashtext('email:' || normalised email)), the SAME
--   key the Events CRM sync uses, so a scheduling booking and an Events purchase for the same person in the same
--   organisation also serialise against each other. The match is a separate statement after the lock (a new READ
--   COMMITTED snapshot), so a waiter sees the winner's committed row and reuses it. Under REPEATABLE READ or
--   SERIALIZABLE the snapshot would predate the lock, so the function refuses (SQLSTATE SCISO, as the 2A guards do).
--   The lock is held to the end of the calling transaction: a single statement over the Neon HTTP driver is its own
--   transaction. Function-level lock_timeout of 5 s; a waiter that exceeds it fails with 55P03 (retryable).
--   Writers that bypass this function (the CRM API, an import) are not serialised: crm_contacts is not altered here.
--
-- ERRORS (custom SQLSTATE, mapped by lib/scheduling/crmLink.ts)
--   SCCOR organisation missing    SCCEM email missing or malformed    SCCNM first or last name blank at creation
--   SCISO unsafe isolation level  23503 unknown organisation or user (raw foreign key violation)
--
-- ADDITIVE: creates one function and one marker row. No table, index or constraint is created or altered; no existing
--   row is read except crm_contacts for the match; no LD Tennis table (contacts) is referenced.
-- IDEMPOTENT: CREATE OR REPLACE FUNCTION; marker ON CONFLICT DO NOTHING.
-- ROLLBACK: scripts/scheduling/192_brainbase_crm_link_rollback.sql (contacts it created stay; they are ordinary CRM rows).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

DO $$
BEGIN
  IF to_regclass('public.crm_contacts') IS NULL THEN
    RAISE EXCEPTION 'crm_contacts does not exist';
  END IF;
  IF to_regclass('public.scheduling_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'run packages/scheduling/sql/010_shared_schema.sql first';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION brainbase_scheduling_find_or_create_contact(
  p_organisation_id text,
  p_email           text,
  p_first_name      text,
  p_last_name       text,
  p_phone           text DEFAULT NULL,
  p_created_by      text DEFAULT NULL
) RETURNS TABLE (contact_id uuid, outcome text)
LANGUAGE plpgsql SET lock_timeout = '5s' AS $$
DECLARE
  v_email text;
  v_first text;
  v_last  text;
  v_id    uuid;
BEGIN
  IF current_setting('transaction_isolation') IN ('repeatable read', 'serializable') THEN
    RAISE EXCEPTION 'brainbase_scheduling_find_or_create_contact requires READ COMMITTED' USING ERRCODE = 'SCISO';
  END IF;

  IF p_organisation_id IS NULL OR btrim(p_organisation_id) = '' THEN
    RAISE EXCEPTION 'organisation is required' USING ERRCODE = 'SCCOR';
  END IF;

  v_email := lower(btrim(p_email));
  IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' OR length(v_email) > 254 THEN
    RAISE EXCEPTION 'a valid email is required to find or create a contact' USING ERRCODE = 'SCCEM';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_organisation_id), hashtext('email:' || v_email));

  SELECT c.id INTO v_id
    FROM crm_contacts c
   WHERE c.organisation_id = p_organisation_id AND lower(btrim(c.email)) = v_email
   ORDER BY c.created_at ASC NULLS LAST, c.id ASC
   LIMIT 1;
  IF FOUND THEN
    RETURN QUERY SELECT v_id, 'matched'::text;
    RETURN;
  END IF;

  -- Trim ALL leading and trailing whitespace (tabs, newlines, no-break space), as the CRM API's JavaScript trim() does;
  -- btrim() alone strips only spaces, so a name of tabs would otherwise count as non-blank.
  v_first := regexp_replace(p_first_name, '^[[:space:]\u00a0]+|[[:space:]\u00a0]+$', '', 'g');
  v_last  := regexp_replace(p_last_name,  '^[[:space:]\u00a0]+|[[:space:]\u00a0]+$', '', 'g');
  IF v_first IS NULL OR v_first = '' OR v_last IS NULL OR v_last = '' THEN
    RAISE EXCEPTION 'first name and last name are both required to create a contact' USING ERRCODE = 'SCCNM';
  END IF;

  INSERT INTO crm_contacts (organisation_id, created_by, first_name, last_name, email, phone, classification)
  VALUES (p_organisation_id, p_created_by, v_first, v_last, btrim(p_email), NULLIF(btrim(p_phone), ''), 'LEAD')
  RETURNING id INTO v_id;

  RETURN QUERY SELECT v_id, 'created'::text;
END;
$$;

INSERT INTO scheduling_schema_migrations (version, description)
VALUES ('2b.0-crm-link', 'BrainBase host: find-or-create CRM contact by organisation and normalised email (LEAD, structured names only)')
ON CONFLICT (version) DO NOTHING;

COMMIT;
