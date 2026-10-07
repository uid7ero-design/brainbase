# HR-8 read-only assistant

## Implementation scope

The People drawer can submit a question about the selected person to
`POST /api/hr/ai`. The server resolves the current authenticated session and
loads only a person the caller may view through the canonical HR relationship
predicate. Global role alone is not a person-access grant. The People module
capability remains required through the existing HR-specific capability helper.

The server chain is:

1. HR-8A: allowlisted person projection.
2. HR-8B: allowlisted visible lifecycle projection.
3. HR-8C: freshly materialized safe context envelope.
4. HR-8D: authorized tenant-scoped context loader.
5. HR-8E: fixed system prompt and bounded question serialization.
6. HR-8F: isolated provider adapter outside the HR domain; canonicalizes input
   again and submits a fixed-model, bounded-token request without tools.
7. HR-8G: authenticated HTTP transport, bounded actual request bytes, scoped
   rate limiting, generic errors, private no-store responses, answer text only.
8. HR-8H: explicit-submit Person drawer interface; plain-text answer rendering,
   generic errors, no automatic requests, request cancellation and state reset
   on selection changes or drawer closure.
9. HR-8I: composed-chain tests and this operational boundary record.

Person context contains display name, job title, worker type, employment status,
team name and manager first name. Lifecycle context contains lifecycle type,
status, and visible task titles/statuses. IDs, contacts, surnames as standalone
fields, dates, descriptions, assignees, approval metadata, documents, restricted
cases, grants and audit data are excluded from the structured context. The
general AI SQL engine continues to deny HR tables.

## Transport and client behavior

The request accepts exactly `person_id` and `question`. Questions must be
nonempty after trimming and at most 2,000 characters; actual body bytes are
limited to 16,384, including requests without Content-Length. The existing
in-memory limiter allows 20 requests per trusted organisation/user per hour.

Responses contain either `{ answer: string }` or a generic `{ error: string }`.
Authentication failures return 401, invalid input 400, inaccessible/missing
records and module denials 404, rate-limit failures 429, capability lookup
failures 503, and other loader/provider failures 502. Provider/database error
details, questions and raw HR context are not logged by the route.

The provider answer is bounded to 6,000 characters. The UI validates the answer
shape and bound and renders it as text, never executable HTML or Markdown.
There is no browser persistence or conversation history. Every question reloads
authorized context; no previously supplied context is trusted from the client.

## Verification and limits

`hrAiChain.test.ts` executes the real route, loader, person-access predicate,
projections, context composition, input builder, rate limiter and provider
adapter. Session resolution, database-backed readers and external SDK transport
are replaced with synthetic fixtures. It proves the closed provider payload,
tenant/person query scope, linked employee/current manager/explicit HR admin
access, unlinked/stale-manager/cross-tenant/restricted-only denials, capability
denial before reads, generic provider failures and bounded text responses.

The existing loader and lifecycle suites separately test canonical query and
visibility behavior. Component tests cover inert text, minimal request shape,
errors, retry, duplicate prevention and stale-answer cancellation. These tests
do not constitute a live database/provider smoke test or a populated browser
visual check. No live HR data or model calls were used for certification.

The limiter is process-local and resets on cold starts; it is not a distributed
cost quota. Free-text questions and allowlisted labels remain user-supplied
content, not a DLP boundary. The model's read-only and employment-decision
constraints are prompt instructions; generated answers can be incorrect and
must be checked against records. No model tools or mutation services are
attached. HR record mutation, consequential employment decisions, document and
restricted-case analysis are outside this section's scope.

## Release boundary

Main merges trigger automatic Vercel production deployments. HR-8G PR #403 was
merged at `6a51d3a7487875a0a6db75656d3b77f0010bfed1`; its automatic production
deployment was confirmed Ready on 7 October 2026. No production migration,
database mutation, environment update or live model request was performed in
this development session.

Further HR-8 merges are held because the user requires production to remain
untouched without explicit authorization. HR-8H and HR-8I can be reviewed and
validated in PR previews. Do not merge either while the automatic production
deployment linkage is active unless the user explicitly authorizes that effect
or authorizes a concrete change to the release configuration. Do not silently
roll back the shared production application.
