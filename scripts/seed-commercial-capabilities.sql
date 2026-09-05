-- Phase C2 — Commercial capability registry seed. Registers the future
-- Commercial Suite module keys as CONCEPTS the platform is aware of —
-- identical in kind and purpose to scripts/seed-debtors-capability.sql
-- (Phase C1.1) and scripts/seed-modules-registry.sql before it.
--
-- Grants NOTHING to any organisation. No organisation_modules row is
-- touched by this script. Every key below is registered active = true
-- (the platform-wide kill switch), but every organisation's own
-- entitlement (organisation_modules.enabled) remains independently false
-- until a super_admin explicitly enables it through the existing
-- /admin/orgs capability-toggle UI — exactly the same two-step model
-- already governing 'debtors', 'crm', 'events', 'organiser'.
--
-- Key grouping: sales/quotes/invoicing are kept as three SEPARATE keys
-- (not one combined 'sales' key covering all three) because they are
-- reasonably expected to be entitled independently in practice (a tenant
-- may want quoting without full invoicing, or vice versa) — matching the
-- existing precedent of 'crm' and 'events' being separate keys rather
-- than one merged "customer-facing" key, even though they overlap in
-- practice. purchasing/expenses/budgeting/finance_intelligence are each
-- their own key for the same reason — no evidence in this codebase's
-- existing capability architecture supports a different grouping.
--
-- Idempotent: ON CONFLICT (key) DO NOTHING, using modules' own primary
-- key as the conflict target. Safe to re-run. Additive only: seven INSERT
-- statements into modules only — no UPDATE, no DELETE, no DDL, no
-- organisation_modules row.
--
-- NOT run automatically — a prepared migration artifact. Run manually
-- against the target database, after this repository's existing
-- rehearsal-then-approval convention.

INSERT INTO modules (key, name, description, active) VALUES
  ('sales',               'Sales',               'Sales pipeline and opportunity tracking for the Commercial Suite.', true),
  ('quotes',               'Quotes',              'Quote creation, sending, and acceptance tracking.', true),
  ('invoicing',            'Invoicing',           'Invoice issuance, payment tracking, and credit notes.', true),
  ('purchasing',           'Purchasing',          'Purchase requests, purchase orders, and supplier management.', true),
  ('expenses',             'Expenses',            'Expense claims and approval workflow.', true),
  ('budgeting',            'Budgeting',           'Budget planning and tracking against financial periods.', true),
  ('finance_intelligence', 'Finance Intelligence', 'Cross-module commercial reporting and financial insight.', true)
ON CONFLICT (key) DO NOTHING;
