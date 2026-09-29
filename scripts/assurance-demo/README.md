# Assurance synthetic demo fixture

Test/demo only. **Never run against Production.** Use a local database, a
Neon dev/disposable branch, or the disposable harness.

## What it creates

One organisation, `assurance-demo-org` — "[DEMO] Riverside Shire Council
(synthetic)" — with five demo users (`assurance-demo-*`, no passwords), and a
connected municipal scenario:

| Chain | Records | State to look at |
|---|---|---|
| Inspection → finding → action → evidence → verification | INS-DEMO-001 → FND-DEMO-001 → ACT-DEMO-001 → EVD-DEMO-001/002 (+ removed EVD-DEMO-003 link) → verification #1 rejected, #2 accepted | Action **closed**; finding deliberately still **awaiting verification** (closing an action never closes its finding). Template now at v2; INS-DEMO-001 still shows v1. |
| Incident → investigation → finding → action | INC-DEMO-001 + INC-DEMO-002 → INV-DEMO-001 (and INV-DEMO-002, completed) → FND-DEMO-002 → ACT-DEMO-002 (contractor, extended deadline, awaiting verification) + ACT-DEMO-003 (overdue) | Verification queue, overdue work, M:N links |
| Audit → finding → action → evidence → verification | AUD-DEMO-001 (template ATP-DEMO-001 v1, "Synthetic Waste Operations Procedure v1"): Compliant / Partially compliant / **Non-compliant** / Not applicable / Observation → FND-DEMO-004 → ACT-DEMO-004 → EVD-DEMO-006/007 → verification accepted | Action verified but **not closed** (closure is explicit); the partial criterion deliberately has no finding. AUD-DEMO-002 is a planned ad hoc contractor audit (dashboard "audits due"). |
| Other | INS-DEMO-002 planned (due in 3 days), INS-DEMO-003 ad hoc in progress → FND-DEMO-003, INC-DEMO-003 **restricted**, INC-DEMO-004 closed, INC-DEMO-005 just reported | Dashboard attention, restricted visibility |

Suggested walkthrough: Dashboard → ACT-DEMO-002 (verify as the WHS advisor
persona, then close) → FND-DEMO-001 (close it) → INS-DEMO-001 (checklist v1,
failed item, linked finding) → AUD-DEMO-001 (criteria ratings, raised finding) → ACT-DEMO-004 (close it) → INC-DEMO-001 (two investigations).

## Seed

```sql
SET assurance.demo_fixture = 'disposable-only';
\i scripts/assurance-demo/seed-assurance-demo.sql
```

In the Neon SQL editor, paste the `SET` line followed by the file contents in
one run. Requires A0.1B + A0.1C + A0.1D-1/2/3 + A0.1E-1 (Audit). It registers the
`assurance` module key if missing and enables it for the demo organisation only.

To view: sign in as a super_admin and impersonate the demo organisation.

## Remove

```sql
SET assurance.demo_fixture = 'disposable-only';
\i scripts/assurance-demo/cleanup-assurance-demo.sql
```

Deletes only `assurance-demo-org` rows. It briefly disables the
verification append-only and inspection/audit template-version immutability triggers inside a
single transaction and re-enables them before commit (verified by
`scripts/tests/verify-assurance-ui-services.sh`).
