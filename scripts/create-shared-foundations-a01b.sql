-- BrainBase A0.1B — Shared Platform Identity Foundations
-- =========================================================
--
-- Creates:
--   1. external_organisations
--   2. external_organisation_roles
--   3. assets
--   4. locations
--
-- PLATFORM tables only. No assurance_* workflow tables are created here.
--
-- Additive-only:
--   * CREATE TABLE IF NOT EXISTS
--   * CREATE INDEX IF NOT EXISTS
--   * read-only preflight/post-condition DO blocks
--   * read-only summary SELECTs
--
-- No ALTER of an existing table, no INSERT, UPDATE, DELETE, TRUNCATE or DROP.
--
-- Run order:
--   A0.1A must already be applied/proven. This migration checks the
--   organiser_items_organisation_id_id_key post-condition before creating
--   anything, even though A0.1B itself does not reference organiser_items.

-- =====================================================================
-- 0. PRE-FLIGHT — READ ONLY
-- =====================================================================

DO $$
DECLARE
  actual_def TEXT;
BEGIN
  IF to_regclass('public.organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1B preflight failed: public.organisations is missing';
  END IF;

  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'A0.1B preflight failed: public.users is missing';
  END IF;

  IF to_regclass('public.organiser_items') IS NULL THEN
    RAISE EXCEPTION 'A0.1B preflight failed: public.organiser_items is missing';
  END IF;

  IF to_regprocedure('gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'A0.1B preflight failed: gen_random_uuid() is unavailable';
  END IF;

  SELECT pg_get_constraintdef(oid)
    INTO actual_def
  FROM pg_constraint
  WHERE conrelid = 'public.organiser_items'::regclass
    AND conname = 'organiser_items_organisation_id_id_key'
    AND contype = 'u';

  IF actual_def IS NULL THEN
    RAISE EXCEPTION
      'A0.1B preflight failed: organiser_items_organisation_id_id_key is missing; apply/prove A0.1A first';
  END IF;

  IF actual_def IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION
      'A0.1B preflight failed: organiser_items_organisation_id_id_key is "%" but "UNIQUE (organisation_id, id)" was expected',
      actual_def;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'organisations'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'A0.1B preflight failed: organisations.id must be NOT NULL TEXT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'id'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'A0.1B preflight failed: users.id must be NOT NULL TEXT';
  END IF;
END $$;

-- =====================================================================
-- 1. external_organisations
-- =====================================================================

CREATE TABLE IF NOT EXISTS external_organisations (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL,
  reference            TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  legal_name           TEXT,
  business_identifier  TEXT,
  email                TEXT,
  phone                TEXT,
  website              TEXT,
  status               TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT external_organisations_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id),

  CONSTRAINT external_organisations_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id),

  CONSTRAINT external_organisations_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT external_organisations_org_reference_key
    UNIQUE (organisation_id, reference),

  CONSTRAINT external_organisations_reference_not_blank_check
    CHECK (btrim(reference) <> ''),

  CONSTRAINT external_organisations_name_not_blank_check
    CHECK (btrim(name) <> ''),

  CONSTRAINT external_organisations_legal_name_not_blank_check
    CHECK (legal_name IS NULL OR btrim(legal_name) <> ''),

  CONSTRAINT external_organisations_business_identifier_not_blank_check
    CHECK (business_identifier IS NULL OR btrim(business_identifier) <> ''),

  CONSTRAINT external_organisations_email_not_blank_check
    CHECK (email IS NULL OR btrim(email) <> ''),

  CONSTRAINT external_organisations_phone_not_blank_check
    CHECK (phone IS NULL OR btrim(phone) <> ''),

  CONSTRAINT external_organisations_website_not_blank_check
    CHECK (website IS NULL OR btrim(website) <> ''),

  CONSTRAINT external_organisations_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED'))
);

-- UNIQUE (organisation_id, reference) already supports org-prefix scans.
CREATE INDEX IF NOT EXISTS idx_external_organisations_org_status
  ON external_organisations (organisation_id, status);

CREATE INDEX IF NOT EXISTS idx_external_organisations_org_name
  ON external_organisations (organisation_id, name);

CREATE INDEX IF NOT EXISTS idx_external_organisations_org_business_identifier
  ON external_organisations (organisation_id, business_identifier)
  WHERE business_identifier IS NOT NULL;

-- =====================================================================
-- 2. external_organisation_roles
-- =====================================================================

