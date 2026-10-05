# Assurance UI — Neon Preview smoke checklist (real Neon HTTP driver)

Purpose: prove the Assurance UI against the **real** `@neondatabase/serverless`
HTTP driver (local proofs use a pg-based seam that mirrors Neon's documented
composition semantics) before any Production enablement.

**Never run any step against Production.** Every SQL step targets a
*disposable* Neon branch created for this smoke only. Nothing here was
executed while preparing this branch.

## 0. Preconditions

- [ ] Branch `feat/assurance-ui-foundation` pushed and a Vercel **Preview** deployment built from it.
- [ ] A disposable Neon branch created **from the Preview branch** (not from Production), e.g.
      `smoke/assurance-ui-<yyyymmdd>`, and the Preview deployment's `DATABASE_URL` pointed at it.
- [ ] Confirm the disposable branch has A0.1B, A0.1C, A0.1D-1/2/3 and A0.1E-1 applied:
      re-run the same schema-fingerprint query used for the A0.1E-1 gate and expect
      `07cb4410d90e2910ea3c77637ef4d84a` for the Audit tables.
- [ ] Record the branch id here: `br-…` (for cleanup).

## 1. Capability, entitlement, fixture (disposable branch only)

Run in the Neon SQL editor **on the disposable branch**, one block per run:

```sql
-- a) capability registry row (grants nothing on its own)
<contents of scripts/seed-assurance-capability.sql>
```

```sql
-- b) synthetic demo organisation + scenario (enables 'assurance' and 'organiser'
--    for the demo org only)
SET assurance.demo_fixture = 'disposable-only';
<contents of scripts/assurance-demo/seed-assurance-demo.sql>
```

- [ ] Both succeed. `SELECT count(*) FROM assurance_audits WHERE organisation_id = 'assurance-demo-org';` → 2

## 2. Login / impersonation

- [ ] Sign in to the Preview as a **super_admin**.
- [ ] Impersonate "[DEMO] Riverside Shire Council (synthetic)" via the existing admin org switch (org_override).
- [ ] TopNav shows **Assurance** (capability pill). Sidebar order: Dashboard, Incidents, Investigations,
      Inspections, Audits, Findings, Actions, Evidence, Verification.

## 3. Screens (read path — exercises composed fragments + restricted predicates)

| Check | Route | Expect |
|---|---|---|
| [ ] Dashboard | `/assurance` | Overdue actions 1 (ACT-DEMO-003), awaiting verification 2, audits due 1, open audit findings 1, trend chart renders |
| [ ] Incident detail | `/assurance/incidents` → INC-DEMO-001 | 2 investigations (Primary INV-DEMO-001, Context INV-DEMO-002), 2 people, finding FND-DEMO-002 |
| [ ] Investigation detail | INV-DEMO-001 | Linked incidents INC-DEMO-001 (Primary) / INC-DEMO-002 (Related), "Also in 1 other investigation" |
| [ ] Inspection runner | INS-DEMO-001 | Checklist bound to **v1** with "newer version (v2)" notice; item 2 FAIL linked to FND-DEMO-001 |
| [ ] Inspection runner (live) | INS-DEMO-003 | Add an ad hoc item, save a response, page refreshes with it |
| [ ] Audit runner | `/assurance/audits` → AUD-DEMO-001 | Ratings Compliant / Partially compliant / Non-compliant / N/A / Observation; criterion 3 linked to FND-DEMO-004; partial criterion shows "no finding raised" notice |
| [ ] Audit plan (write) | `/assurance/audits/new` | Ad hoc without standard → clear error; with standard → created, start it, rate one criterion |
| [ ] Finding | FND-DEMO-001 | Chain: Source ✓ Finding ✓ Action ✓ Evidence ✓ Verification ✓ Closure "Explicit step"; **Close finding** succeeds |
| [ ] Action | ACT-DEMO-004 | Readiness "Ready to close" → **Close action** succeeds; FND-DEMO-004 stays open |
| [ ] Evidence | EVD-DEMO-003 | Link history shows the removed link with its reason |
| [ ] Verification | `/assurance/verification` | Queue shows ACT-DEMO-002; "You can verify" = Yes for the impersonating super_admin |

## 4. Restricted record test

Impersonation runs as super_admin (admin level), which **can** see restricted
records. To test the negative path you need a non-admin session in the demo org:

- [ ] Option A (preferred): an operator creates a throwaway password for
      `assurance-demo-viewer` through the normal admin user flow **on the disposable branch only**,
      signs in as that user, and confirms:
      INC-DEMO-003 is absent from `/assurance/incidents`, its URL shows "Record not found",
      and the dashboard shows 3 open incidents (not 4).
- [ ] Option B: skip the UI negative test and rely on the disposable-Postgres proof
      (`restricted records` suite) — record that it was skipped.

## 5. Unauthenticated API test

Preview deployments are SSO-protected, so run from a browser tab that has passed
Vercel SSO but is **signed out of BrainBase**:

```js
await fetch('/api/assurance/incidents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then(r => r.status)            // expect 401
await fetch('/api/assurance/audits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then(r => r.status)            // expect 401
```

- [ ] Both return **401**. `/assurance` redirects to `/login`.
- [ ] Signed in as a user whose org lacks the `assurance` entitlement: POST returns **403**, `/assurance` shows "isn't enabled".

## 6. Cleanup (disposable branch only)

```sql
SET assurance.demo_fixture = 'disposable-only';
<contents of scripts/assurance-demo/cleanup-assurance-demo.sql>
```

- [ ] Cleanup reports success (its final block fails loudly if demo rows remain or a history trigger is disabled).
- [ ] Delete the disposable Neon branch and repoint/destroy the Preview deployment.
- [ ] Record results (pass/fail per row above) in the PR.
