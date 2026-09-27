-- HR-7D1 — Employee document schema foundation.
-- Schema only: no routes, storage writes, UI, seed data, or Production execution.
--
-- Final HR-7 design corrections applied here:
--   * A logical employee document is distinct from its immutable versions.
--   * Documents are never implicitly merged by document_type.
--   * Version history is append-only; one current version is enforced mechanically.
--   * Manager document metadata/bytes are not represented as a schema permission.
--   * Reminder state is NOT stored on versions; HR-7E uses a dedicated
--     hr_employee_document_reminder_deliveries ledger.
--   * Future acknowledgements/verifications/reminders can tenant-safely reference
--     document versions through UNIQUE (organisation_id, id).
--
-- No FK uses ON DELETE CASCADE. Soft deletion applies to the logical document only.

BEGIN;

DO $$
DECLARE
  people_anchor_columns TEXT;
  people_anchor_deferrable BOOLEAN;
  task_anchor_columns TEXT;
  task_anchor_deferrable BOOLEAN;
BEGIN
  SELECT
    string_agg(a.attname, ',' ORDER BY k.ord),
    c.condeferrable
    INTO people_anchor_columns, people_anchor_deferrable
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = k.attnum
  WHERE c.conrelid = to_regclass('hr_people')
    AND c.conname = 'hr_people_organisation_id_id_key'
    AND c.contype = 'u'
  GROUP BY c.condeferrable;

  IF people_anchor_columns IS NULL THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key is missing: apply the HR people tenant anchor before HR-7D1';
  END IF;
  IF people_anchor_columns IS DISTINCT FROM 'organisation_id,id' THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key has unexpected columns "%"; expected "organisation_id,id"', people_anchor_columns;
  END IF;
  IF people_anchor_deferrable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key must be non-deferrable for composite foreign-key use';
  END IF;

  SELECT
    string_agg(a.attname, ',' ORDER BY k.ord),
    c.condeferrable
    INTO task_anchor_columns, task_anchor_deferrable
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = k.attnum
  WHERE c.conrelid = to_regclass('hr_lifecycle_tasks')
    AND c.conname = 'hr_lifecycle_tasks_organisation_id_id_key'
    AND c.contype = 'u'
  GROUP BY c.condeferrable;

  IF task_anchor_columns IS NULL THEN
    RAISE EXCEPTION 'hr_lifecycle_tasks_organisation_id_id_key is missing: apply HR-7A before HR-7D1';
  END IF;
  IF task_anchor_columns IS DISTINCT FROM 'organisation_id,id' THEN
    RAISE EXCEPTION 'hr_lifecycle_tasks_organisation_id_id_key has unexpected columns "%"; expected "organisation_id,id"', task_anchor_columns;
  END IF;
  IF task_anchor_deferrable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'hr_lifecycle_tasks_organisation_id_id_key must be non-deferrable for composite foreign-key use';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hr_employee_documents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL REFERENCES organisations(id),
  person_id          UUID        NOT NULL,
  document_type      TEXT        NOT NULL,
  title              TEXT        NOT NULL,
  lifecycle_task_id  UUID,
  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_employee_documents_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_employee_documents_org_person_fkey
    FOREIGN KEY (organisation_id, person_id)
    REFERENCES hr_people(organisation_id, id),
  CONSTRAINT hr_employee_documents_org_lifecycle_task_fkey
    FOREIGN KEY (organisation_id, lifecycle_task_id)
    REFERENCES hr_lifecycle_tasks(organisation_id, id),
  CONSTRAINT hr_employee_documents_document_type_not_blank_check
    CHECK (btrim(document_type) <> ''),
  CONSTRAINT hr_employee_documents_title_not_blank_check
    CHECK (btrim(title) <> '')
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_documents_org_person
  ON hr_employee_documents(organisation_id, person_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_documents_org_person_type
  ON hr_employee_documents(organisation_id, person_id, document_type);
CREATE INDEX IF NOT EXISTS idx_hr_employee_documents_lifecycle_task_id
  ON hr_employee_documents(lifecycle_task_id);

CREATE TABLE IF NOT EXISTS hr_employee_document_versions (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    TEXT        NOT NULL REFERENCES organisations(id),
  document_id        UUID        NOT NULL,
  version_number     INTEGER     NOT NULL,
  uploaded_by        TEXT        NOT NULL REFERENCES users(id),
  original_filename  TEXT        NOT NULL,
  content_type       TEXT        NOT NULL,
  byte_size          BIGINT      NOT NULL,
  storage_key        TEXT        NOT NULL,
  expires_at         DATE,
  is_current         BOOLEAN     NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_employee_document_versions_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_employee_document_versions_org_document_fkey
    FOREIGN KEY (organisation_id, document_id)
    REFERENCES hr_employee_documents(organisation_id, id),
  CONSTRAINT hr_employee_document_versions_org_document_version_key
    UNIQUE (organisation_id, document_id, version_number),
  CONSTRAINT hr_employee_document_versions_storage_key_key
    UNIQUE (storage_key),
  CONSTRAINT hr_employee_document_versions_version_number_check
    CHECK (version_number > 0),
  CONSTRAINT hr_employee_document_versions_original_filename_not_blank_check
    CHECK (btrim(original_filename) <> ''),
  CONSTRAINT hr_employee_document_versions_content_type_not_blank_check
    CHECK (btrim(content_type) <> ''),
  CONSTRAINT hr_employee_document_versions_byte_size_check
    CHECK (byte_size >= 0),
  CONSTRAINT hr_employee_document_versions_storage_key_not_blank_check
    CHECK (btrim(storage_key) <> '')
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_document_versions_org_document
  ON hr_employee_document_versions(organisation_id, document_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_document_versions_expires_at
  ON hr_employee_document_versions(organisation_id, expires_at)
  WHERE expires_at IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hr_employee_document_versions_one_current
  ON hr_employee_document_versions(organisation_id, document_id)
  WHERE is_current = true;

COMMIT;

-- Rollback is intentionally not scripted. Once employee-document history exists,
-- dropping these tables would be destructive and requires separate authorization.