CREATE TABLE IF NOT EXISTS external_organisation_roles (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id           TEXT        NOT NULL,
  external_organisation_id  UUID        NOT NULL,
  role                      TEXT        NOT NULL,
  active                    BOOLEAN     NOT NULL DEFAULT true,
  created_by                TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT external_organisation_roles_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id),

  CONSTRAINT external_organisation_roles_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id),

  CONSTRAINT external_organisation_roles_org_external_org_fkey
    FOREIGN KEY (organisation_id, external_organisation_id)
    REFERENCES external_organisations (organisation_id, id),

  CONSTRAINT external_organisation_roles_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT external_organisation_roles_org_external_org_role_key
    UNIQUE (organisation_id, external_organisation_id, role),

  CONSTRAINT external_organisation_roles_role_check
    CHECK (
      role IN (
        'CONTRACTOR',
        'SUBCONTRACTOR',
        'SUPPLIER',
        'SERVICE_PROVIDER',
        'CONSULTANT',
        'CUSTOMER',
        'PARTNER',
        'INSURER',
        'OTHER'
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_external_organisation_roles_org_role_active
  ON external_organisation_roles (organisation_id, role, active);

-- =====================================================================
-- 3. assets
-- =====================================================================

CREATE TABLE IF NOT EXISTS assets (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL,
  asset_reference      TEXT        NOT NULL,
  asset_type           TEXT        NOT NULL,
  name                 TEXT        NOT NULL,
  description          TEXT,
  external_identifier  TEXT,
  status               TEXT        NOT NULL DEFAULT 'ACTIVE',
  created_by           TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT assets_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id),

  CONSTRAINT assets_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id),

  CONSTRAINT assets_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT assets_org_reference_key
    UNIQUE (organisation_id, asset_reference),

  CONSTRAINT assets_reference_not_blank_check
    CHECK (btrim(asset_reference) <> ''),

  CONSTRAINT assets_name_not_blank_check
    CHECK (btrim(name) <> ''),

  CONSTRAINT assets_external_identifier_not_blank_check
    CHECK (external_identifier IS NULL OR btrim(external_identifier) <> ''),

  CONSTRAINT assets_type_check
    CHECK (
      asset_type IN (
        'VEHICLE',
        'PLANT',
        'EQUIPMENT',
        'FACILITY',
        'BUILDING',
        'INFRASTRUCTURE',
        'DEVICE',
        'OTHER'
      )
    ),

  CONSTRAINT assets_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'RETIRED', 'ARCHIVED'))
);

CREATE INDEX IF NOT EXISTS idx_assets_org_type_status
  ON assets (organisation_id, asset_type, status);

CREATE INDEX IF NOT EXISTS idx_assets_org_name
  ON assets (organisation_id, name);

CREATE INDEX IF NOT EXISTS idx_assets_org_external_identifier
  ON assets (organisation_id, external_identifier)
  WHERE external_identifier IS NOT NULL;

-- =====================================================================
-- 4. locations
-- =====================================================================

CREATE TABLE IF NOT EXISTS locations (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     TEXT         NOT NULL,
  location_reference  TEXT         NOT NULL,
  location_type       TEXT         NOT NULL,
  name                TEXT         NOT NULL,
  description         TEXT,
  address_line_1      TEXT,
  address_line_2      TEXT,
  suburb              TEXT,
  state               TEXT,
  postcode            TEXT,
  country_code        TEXT,
  latitude            NUMERIC(9,6),
  longitude           NUMERIC(9,6),
  status              TEXT         NOT NULL DEFAULT 'ACTIVE',
  created_by          TEXT,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),

  CONSTRAINT locations_organisation_id_fkey
    FOREIGN KEY (organisation_id)
    REFERENCES organisations(id),

  CONSTRAINT locations_created_by_fkey
    FOREIGN KEY (created_by)
    REFERENCES users(id),

  CONSTRAINT locations_organisation_id_id_key
    UNIQUE (organisation_id, id),

  CONSTRAINT locations_org_reference_key
    UNIQUE (organisation_id, location_reference),

  CONSTRAINT locations_reference_not_blank_check
    CHECK (btrim(location_reference) <> ''),

  CONSTRAINT locations_name_not_blank_check
    CHECK (btrim(name) <> ''),

  CONSTRAINT locations_type_check
    CHECK (
      location_type IN (
        'SITE',
        'DEPOT',
        'FACILITY',
        'OFFICE',
        'PROPERTY',
        'WORK_AREA',
        'ROAD',
        'PROJECT_SITE',
        'OTHER'
      )
    ),

  CONSTRAINT locations_status_check
    CHECK (status IN ('ACTIVE', 'INACTIVE', 'ARCHIVED')),

  CONSTRAINT locations_latitude_check
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),

  CONSTRAINT locations_longitude_check
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

  CONSTRAINT locations_coordinate_pair_check
    CHECK (
      (latitude IS NULL AND longitude IS NULL)
      OR
      (latitude IS NOT NULL AND longitude IS NOT NULL)
    ),

  CONSTRAINT locations_country_code_check
    CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),

  CONSTRAINT locations_address_line_1_not_blank_check
    CHECK (address_line_1 IS NULL OR btrim(address_line_1) <> ''),

  CONSTRAINT locations_address_line_2_not_blank_check
    CHECK (address_line_2 IS NULL OR btrim(address_line_2) <> ''),

  CONSTRAINT locations_suburb_not_blank_check
    CHECK (suburb IS NULL OR btrim(suburb) <> ''),

  CONSTRAINT locations_state_not_blank_check
    CHECK (state IS NULL OR btrim(state) <> ''),

  CONSTRAINT locations_postcode_not_blank_check
    CHECK (postcode IS NULL OR btrim(postcode) <> '')
);

