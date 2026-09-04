-- Phase C1-DBR2 — Debtors account-level rollup view.
--
-- Context: debtor_accounts is CHARGE-LINE-grain data (Phase C1-DBR/
-- C1-DBD/C1-DBS/C1-DBF) — the same (organisation_id, account_number) pair
-- legitimately has many rows across financial years, quarters, and
-- charge types. No unique constraint exists on account_number, and none
-- is added by this script. This view aggregates every charge line for an
-- account into ONE reusable, always-live rollup row — a genuine
-- reusable primitive (any future route/report can query it directly),
-- not a synchronized copy: a plain SQL VIEW recomputes on every SELECT,
-- so it can never go stale the way a persisted summary table could.
--
-- Grain: (organisation_id, account_number) — one row per account.
--
-- current_outstanding: SUM(outstanding_amount) restricted to OPEN charge
-- lines only, across ALL financial years — a RESOLVED charge line never
-- contributes, and no financial-year scoping is applied anywhere in this
-- view (old unpaid debt from an earlier financial year remains counted).
-- This is deliberately NOT the same concept as total_original_charges
-- (historical charge volume, every charge line regardless of status).
--
-- current_days_overdue / current_aging_bucket are computed from
-- oldest_open_invoice_date against CURRENT_DATE, at query time — never
-- from any row's frozen, ingest-time-computed days_overdue/aging_bucket
-- column, which is stale from the moment after insert. Both are NULL for
-- an account with no open charge lines (open_charge_count = 0) — a fully
-- resolved account has no meaningful "how overdue" figure. This mirrors
-- modules/debtors/calculations.ts's agingBucketFromDays() thresholds
-- exactly (<=0 CURRENT, <=30 DAYS_30, <=60 DAYS_60, <=90 DAYS_90, else
-- DAYS_90_PLUS) — the only aging-bucket definition found anywhere in
-- this codebase, reused rather than reinvented.
--
-- account_name: MAX(account_name) — a deterministic representative-value
-- strategy. Investigated against real rehearsal data (Phase C1-DBR2's own
-- preflight): 0 of 14,383 accounts show more than one distinct
-- account_name across their charge lines today, so this is a
-- non-lossy choice in practice. Documented explicitly because MAX()
-- would silently pick the lexicographically-last value if that ever
-- changed — this is not a guarantee that account_name is immutable, only
-- the deterministic tie-break this view applies if it ever varies.
--
-- Duplicate/collision policy: this view aggregates EVERY row that exists
-- in debtor_accounts for an account, including every row inside a
-- residual 6-part-key collision group (see Phase C1-DBD/C1-DBS —
-- currently 786 such groups). No row is excluded, no "winning" row is
-- chosen, no exact-duplicate detection is applied here — every row
-- contributes fully to every SUM/COUNT/MIN/MAX above. This is
-- deliberate: this phase's brief requires aggregating every preserved
-- source row, not inferring which are "real" duplicates.
--
-- Organisation scoping: this view does NOT filter by organisation_id —
-- it aggregates across all organisations' accounts in one relation,
-- exactly like the underlying debtor_accounts table itself. Every caller
-- MUST add `WHERE organisation_id = $1` — the same discipline already
-- required everywhere else in this codebase (no RLS backstop exists; see
-- the Commercial Suite audit's own Tenant Isolation findings).
--
-- NOT run automatically — a prepared migration artifact. Idempotent:
-- CREATE OR REPLACE VIEW is always safe to re-run and never destructive
-- (no DROP, no data mutation of any kind — a view has no rows of its own
-- to lose). Run manually against the target database following this
-- repository's existing hand-written-SQL-migration convention (no
-- prisma/migrations directory; no prisma migrate; no prisma db push).

CREATE OR REPLACE VIEW debtor_account_summary AS
WITH agg AS (
  SELECT
    organisation_id,
    account_number,
    MAX(account_name) AS account_name,
    COALESCE(SUM(outstanding_amount) FILTER (WHERE status = 'OPEN'), 0) AS current_outstanding,
    COALESCE(SUM(original_amount), 0) AS total_original_charges,
    COUNT(*) FILTER (WHERE status = 'OPEN')::int AS open_charge_count,
    COUNT(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved_charge_count,
    COUNT(*)::int AS total_charge_count,
    MIN(invoice_date) FILTER (WHERE status = 'OPEN') AS oldest_open_invoice_date,
    MAX(invoice_date) AS latest_charge_invoice_date,
    MIN(financial_year) AS first_charge_financial_year,
    MAX(financial_year) AS latest_charge_financial_year,
    COUNT(DISTINCT charge_type)::int AS distinct_charge_type_count
  FROM debtor_accounts
  GROUP BY organisation_id, account_number
)
SELECT
  organisation_id,
  account_number,
  account_name,
  current_outstanding,
  total_original_charges,
  open_charge_count,
  resolved_charge_count,
  total_charge_count,
  oldest_open_invoice_date,
  CASE WHEN oldest_open_invoice_date IS NULL THEN NULL
       ELSE GREATEST(0, (CURRENT_DATE - oldest_open_invoice_date::date))
  END AS current_days_overdue,
  CASE WHEN oldest_open_invoice_date IS NULL THEN NULL
       WHEN (CURRENT_DATE - oldest_open_invoice_date::date) <= 0  THEN 'CURRENT'
       WHEN (CURRENT_DATE - oldest_open_invoice_date::date) <= 30 THEN 'DAYS_30'
       WHEN (CURRENT_DATE - oldest_open_invoice_date::date) <= 60 THEN 'DAYS_60'
       WHEN (CURRENT_DATE - oldest_open_invoice_date::date) <= 90 THEN 'DAYS_90'
       ELSE 'DAYS_90_PLUS'
  END AS current_aging_bucket,
  latest_charge_invoice_date,
  first_charge_financial_year,
  latest_charge_financial_year,
  distinct_charge_type_count
FROM agg;
