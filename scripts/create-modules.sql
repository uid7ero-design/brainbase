-- Capability module registry — schema foundation only.
-- Run once, manually, against the production database. NOT run
-- automatically by this task — see the Modular Platform Foundation
-- Phase F.4B report for the exact authorization/verification steps
-- before this is executed.
--
-- Purpose: the platform-wide registry of BrainBase CAPABILITIES (e.g.
-- "crm", "organiser") an organisation can be entitled to via
-- organisation_modules (see scripts/create-organisation-modules.sql,
-- run after this one). This table is deliberately NOT for external
-- INTEGRATIONS (Microsoft 365, Google, Instagram) — those remain
-- governed entirely by the existing, separate, untouched
-- lib/globalIntegrationAccess.ts model. A capability MAY be backed by
-- an integration (selected via a future capability's own config), but
-- an integration itself never becomes a modules row.
--
-- Identity design: `key` (not a surrogate id) is the primary key.
-- modules is a small, rarely-inserted, curated registry — unlike every
-- business-data table in this repository, nothing here benefits from a
-- separate opaque id, since application code is required to resolve
-- capabilities by their stable, human-meaningful key, never by an
-- opaque database id (see the Phase F.4A design report for the full
-- reasoning). No modules.id column exists by design.
--
-- `active` is the deliberately minimal, boolean, platform-wide kill
-- switch (Phase F.4A/F.4B: "we should not add lifecycle complexity
-- before we need it") — true means the capability is available for use
-- platform-wide; false means it is globally withdrawn regardless of
-- any organisation's own organisation_modules.enabled value. This is
-- NOT the same thing as a specific organisation's entitlement, which
-- lives entirely in organisation_modules.
--
-- Namespace note: metric_snapshots.module_key, import_mappings.
-- module_key, and kpi_rules.module_key are a separate, legacy,
-- domain-specific (waste/fleet/local-government dashboard-metrics)
-- scoping concept, unrelated to this capability registry despite the
-- shared column-name vocabulary. No existing field was renamed to
-- avoid this — see the Phase F.4A report.
--
-- Timestamps use TIMESTAMPTZ, matching the convention already used
-- consistently by every other standalone table-creation script in this
-- repository (implementations, web_service_leads,
-- microsoft_connections) — not organisations' own `timestamp without
-- time zone`, which is a side effect of Prisma's default DateTime
-- mapping rather than a deliberate BrainBase convention.
--
-- Additive only: creates one new table. Does not touch organisations,
-- users, any integration table, or any existing schema. No row is
-- inserted by this script — the registry starts empty; seeding is an
-- explicitly separate, later, authorized step (see the Phase F.4B
-- report's Initial Registry Policy).

CREATE TABLE IF NOT EXISTS modules (
  key         TEXT        PRIMARY KEY,
  name        TEXT        NOT NULL,
  description TEXT,
  active      BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