CREATE INDEX IF NOT EXISTS idx_locations_org_type_status
  ON locations (organisation_id, location_type, status);

CREATE INDEX IF NOT EXISTS idx_locations_org_name
  ON locations (organisation_id, name);

CREATE INDEX IF NOT EXISTS idx_locations_org_suburb
  ON locations (organisation_id, suburb)
  WHERE suburb IS NOT NULL;

-- =====================================================================
-- 5. FAIL-LOUD POST-CONDITIONS
-- =====================================================================
--
-- CREATE TABLE IF NOT EXISTS can silently accept a pre-existing table with a
-- wrong shape. These checks make the migration idempotent but not
-- drift-tolerant.

DO $$
DECLARE
  actual TEXT;
  expected TEXT;
BEGIN
  -- Table existence.
  IF to_regclass('public.external_organisations') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: external_organisations is missing';
  END IF;

  IF to_regclass('public.external_organisation_roles') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: external_organisation_roles is missing';
  END IF;

  IF to_regclass('public.assets') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: assets is missing';
  END IF;

  IF to_regclass('public.locations') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: locations is missing';
  END IF;

  -- Exact column shapes.
  SELECT string_agg(
    column_name || ':' || data_type || ':' || is_nullable || ':' ||
    coalesce(column_default, '-'),
    ',' ORDER BY ordinal_position
  )
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'external_organisations';

  expected :=
    'id:uuid:NO:gen_random_uuid(),' ||
    'organisation_id:text:NO:-,' ||
    'reference:text:NO:-,' ||
    'name:text:NO:-,' ||
    'legal_name:text:YES:-,' ||
    'business_identifier:text:YES:-,' ||
    'email:text:YES:-,' ||
    'phone:text:YES:-,' ||
    'website:text:YES:-,' ||
    'status:text:NO:''ACTIVE''::text,' ||
    'created_by:text:YES:-,' ||
    'created_at:timestamp with time zone:NO:now(),' ||
    'updated_at:timestamp with time zone:NO:now()';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisations column shape is "%", expected "%"',
      actual, expected;
  END IF;

  SELECT string_agg(
    column_name || ':' || data_type || ':' || is_nullable || ':' ||
    coalesce(column_default, '-'),
    ',' ORDER BY ordinal_position
  )
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'external_organisation_roles';

  expected :=
    'id:uuid:NO:gen_random_uuid(),' ||
    'organisation_id:text:NO:-,' ||
    'external_organisation_id:uuid:NO:-,' ||
    'role:text:NO:-,' ||
    'active:boolean:NO:true,' ||
    'created_by:text:YES:-,' ||
    'created_at:timestamp with time zone:NO:now(),' ||
    'updated_at:timestamp with time zone:NO:now()';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisation_roles column shape is "%", expected "%"',
      actual, expected;
  END IF;

  SELECT string_agg(
    column_name || ':' || data_type || ':' || is_nullable || ':' ||
    coalesce(column_default, '-'),
    ',' ORDER BY ordinal_position
  )
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'assets';

  expected :=
    'id:uuid:NO:gen_random_uuid(),' ||
    'organisation_id:text:NO:-,' ||
    'asset_reference:text:NO:-,' ||
    'asset_type:text:NO:-,' ||
    'name:text:NO:-,' ||
    'description:text:YES:-,' ||
    'external_identifier:text:YES:-,' ||
    'status:text:NO:''ACTIVE''::text,' ||
    'created_by:text:YES:-,' ||
    'created_at:timestamp with time zone:NO:now(),' ||
    'updated_at:timestamp with time zone:NO:now()';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'A0.1B schema drift: assets column shape is "%", expected "%"',
      actual, expected;
  END IF;

  SELECT string_agg(
    column_name || ':' || data_type || ':' || is_nullable || ':' ||
    coalesce(column_default, '-'),
    ',' ORDER BY ordinal_position
  )
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'locations';

  expected :=
    'id:uuid:NO:gen_random_uuid(),' ||
    'organisation_id:text:NO:-,' ||
    'location_reference:text:NO:-,' ||
    'location_type:text:NO:-,' ||
    'name:text:NO:-,' ||
    'description:text:YES:-,' ||
    'address_line_1:text:YES:-,' ||
    'address_line_2:text:YES:-,' ||
    'suburb:text:YES:-,' ||
    'state:text:YES:-,' ||
    'postcode:text:YES:-,' ||
    'country_code:text:YES:-,' ||
    'latitude:numeric:YES:-,' ||
    'longitude:numeric:YES:-,' ||
    'status:text:NO:''ACTIVE''::text,' ||
    'created_by:text:YES:-,' ||
    'created_at:timestamp with time zone:NO:now(),' ||
    'updated_at:timestamp with time zone:NO:now()';

  IF actual IS DISTINCT FROM expected THEN
    RAISE EXCEPTION
      'A0.1B schema drift: locations column shape is "%", expected "%"',
      actual, expected;
  END IF;

  -- Precision / scale.
  SELECT numeric_precision::text || ',' || numeric_scale::text
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'locations'
    AND column_name = 'latitude';

  IF actual IS DISTINCT FROM '9,6' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: locations.latitude precision/scale is "%", expected "9,6"',
      actual;
  END IF;

  SELECT numeric_precision::text || ',' || numeric_scale::text
  INTO actual
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'locations'
    AND column_name = 'longitude';

  IF actual IS DISTINCT FROM '9,6' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: locations.longitude precision/scale is "%", expected "9,6"',
      actual;
  END IF;

  -- Exact important FK / UNIQUE definitions.
  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisations'::regclass
    AND conname = 'external_organisations_organisation_id_fkey';

  IF actual IS DISTINCT FROM 'FOREIGN KEY (organisation_id) REFERENCES organisations(id)' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisations_organisation_id_fkey is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisations'::regclass
    AND conname = 'external_organisations_created_by_fkey';

  IF actual IS DISTINCT FROM 'FOREIGN KEY (created_by) REFERENCES users(id)' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisations_created_by_fkey is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisations'::regclass
    AND conname = 'external_organisations_organisation_id_id_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisations tenant anchor is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisations'::regclass
    AND conname = 'external_organisations_org_reference_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, reference)' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisations reference key is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisation_roles'::regclass
    AND conname = 'external_organisation_roles_org_external_org_fkey';

  IF actual IS DISTINCT FROM
    'FOREIGN KEY (organisation_id, external_organisation_id) REFERENCES external_organisations(organisation_id, id)'
  THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisation_roles tenant FK is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisation_roles'::regclass
    AND conname = 'external_organisation_roles_organisation_id_id_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisation_roles tenant anchor is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'external_organisation_roles'::regclass
    AND conname = 'external_organisation_roles_org_external_org_role_key';

  IF actual IS DISTINCT FROM
    'UNIQUE (organisation_id, external_organisation_id, role)'
  THEN
    RAISE EXCEPTION
      'A0.1B schema drift: external_organisation_roles role key is "%"',
      actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'assets'::regclass
    AND conname = 'assets_organisation_id_id_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1B schema drift: assets tenant anchor is "%"', actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'assets'::regclass
    AND conname = 'assets_org_reference_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, asset_reference)' THEN
    RAISE EXCEPTION 'A0.1B schema drift: assets reference key is "%"', actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'locations'::regclass
    AND conname = 'locations_organisation_id_id_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, id)' THEN
    RAISE EXCEPTION 'A0.1B schema drift: locations tenant anchor is "%"', actual;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO actual
  FROM pg_constraint
  WHERE conrelid = 'locations'::regclass
    AND conname = 'locations_org_reference_key';

  IF actual IS DISTINCT FROM 'UNIQUE (organisation_id, location_reference)' THEN
    RAISE EXCEPTION 'A0.1B schema drift: locations reference key is "%"', actual;
  END IF;

  -- Every named CHECK must exist with contype='c'.
  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'external_organisations'::regclass
      AND contype = 'c'
      AND conname IN (
        'external_organisations_reference_not_blank_check',
        'external_organisations_name_not_blank_check',
        'external_organisations_legal_name_not_blank_check',
        'external_organisations_business_identifier_not_blank_check',
        'external_organisations_email_not_blank_check',
        'external_organisations_phone_not_blank_check',
        'external_organisations_website_not_blank_check',
        'external_organisations_status_check'
      )
  ) <> 8 THEN
    RAISE EXCEPTION
      'A0.1B post-condition failed: external_organisations CHECK set is incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'external_organisation_roles'::regclass
      AND contype = 'c'
      AND conname = 'external_organisation_roles_role_check'
  ) <> 1 THEN
    RAISE EXCEPTION
      'A0.1B post-condition failed: external_organisation_roles_role_check is missing';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'assets'::regclass
      AND contype = 'c'
      AND conname IN (
        'assets_reference_not_blank_check',
        'assets_name_not_blank_check',
        'assets_external_identifier_not_blank_check',
        'assets_type_check',
        'assets_status_check'
      )
  ) <> 5 THEN
    RAISE EXCEPTION
      'A0.1B post-condition failed: assets CHECK set is incomplete';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_constraint
    WHERE conrelid = 'locations'::regclass
      AND contype = 'c'
      AND conname IN (
        'locations_reference_not_blank_check',
        'locations_name_not_blank_check',
        'locations_type_check',
        'locations_status_check',
        'locations_latitude_check',
        'locations_longitude_check',
        'locations_coordinate_pair_check',
        'locations_country_code_check',
        'locations_address_line_1_not_blank_check',
        'locations_address_line_2_not_blank_check',
        'locations_suburb_not_blank_check',
        'locations_state_not_blank_check',
        'locations_postcode_not_blank_check'
      )
  ) <> 13 THEN
    RAISE EXCEPTION
      'A0.1B post-condition failed: locations CHECK set is incomplete';
  END IF;

  -- Required index existence. Key/predicate behavior is proven by the
  -- disposable-Postgres verification harness in the next implementation slice.
  IF to_regclass('public.idx_external_organisations_org_status') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_external_organisations_org_status is missing';
  END IF;

  IF to_regclass('public.idx_external_organisations_org_name') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_external_organisations_org_name is missing';
  END IF;

  IF to_regclass('public.idx_external_organisations_org_business_identifier') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_external_organisations_org_business_identifier is missing';
  END IF;

  IF to_regclass('public.idx_external_organisation_roles_org_role_active') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_external_organisation_roles_org_role_active is missing';
  END IF;

  IF to_regclass('public.idx_assets_org_type_status') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_assets_org_type_status is missing';
  END IF;

  IF to_regclass('public.idx_assets_org_name') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_assets_org_name is missing';
  END IF;

  IF to_regclass('public.idx_assets_org_external_identifier') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_assets_org_external_identifier is missing';
  END IF;

  IF to_regclass('public.idx_locations_org_type_status') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_locations_org_type_status is missing';
  END IF;

  IF to_regclass('public.idx_locations_org_name') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_locations_org_name is missing';
  END IF;

  IF to_regclass('public.idx_locations_org_suburb') IS NULL THEN
    RAISE EXCEPTION 'A0.1B post-condition failed: idx_locations_org_suburb is missing';
  END IF;
END $$;

-- =====================================================================
-- 6. POST-MIGRATION READ-ONLY SUMMARY
-- =====================================================================

SELECT
  'external_organisations' AS table_name,
  count(*) AS row_count
FROM external_organisations
UNION ALL
SELECT 'external_organisation_roles', count(*)
FROM external_organisation_roles
UNION ALL
SELECT 'assets', count(*)
FROM assets
UNION ALL
SELECT 'locations', count(*)
FROM locations
ORDER BY table_name;

SELECT
  c.conrelid::regclass::text AS table_name,
  c.conname,
  pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid IN (
  'external_organisations'::regclass,
  'external_organisation_roles'::regclass,
  'assets'::regclass,
  'locations'::regclass
)
ORDER BY table_name, c.conname;

SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN (
    'external_organisations',
    'external_organisation_roles',
    'assets',
    'locations'
  )
ORDER BY tablename, indexname;
