# Selected worksheet preparation

The workbook preparation overview now offers an explicitly confirmed selection
of up to ten worksheets. Opening, selecting, filtering and reviewing the
confirmation perform no preparation. Confirmation lists every selected name and
physical worksheet position, including selections hidden by the current filter.
Selection changes invalidate the confirmation. Refreshing inventory clears it.

Starting the selection first reloads the existing authorized inventory, rejecting
missing, excluded or changed selected identities before any preparation POST.
The ephemeral browser queue uses physical worksheet order and one worksheet at
a time. Each worksheet starts with fresh staging, normalization and profile GETs.
It reuses completed steps and invokes only the next NOT_STARTED step through the
existing bodyless manager endpoint. Each successful POST is followed by three
fresh status reads before proceeding. At most three GETs or one POST are active.

The queue stops at the first running, failed, abandoned, inconsistent, not-ready
or yielded step; it never retries a POST or continues a yielded 202. Later
worksheets are not started. Single-worksheet preparation remains the explicit
recovery and continuation surface. A worksheet has a 65-second total budget;
the inventory has a 15-second budget, and the entire selection has a five-minute budget. There is
no polling, automatic retry, durable queue, background worker or resume on reload.

Stopping, navigating away, timing out, or receiving an uncertain response aborts
the browser wait and discards local readiness. Server work may still finish.
Before another queue can start, an explicit read-only Check preparation must
finish, even after an inventory refresh. Previously completed durable work is
preserved. Fresh status reads then allow a confirmed new selection to reuse it.
Scope denials clear inventory, selection and observations. Request identity and
abort guards prevent late responses from restoring old readiness.

The client does not supply actor, organisation, schema, mapping, review decisions
or lineage. Existing endpoints remain authoritative for tenant/manager access,
leases, lineage, interactive profile limits and idempotent reuse. This bundle
adds no endpoint, migration, preparation executor, analytical operation, AI call
or raw-value display. Each prepared worksheet still requires its own governed
field/quality review. A completed queue is not a saved review or authority to count.

## Verification

Transport/component checks cover selection limits, exclusions, duplicate names,
opaque identifiers, confirmation across filters, immutable admitted membership,
ordered calls, successful-step reuse, scope/inventory changes, yielded operations,
uncertain writes, late results, cancellation, deadlines and explicit recovery.
Automated accessibility checks cover selection, confirmation and completion.

The existing disposable PostgreSQL/built-browser acceptance package also creates
two raw-only fixtures by inspecting and staging synthetic XLSX bytes in setup.
The browser performs genuine normalization and profiling, verifies authenticated
actor and durable lineage with one attempt per operation, and confirms no review
or count executes. A deliberately delayed genuine successful profile POST proves
that stopping clears readiness, explicit GET recovery observes completion, and a
confirmed rerun adds no POST or duplicate attempt. Live role demotion between
selection and start fails before mutation. Mobile screenshots cover confirmation
and completion at 390px; the existing review/count/planning regressions also run.

The queue browser fixture begins after raw staging, using the existing setup-only
InMemoryFileStore. New raw staging is covered by queue transport tests and the
existing genuine staging integration proofs; it is not claimed as a browser
storage proof. Multi-worksheet ordering is verified by transport/component tests.
Hosted transport/storage, large-workload behavior, formal assistive-technology
qualification and authenticated Production acceptance remain separate. No merge,
deployment, Production mutation or configuration change is part of this bundle.
