-- HR-7E1 — Employee-document acknowledgement, verification, and reminder-delivery schema foundation.
-- Schema only: no routes, reminder sending, UI, seed data, document data, or Production execution.
--
-- Canonical tables:
--   * hr_employee_document_acknowledgements
--   * hr_employee_document_verifications
--   * hr_employee_document_reminder_deliveries
--
-- Design invariants:
--   * All HR-owned relations are tenant-safe through (organisation_id, ...).
--   * All three tables reference immutable document versions, not logical documents.
--   * User references remain plain users(id) FKs, matching the existing HR schema pattern;
--     user tenant membership remains application-enforced.
--   * Acknowledgements are one-per-user-per-version.
--   * Verifications are append-only decision events; repeated decisions are allowed.
--   * Reminder claim/sent/failed state lives only in the dedicated delivery ledger.
--   * Reminder delivery identity is stable per tenant/version/recipient/type/scheduled date.
--   * No FK uses ON DELETE CASCADE.

BEGIN;

DO $$
DECLARE
  version_anchor_columns TEXT;
  version_anchor_deferrable BOOLEAN;
BEGIN
  SELECT
    string_agg(a.attname, ',' ORDER BY k.ord),
    c.condeferrable
    INTO version_anchor_columns, version_anchor_deferrable
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = k.attnum
  WHERE c.conrelid = to_regclass('hr_employee_document_versions')
    AND c.conname = 'hr_employee_document_versions_organisation_id_id_key'
    AND c.contype = 'u'
  GROUP BY c.condeferrable;

  IF version_anchor_columns IS NULL THEN
    RAISE EXCEPTION 'hr_employee_document_versions_organisation_id_id_key is missing: apply HR-7D before HR-7E1';
  END IF;
  IF version_anchor_columns IS DISTINCT FROM 'organisation_id,id' THEN
    RAISE EXCEPTION 'hr_employee_document_versions_organisation_id_id_key has unexpected columns "%"; expected "organisation_id,id"', version_anchor_columns;
  END IF;
  IF version_anchor_deferrable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'hr_employee_document_versions_organisation_id_id_key must be non-deferrable for composite foreign-key use';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hr_employee_document_acknowledgements (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id),
  document_version_id  UUID        NOT NULL,
  acknowledged_by      TEXT        NOT NULL REFERENCES users(id),
  acknowledged_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_employee_document_acknowledgements_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_employee_document_acknowledgements_org_version_fkey
    FOREIGN KEY (organisation_id, document_version_id)
    REFERENCES hr_employee_document_versions(organisation_id, id),
  CONSTRAINT hr_employee_document_acknowledgements_org_version_user_key
    UNIQUE (organisation_id, document_version_id, acknowledged_by)
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_document_acknowledgements_org_version
  ON hr_employee_document_acknowledgements(organisation_id, document_version_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_document_acknowledgements_org_user
  ON hr_employee_document_acknowledgements(organisation_id, acknowledged_by);

CREATE TABLE IF NOT EXISTS hr_employee_document_verifications (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id),
  document_version_id  UUID        NOT NULL,
  verified_by          TEXT        NOT NULL REFERENCES users(id),
  decision             TEXT        NOT NULL,
  comment              TEXT,
  verified_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_employee_document_verifications_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_employee_document_verifications_org_version_fkey
    FOREIGN KEY (organisation_id, document_version_id)
    REFERENCES hr_employee_document_versions(organisation_id, id),
  CONSTRAINT hr_employee_document_verifications_decision_check
    CHECK (decision IN ('VERIFIED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_document_verifications_org_version
  ON hr_employee_document_verifications(organisation_id, document_version_id, verified_at DESC);
CREATE INDEX IF NOT EXISTS idx_hr_employee_document_verifications_org_verifier
  ON hr_employee_document_verifications(organisation_id, verified_by, verified_at DESC);

CREATE TABLE IF NOT EXISTS hr_employee_document_reminder_deliveries (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id),
  document_version_id  UUID        NOT NULL,
  recipient_user_id    TEXT        NOT NULL REFERENCES users(id),
  reminder_type        TEXT        NOT NULL,
  scheduled_for        DATE        NOT NULL,
  delivery_status      TEXT        NOT NULL DEFAULT 'PENDING',
  claimed_at           TIMESTAMPTZ,
  sent_at              TIMESTAMPTZ,
  failed_at            TIMESTAMPTZ,
  failure_code         TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_employee_document_reminder_deliveries_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_employee_document_reminder_deliveries_org_version_fkey
    FOREIGN KEY (organisation_id, document_version_id)
    REFERENCES hr_employee_document_versions(organisation_id, id),
  CONSTRAINT hr_employee_document_reminder_deliveries_identity_key
    UNIQUE (
      organisation_id,
      document_version_id,
      recipient_user_id,
      reminder_type,
      scheduled_for
    ),
  CONSTRAINT hr_emp_doc_reminder_type_not_blank_check
    CHECK (btrim(reminder_type) <> ''),
  CONSTRAINT hr_employee_document_reminder_deliveries_status_check
    CHECK (delivery_status IN ('PENDING', 'CLAIMED', 'SENT', 'FAILED')),
  CONSTRAINT hr_emp_doc_reminder_failure_code_not_blank_check
    CHECK (failure_code IS NULL OR btrim(failure_code) <> ''),
  CONSTRAINT hr_employee_document_reminder_deliveries_state_check
    CHECK (
      (
        delivery_status = 'PENDING'
        AND claimed_at IS NULL
        AND sent_at IS NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
      )
      OR
      (
        delivery_status = 'CLAIMED'
        AND claimed_at IS NOT NULL
        AND sent_at IS NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
      )
      OR
      (
        delivery_status = 'SENT'
        AND claimed_at IS NOT NULL
        AND sent_at IS NOT NULL
        AND failed_at IS NULL
        AND failure_code IS NULL
      )
      OR
      (
        delivery_status = 'FAILED'
        AND claimed_at IS NOT NULL
        AND sent_at IS NULL
        AND failed_at IS NOT NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_hr_employee_document_reminder_deliveries_due
  ON hr_employee_document_reminder_deliveries(
    organisation_id,
    delivery_status,
    scheduled_for
  );
CREATE INDEX IF NOT EXISTS idx_hr_employee_document_reminder_deliveries_org_version
  ON hr_employee_document_reminder_deliveries(organisation_id, document_version_id);
CREATE INDEX IF NOT EXISTS idx_hr_employee_document_reminder_deliveries_org_recipient
  ON hr_employee_document_reminder_deliveries(organisation_id, recipient_user_id, scheduled_for);

COMMIT;

-- Rollback is intentionally not scripted. These tables become historical assurance
-- records once runtime writers exist, so destructive removal requires separate review
-- and explicit authorization.
