-- HR-7A — Employee lifecycle schema foundation.
-- Schema only: no routes, UI, runtime writers, seed data, or Production execution.
-- Additive-only and safe to re-run. The preflight verifies the HR people tenant
-- anchor is exactly UNIQUE (organisation_id, id) and non-deferrable.
-- Verified against disposable postgres:16 by
-- scripts/tests/verify-hr-lifecycle-migration.sh.
--
-- Tenant integrity follows the established HR pattern:
--   * HR-owned parent/child references use composite (organisation_id, id) FKs.
--   * users.id has no (organisation_id, id) tenant anchor, so user references
--     remain existence-only FKs and same-organisation validation is reserved for
--     the later application write paths.
--
-- Historical integrity:
--   * template_key is the stable family key; version_number identifies a version.
--   * Workflows pin one exact template_id.
--   * Instantiated tasks snapshot runtime fields; template_task_id is traceability.
--   * No foreign key uses ON DELETE CASCADE.
--
-- Activated-template immutability and append-only approvals are future application
-- rules. This migration enforces structural consistency, vocabularies, tenant
-- relations, state/timestamp coherence, and concurrency-critical uniqueness.

BEGIN;

DO $$
DECLARE
  anchor_columns TEXT;
  anchor_deferrable BOOLEAN;
BEGIN
  SELECT
    string_agg(a.attname, ',' ORDER BY k.ord),
    c.condeferrable
    INTO anchor_columns, anchor_deferrable
  FROM pg_constraint c
  CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
  JOIN pg_attribute a
    ON a.attrelid = c.conrelid
   AND a.attnum = k.attnum
  WHERE c.conrelid = to_regclass('hr_people')
    AND c.conname = 'hr_people_organisation_id_id_key'
    AND c.contype = 'u'
  GROUP BY c.condeferrable;

  IF anchor_columns IS NULL THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key is missing: apply the HR people tenant anchor before HR-7A';
  END IF;

  IF anchor_columns IS DISTINCT FROM 'organisation_id,id' THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key has unexpected columns "%"; expected "organisation_id,id"', anchor_columns;
  END IF;

  IF anchor_deferrable IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'hr_people_organisation_id_id_key must be non-deferrable for composite foreign-key use';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS hr_lifecycle_templates (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  template_key     TEXT        NOT NULL,
  version_number   INTEGER     NOT NULL,
  lifecycle_type   TEXT        NOT NULL,
  name             TEXT        NOT NULL,
  description      TEXT,
  status           TEXT        NOT NULL DEFAULT 'DRAFT',
  activated_at     TIMESTAMPTZ,
  retired_at       TIMESTAMPTZ,
  created_by       TEXT        NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_lifecycle_templates_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_lifecycle_templates_org_id_type_key
    UNIQUE (organisation_id, id, lifecycle_type),
  CONSTRAINT hr_lifecycle_templates_org_key_version_key
    UNIQUE (organisation_id, template_key, version_number),
  CONSTRAINT hr_lifecycle_templates_version_number_check
    CHECK (version_number > 0),
  CONSTRAINT hr_lifecycle_templates_lifecycle_type_check
    CHECK (lifecycle_type IN ('onboarding', 'offboarding')),
  CONSTRAINT hr_lifecycle_templates_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'RETIRED')),
  CONSTRAINT hr_lifecycle_templates_status_timestamps_check
    CHECK (
      (status = 'DRAFT' AND activated_at IS NULL AND retired_at IS NULL)
      OR
      (status = 'ACTIVE' AND activated_at IS NOT NULL AND retired_at IS NULL)
      OR
      (status = 'RETIRED' AND retired_at IS NOT NULL)
    ),
  CONSTRAINT hr_lifecycle_templates_template_key_not_blank_check
    CHECK (btrim(template_key) <> ''),
  CONSTRAINT hr_lifecycle_templates_name_not_blank_check
    CHECK (btrim(name) <> '')
);

CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_templates_organisation_id
  ON hr_lifecycle_templates(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_templates_org_key
  ON hr_lifecycle_templates(organisation_id, template_key);
CREATE UNIQUE INDEX IF NOT EXISTS hr_lifecycle_templates_one_active_version
  ON hr_lifecycle_templates(organisation_id, template_key)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS hr_lifecycle_template_tasks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id),
  template_id          UUID        NOT NULL,
  sequence             INTEGER     NOT NULL,
  title                TEXT        NOT NULL,
  description          TEXT,
  responsibility_type  TEXT        NOT NULL,
  due_offset_days      INTEGER,
  requires_approval    BOOLEAN     NOT NULL DEFAULT false,
  approval_type        TEXT        NOT NULL DEFAULT 'NONE',
  employee_visible     BOOLEAN     NOT NULL DEFAULT false,
  manager_visible      BOOLEAN     NOT NULL DEFAULT false,
  internal_only        BOOLEAN     NOT NULL DEFAULT false,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_lifecycle_template_tasks_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_lifecycle_template_tasks_org_id_template_key
    UNIQUE (organisation_id, id, template_id),
  CONSTRAINT hr_lifecycle_template_tasks_org_template_fkey
    FOREIGN KEY (organisation_id, template_id)
    REFERENCES hr_lifecycle_templates(organisation_id, id),
  CONSTRAINT hr_lifecycle_template_tasks_org_template_sequence_key
    UNIQUE (organisation_id, template_id, sequence),
  CONSTRAINT hr_lifecycle_template_tasks_sequence_check
    CHECK (sequence > 0),
  CONSTRAINT hr_lifecycle_template_tasks_title_not_blank_check
    CHECK (btrim(title) <> ''),
  CONSTRAINT hr_lifecycle_template_tasks_responsibility_type_check
    CHECK (responsibility_type IN ('EMPLOYEE', 'MANAGER', 'HR_ADMIN')),
  CONSTRAINT hr_lifecycle_template_tasks_approval_type_check
    CHECK (approval_type IN ('NONE', 'MANAGER', 'HR_ADMIN')),
  CONSTRAINT hr_lifecycle_template_tasks_approval_coherence_check
    CHECK (
      (requires_approval = false AND approval_type = 'NONE')
      OR
      (requires_approval = true AND approval_type IN ('MANAGER', 'HR_ADMIN'))
    ),
  CONSTRAINT hr_lifecycle_template_tasks_visibility_check
    CHECK (internal_only = false OR (employee_visible = false AND manager_visible = false))
);

CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_template_tasks_organisation_id
  ON hr_lifecycle_template_tasks(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_template_tasks_template_id
  ON hr_lifecycle_template_tasks(template_id);

CREATE TABLE IF NOT EXISTS hr_lifecycle_workflows (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  TEXT        NOT NULL REFERENCES organisations(id),
  person_id        UUID        NOT NULL,
  template_id      UUID        NOT NULL,
  lifecycle_type   TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'ACTIVE',
  anchor_date      DATE        NOT NULL,
  started_by       TEXT        NOT NULL REFERENCES users(id),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at     TIMESTAMPTZ,
  cancelled_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_lifecycle_workflows_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_lifecycle_workflows_org_id_person_template_key
    UNIQUE (organisation_id, id, person_id, template_id),
  CONSTRAINT hr_lifecycle_workflows_org_person_fkey
    FOREIGN KEY (organisation_id, person_id)
    REFERENCES hr_people(organisation_id, id),
  CONSTRAINT hr_lifecycle_workflows_org_template_fkey
    FOREIGN KEY (organisation_id, template_id, lifecycle_type)
    REFERENCES hr_lifecycle_templates(organisation_id, id, lifecycle_type),
  CONSTRAINT hr_lifecycle_workflows_lifecycle_type_check
    CHECK (lifecycle_type IN ('onboarding', 'offboarding')),
  CONSTRAINT hr_lifecycle_workflows_status_check
    CHECK (status IN ('ACTIVE', 'COMPLETED', 'CANCELLED')),
  CONSTRAINT hr_lifecycle_workflows_status_timestamps_check
    CHECK (
      (status = 'ACTIVE' AND completed_at IS NULL AND cancelled_at IS NULL)
      OR
      (status = 'COMPLETED' AND completed_at IS NOT NULL AND cancelled_at IS NULL)
      OR
      (status = 'CANCELLED' AND completed_at IS NULL AND cancelled_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_workflows_organisation_id
  ON hr_lifecycle_workflows(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_workflows_person_id
  ON hr_lifecycle_workflows(person_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_workflows_template_id
  ON hr_lifecycle_workflows(template_id);
CREATE UNIQUE INDEX IF NOT EXISTS hr_lifecycle_workflows_one_active_per_person_type
  ON hr_lifecycle_workflows(organisation_id, person_id, lifecycle_type)
  WHERE status = 'ACTIVE';

CREATE TABLE IF NOT EXISTS hr_lifecycle_tasks (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      TEXT        NOT NULL REFERENCES organisations(id),
  workflow_id          UUID        NOT NULL,
  person_id            UUID        NOT NULL,
  template_id          UUID        NOT NULL,
  template_task_id     UUID        NOT NULL,
  sequence             INTEGER     NOT NULL,
  title                TEXT        NOT NULL,
  description          TEXT,
  responsibility_type  TEXT        NOT NULL,
  assigned_user_id     TEXT        REFERENCES users(id),
  due_at               TIMESTAMPTZ,
  requires_approval    BOOLEAN     NOT NULL DEFAULT false,
  approval_type        TEXT        NOT NULL DEFAULT 'NONE',
  employee_visible     BOOLEAN     NOT NULL DEFAULT false,
  manager_visible      BOOLEAN     NOT NULL DEFAULT false,
  internal_only        BOOLEAN     NOT NULL DEFAULT false,
  status               TEXT        NOT NULL DEFAULT 'NOT_STARTED',
  completed_by         TEXT        REFERENCES users(id),
  completed_at         TIMESTAMPTZ,
  waived_by            TEXT        REFERENCES users(id),
  waived_at            TIMESTAMPTZ,
  waiver_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_lifecycle_tasks_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_lifecycle_tasks_org_id_workflow_person_key
    UNIQUE (organisation_id, id, workflow_id, person_id),
  CONSTRAINT hr_lifecycle_tasks_org_workflow_person_template_fkey
    FOREIGN KEY (organisation_id, workflow_id, person_id, template_id)
    REFERENCES hr_lifecycle_workflows(organisation_id, id, person_id, template_id),
  CONSTRAINT hr_lifecycle_tasks_org_template_task_template_fkey
    FOREIGN KEY (organisation_id, template_task_id, template_id)
    REFERENCES hr_lifecycle_template_tasks(organisation_id, id, template_id),
  CONSTRAINT hr_lifecycle_tasks_org_workflow_sequence_key
    UNIQUE (organisation_id, workflow_id, sequence),
  CONSTRAINT hr_lifecycle_tasks_sequence_check
    CHECK (sequence > 0),
  CONSTRAINT hr_lifecycle_tasks_title_not_blank_check
    CHECK (btrim(title) <> ''),
  CONSTRAINT hr_lifecycle_tasks_responsibility_type_check
    CHECK (responsibility_type IN ('EMPLOYEE', 'MANAGER', 'HR_ADMIN')),
  CONSTRAINT hr_lifecycle_tasks_approval_type_check
    CHECK (approval_type IN ('NONE', 'MANAGER', 'HR_ADMIN')),
  CONSTRAINT hr_lifecycle_tasks_approval_coherence_check
    CHECK (
      (requires_approval = false AND approval_type = 'NONE')
      OR
      (requires_approval = true AND approval_type IN ('MANAGER', 'HR_ADMIN'))
    ),
  CONSTRAINT hr_lifecycle_tasks_visibility_check
    CHECK (internal_only = false OR (employee_visible = false AND manager_visible = false)),
  CONSTRAINT hr_lifecycle_tasks_status_check
    CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'AWAITING_APPROVAL', 'COMPLETED', 'WAIVED', 'CANCELLED')),
  CONSTRAINT hr_lifecycle_tasks_terminal_fields_check
    CHECK (
      (
        status = 'COMPLETED'
        AND completed_by IS NOT NULL
        AND completed_at IS NOT NULL
        AND waived_by IS NULL
        AND waived_at IS NULL
        AND waiver_reason IS NULL
      )
      OR
      (
        status = 'WAIVED'
        AND completed_by IS NULL
        AND completed_at IS NULL
        AND waived_by IS NOT NULL
        AND waived_at IS NOT NULL
        AND waiver_reason IS NOT NULL
        AND btrim(waiver_reason) <> ''
      )
      OR
      (
        status NOT IN ('COMPLETED', 'WAIVED')
        AND completed_by IS NULL
        AND completed_at IS NULL
        AND waived_by IS NULL
        AND waived_at IS NULL
        AND waiver_reason IS NULL
      )
    )
);

CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_tasks_organisation_id
  ON hr_lifecycle_tasks(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_tasks_workflow_id
  ON hr_lifecycle_tasks(workflow_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_tasks_person_id
  ON hr_lifecycle_tasks(person_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_tasks_assigned_user_id
  ON hr_lifecycle_tasks(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_tasks_status
  ON hr_lifecycle_tasks(organisation_id, status);

CREATE TABLE IF NOT EXISTS hr_lifecycle_task_approvals (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   TEXT        NOT NULL REFERENCES organisations(id),
  task_id           UUID        NOT NULL,
  workflow_id       UUID        NOT NULL,
  person_id         UUID        NOT NULL,
  approver_user_id  TEXT        NOT NULL REFERENCES users(id),
  decision          TEXT        NOT NULL,
  comment           TEXT,
  decided_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT hr_lifecycle_task_approvals_organisation_id_id_key
    UNIQUE (organisation_id, id),
  CONSTRAINT hr_lifecycle_task_approvals_org_task_workflow_person_fkey
    FOREIGN KEY (organisation_id, task_id, workflow_id, person_id)
    REFERENCES hr_lifecycle_tasks(organisation_id, id, workflow_id, person_id),
  CONSTRAINT hr_lifecycle_task_approvals_decision_check
    CHECK (decision IN ('APPROVED', 'REJECTED'))
);

CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_task_approvals_organisation_id
  ON hr_lifecycle_task_approvals(organisation_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_task_approvals_task_id
  ON hr_lifecycle_task_approvals(task_id);
CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_task_approvals_workflow_id
  ON hr_lifecycle_task_approvals(workflow_id);

COMMIT;

-- Rollback is intentionally not scripted. Dropping these tables after they hold
-- lifecycle history would be destructive and requires separate authorization.
