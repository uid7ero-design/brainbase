-- Phase C3-POLISH-R §4 — standard Australian tax-code bootstrap, as a
-- direct-SQL artifact for organisations that need this seeded without
-- going through the app's Settings > Tax Codes "Seed standard Australian
-- tax codes" button (lib/commercial/taxCodeBootstrap.ts, which the
-- button and the API route both call, and which is what runs this exact
-- logic normally). This file exists purely so the same seed can be
-- driven directly against a database with psql for a one-off bulk
-- operation, matching this repository's convention of a hand-written
-- SQL script per data operation (see scripts/seed-commercial-capabilities.sql).
--
-- NOT run automatically. NOT run against production by this phase — see
-- the C3-POLISH-R final report's "Production Follow-Up Required" section.
-- Idempotent: ON CONFLICT (organisation_id, code) DO NOTHING against
-- commercial_tax_codes' existing UNIQUE(organisation_id, code) constraint
-- (scripts/create-commercial-core.sql §2) — safe to re-run, and never
-- overwrites a tax code an organisation has since customised.
--
-- Usage: replace :'target_organisation_id' with the real organisation id
-- (a TEXT/cuid value — organisations.id is never ::uuid, per this
-- repository's own documented convention) before running, e.g.:
--   psql "$DATABASE_URL" -v target_organisation_id="'org_abc123'" -f scripts/seed-standard-au-tax-codes.sql

INSERT INTO commercial_tax_codes (organisation_id, code, name, rate, is_default)
VALUES (:target_organisation_id, 'GST', 'GST 10%', 10.00, true)
ON CONFLICT (organisation_id, code) DO NOTHING;

INSERT INTO commercial_tax_codes (organisation_id, code, name, rate, is_default)
VALUES (:target_organisation_id, 'GST_FREE', 'GST Free', 0.00, false)
ON CONFLICT (organisation_id, code) DO NOTHING;

INSERT INTO commercial_tax_codes (organisation_id, code, name, rate, is_default)
VALUES (:target_organisation_id, 'NO_TAX', 'No Tax', 0.00, false)
ON CONFLICT (organisation_id, code) DO NOTHING;
