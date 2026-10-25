# Eve free-order legal notice version: release runbook

The change: `event_orders.legal_notice_version` plus `event_orders_legal_notice_check`
(ADR 0013 §12). It touches no legal wording, Stripe or paid checkout.

**Order is mandatory: migration first, code second.** The free-order INSERT in
`lib/events/services/freeRegistration.ts` names the new column. If the code is deployed to a
database without it, every free registration fails (Eve and BrainBase). Do not merge the PR
until step 2 has passed.

## 1. Preflight (read-only, Production)

```sql
SELECT count(*) FILTER (WHERE column_name = 'legal_notice_version') AS has_column
FROM information_schema.columns WHERE table_name = 'event_orders';                -- expect 0
SELECT conname FROM pg_constraint
WHERE conrelid = 'event_orders'::regclass
  AND conname IN ('event_orders_legal_notice_check', 'event_orders_legal_acceptance_check');
-- expect only event_orders_legal_acceptance_check
SELECT product_surface, (total_cents = 0) AS free, (terms_accepted_at IS NOT NULL) AS accepted, count(*)
FROM event_orders GROUP BY 1, 2, 3 ORDER BY 1, 2, 3;                              -- record as the baseline
```

## 2. Apply (operator, Neon SQL editor, Production branch)

1. Take a Neon snapshot first.
2. Paste the whole of `scripts/add-events-order-legal-notice.sql`. It is one transaction
   with a 5 s lock timeout. If the lock is not obtained, it rolls back entirely and can be
   re-run.

Then verify:

```sql
SELECT data_type, is_nullable, column_default FROM information_schema.columns
WHERE table_name = 'event_orders' AND column_name = 'legal_notice_version';  -- text | YES | NULL
SELECT convalidated FROM pg_constraint
WHERE conrelid = 'event_orders'::regclass AND conname = 'event_orders_legal_notice_check';  -- true
SELECT count(*) FROM event_orders WHERE legal_notice_version IS NOT NULL;   -- 0 (no backfill)
```

Re-run the grouped count from step 1: it must match the baseline exactly.

## 3. Deploy the code

Merge the PR, wait for both the BrainBase and Eve Production deployments to be READY, then
check:

- The newest Eve free order (if one is created during a planned check) has
  `legal_notice_version = '<EVE_LEGAL_DOCUMENT_VERSION>'` and NULL `terms_*`.
- BrainBase free orders created after the deploy stay NULL.
- Historical orders: `count(*) WHERE legal_notice_version IS NOT NULL AND created_at < '<deploy time>'`
  is 0.
- The paid path is unchanged (Eve paid checkout is still behind its kill switch).

## Rollback

- **Code only:** revert the merge. Old code ignores the column, so it can stay.
- **Schema** (only after the code is reverted or never deployed):

  ```sql
  BEGIN;
  SET LOCAL lock_timeout = '5s';
  ALTER TABLE event_orders DROP CONSTRAINT IF EXISTS event_orders_legal_notice_check;
  ALTER TABLE event_orders DROP COLUMN IF EXISTS legal_notice_version;
  COMMIT;
  ```

  This loses only the notice-version values recorded since the deploy.
