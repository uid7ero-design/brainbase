# Eve registration questions — Production release runbook

Status: NOT STARTED. PR #483 stays DRAFT until every gate below is signed off.
Production schema changes go through the Neon SQL editor handoff (no `vercel env
pull`, no scripted Production connection). Nothing here enables questions on any
event.

## Gates (in order)

1. Operator approves the retention/category model (done 2026-10-24, ADR 0013 §4b).
2. **Legal review** of the Privacy Policy wording (sections 2, 3, 4, 5, 8 in
   `apps/eve/content/legal.ts`, marked `LEGAL REVIEW REQUIRED`) and the in-form
   notices (`apps/eve/components/buyer/BuyerBooking.tsx`, `QuestionField.tsx`).
3. Copies rule adopted and the approved cleanup done
   (`docs/compliance/eve-production-data-copies.md`).
4. On publication day only: set `LEGAL_LAST_UPDATED` (`apps/eve/config/legal.ts`)
   to that date; bump the legal version stamp only if counsel asks (Privacy is not
   part of the paid-order acceptance stamp).
5. Operator approves the Production migration.
6. Neon snapshot of `production` named `pre-eve-registration-questions-YYYYMMDD`,
   delete-by date recorded in the copies document.
7. Baseline (read-only, below) recorded.
8. Apply `scripts/add-eve-registration-questions.sql` in the Neon SQL editor (one
   transaction; 5-second lock timeout — if it times out, nothing changed: re-run).
9. Post-migration checks (below) all match.
10. Mark PR #483 ready; CI green; merge (normal merge commit).
11. Both Production deployments Ready; smoke checks (below).
12. Retention cron: first daily run is report-only (`EVE_ANSWER_RETENTION_ENFORCE`
    unset). Check its log line: expected `due=0 redacted=0`.
13. Turn on enforcement (`EVE_ANSWER_RETENTION_ENFORCE=true`, exact string) as a
    separate approved step — must be on before the first Eve answer could become
    due, and before the Privacy wording is relied on.
14. Separately, later, with its own approval: add the Riverlights questions and
    switch "Ask these questions on Eve" on for Riverlights only.

## Baseline (read-only) — values on 2026-10-23 for reference

```sql
SELECT (SELECT count(*) FROM events) AS events,
       (SELECT count(*) FROM event_orders) AS orders,
       (SELECT count(*) FROM event_registration_questions) AS questions,
       (SELECT count(*) FROM event_registration_responses) AS responses,
       (SELECT md5(string_agg(id || ':' || answer::text, ',' ORDER BY id)) FROM event_registration_responses) AS answers_md5,
       (SELECT md5(string_agg(id || ':' || label || ':' || field_type || ':' || required || ':' || active, ',' ORDER BY id)) FROM event_registration_questions) AS questions_md5;
-- 2026-10-23: 6 | 41 | 6 | 14 | 2aeccf4f8c51a8afdcba1d77d88d6d3c | 460bea39ba500c494b2a8e3e47a96759
-- Re-run on release day; the post-migration check must equal THAT day's values.
```

## Post-migration checks (read-only)

```sql
-- 1. Exactly these 11 columns, types and defaults
SELECT table_name, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND (table_name, column_name) IN (
  ('events','eve_questions_enabled'), ('events','cancelled_at'), ('events','answers_legal_hold'),
  ('event_orders','answers_legal_hold'),
  ('event_registration_questions','data_category'), ('event_registration_questions','template_key'),
  ('event_registration_responses','data_category_snapshot'), ('event_registration_responses','question_help_text_snapshot'),
  ('event_registration_responses','sensitive_consent_at'), ('event_registration_responses','redacted_at'),
  ('event_registration_responses','answer'))
ORDER BY 1, 2;
-- expected:
--  event_orders                 answers_legal_hold          text                     YES  NULL
--  event_registration_questions data_category               text                     NO   'STANDARD'::text
--  event_registration_questions template_key                text                     YES  NULL
--  event_registration_responses answer                      jsonb                    YES  NULL   <- now nullable
--  event_registration_responses data_category_snapshot      text                     NO   'STANDARD'::text
--  event_registration_responses question_help_text_snapshot text                     YES  NULL
--  event_registration_responses redacted_at                 timestamp with time zone YES  NULL
--  event_registration_responses sensitive_consent_at        timestamp with time zone YES  NULL
--  events                       answers_legal_hold          text                     YES  NULL
--  events                       cancelled_at                timestamp with time zone YES  NULL
--  events                       eve_questions_enabled       boolean                  NO   false

-- 2. Constraints and index (expect 5 rows, then 1 row)
SELECT conname FROM pg_constraint WHERE conname IN (
  'events_answers_legal_hold_chk', 'event_orders_answers_legal_hold_chk',
  'event_registration_questions_data_category_chk', 'event_registration_responses_data_category_chk',
  'event_registration_responses_redaction_chk') ORDER BY 1;
SELECT indexname FROM pg_indexes WHERE indexname = 'idx_event_registration_responses_unredacted';

-- 3. Safe defaults: nothing enabled, held, cancelled-stamped, classified or redacted
SELECT count(*) AS events,
       count(*) FILTER (WHERE eve_questions_enabled) AS eve_on,          -- 0
       count(*) FILTER (WHERE cancelled_at IS NOT NULL) AS cancelled_at,  -- 0
       count(*) FILTER (WHERE answers_legal_hold IS NOT NULL) AS held     -- 0
FROM events;
SELECT count(*) FILTER (WHERE answers_legal_hold IS NOT NULL) AS held_orders FROM event_orders;   -- 0
SELECT data_category, count(*), count(template_key) FROM event_registration_questions GROUP BY 1; -- STANDARD | 6 | 0
SELECT data_category_snapshot, count(*), count(redacted_at), count(sensitive_consent_at), count(question_help_text_snapshot)
FROM event_registration_responses GROUP BY 1;                                                     -- STANDARD | 14 | 0 | 0 | 0

-- 4. Existing data unchanged: equal to the release-day baseline
SELECT count(*), md5(string_agg(id || ':' || answer::text, ',' ORDER BY id)) FROM event_registration_responses;
SELECT md5(string_agg(id || ':' || label || ':' || field_type || ':' || required || ':' || active, ',' ORDER BY id)) FROM event_registration_questions;
```

## Smoke checks after deploy

- Eve: LD Tennis Year 12 Graduation and School Test Community Test Event pages
  200; no question fields; still bookable (their questions are all optional);
  `questions` is `[]` in the event read.
- Riverlights still DRAFT ("This event isn't available").
- BrainBase registrations: manager sees School Test answers; no viewer exists.
- Paid checkout still 503 for brainbase / ld-tennis / school-test-organisation.
- `SELECT count(*) FROM events WHERE eve_questions_enabled` = 0.

## Rollback

- Before merge: run the ROLLBACK block in the script's header (nothing reads the
  columns yet).
- After merge: roll both Vercel projects back to the previous Production
  deployment first, then decide; prefer a forward fix. Never drop the columns once
  Eve has collected answers or retention has run (agreement times and redaction
  markers would be lost).

## Existing School Test answers

The 14 School Test answers keep category STANDARD (no reclassification by the
migration). With enforcement on they are removed 12 months after that event ends
(event ends 2026-12-01 → 2027-12-01). If the operator wants the health-adjacent
School Test questions (Accessibility, Dietary) treated as SENSITIVE, that is a
separate, reviewed data change (questions AND existing answer snapshots), not part
of this release. LD Tennis has 0 answers.
