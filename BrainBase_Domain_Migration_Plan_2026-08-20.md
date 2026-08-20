# BrainBase Domain Migration Plan — hlna.com.au → thebrainbase.com.au

**Date:** 2026-08-20
**Status:** Preparation only. No DNS, Vercel, Resend, Microsoft 365/Google Workspace, database, or application-code change has been made as a result of this document.

**Non-negotiable constraints for the whole migration:**
- `hlna.com.au` must remain fully operational throughout — it is never disabled, redirected, or retired until an explicit, separately-approved later stage.
- LD Tennis (`ldtennis.com.au`) must remain completely untouched by this migration. Its Route 53 zone, Resend verification, and its own `LD_TENNIS_EMAIL_FROM`/`LD_TENNIS_MAIL_TO` configuration are entirely separate from everything in this document.

This document is based on a repository audit of `origin/main` (HEAD `7c09a9c5443c14dbf23bce1fa940188742c9f554` at the time of writing) plus the current known Production/Vercel/DNS state as supplied by James. No secrets, API keys, or customer PII are recorded anywhere below.

---

## 1. Current Known State

**BrainBase:**
- Current primary public domain: `hlna.com.au`
- Target purchased domain: `thebrainbase.com.au`
- Production Vercel project: `brainbase`
- Current Vercel domains include: `hlna.com.au`, `www.hlna.com.au`, `app.hlna.com.au`, `ldtennis.com.au`, `www.ldtennis.com.au`, `brainbase-omega.vercel.app`

**LD Tennis (reference only — not in scope for this migration):**
- `ldtennis.com.au` is managed via AWS Route 53
- Resend domain verification is complete
- LD Tennis email sender configuration is already separated from BrainBase's (`LD_TENNIS_EMAIL_FROM`/`LD_TENNIS_MAIL_TO`, shipped `fix/ld-tennis-email-config`, merged to main as PR #22)

---

## 2. Domain References Found In Code

| File | Line / context | Current value | Must change for thebrainbase.com.au? | Keep temporarily for back-compat? |
|---|---|---|---|---|
| `lib/emailConfig.ts:29` | `DEFAULT_GENERIC_TO` fallback | `hello@hlna.com.au` | Yes, eventually (code-level fallback only — dormant if `MAIL_TO` is set in Vercel) | Yes — safe to leave until `MAIL_TO` itself is deliberately repointed |
| `lib/email.ts:9` | `FROM` fallback | `Brainbase <noreply@brainbase.app>` | Yes, eventually | Yes — dormant if `EMAIL_FROM` is set |
| `app/api/news/route.ts:43` | User-Agent contact string for the news aggregator fetch | `hello@hlna.com.au` | Cosmetic only, low priority | Yes, indefinitely — no functional effect |
| `public/email-signature.html:100,105,111` | Static signature-generator page (not linked from app UI, but served at `/email-signature.html`) | `hello@hlna.com.au`, `https://brainbase.com.au` | Yes, once real addresses exist | Not required — purely a personal tool |
| `app/terms/page.tsx:82`, `app/privacy/page.tsx:92,104` | Legal contact links | `legal@brainbase.app`, `privacy@brainbase.app` | Decision needed | — |
| `app/api/leads/[id]/route.ts:18` | `APP_URL` fallback (LD-Tennis lead cancel-link) | `https://brainbase.com.au` | **Flag, don't just change** — see anomaly below | — |
| `lib/email.ts:38`, `app/api/auth/verify-email/route.ts:5`, `app/api/upload/route.ts:72` | `NEXT_PUBLIC_APP_URL` reads, all with `http://localhost:3000` fallback | Env-driven, no hardcoded Production domain | This is the **one env var** that drives every auth/reset/verify link | Update in lockstep with cutover (Stage F/G) |
| `app/api/hlna/run`, `.../upload`, `.../admin/founder-*` (8 files) | `NEXT_PUBLIC_API_URL` | Env-driven, points at a **separate external DigitalOcean backend**, not this app's own domain | No — unrelated to this migration | — |
| OAuth callback routes (`instagram`, `gcal`, `gmail`, `spotify`) | `META_REDIRECT_URI`, `GCAL_REDIRECT_URI`, `GMAIL_REDIRECT_URI`, `SPOTIFY_REDIRECT_URI` | Env-driven, no hardcoded domain in code | **Yes** — but the change is external (each provider's own developer console), not this repo | Old redirect URIs should stay registered until cutover |

No hits anywhere in the repository for `thebrainbase.com.au` — expected, since it isn't wired into the app yet.

### ⚠️ Anomaly: a third domain already exists in code — `brainbase.com.au`

The codebase contains a **third** BrainBase-related domain, `brainbase.com.au` (no "the"), distinct from both today's primary (`hlna.com.au`) and the target (`thebrainbase.com.au`). It is the fallback value for `APP_URL` in `app/api/leads/[id]/route.ts` (used to build the LD-Tennis lead's "cancel your enquiry" link) and also appears in `public/email-signature.html`'s website link. This domain was not mentioned in the supplied "current known state" domain list at all.

It is not known whether `brainbase.com.au` is a domain actually owned/controlled, a stale placeholder, or an earlier working name. **This should be confirmed before touching `APP_URL`** — if that env var is currently unset in Vercel, LD Tennis customers' cancel-links are silently pointing at this third domain today, independently of this migration.

---

## 3. Vercel / Routing Findings

- No direct Vercel dashboard/API access was used — the domain-to-project mapping above is taken as given, not independently verified from the repository.
- `middleware.ts` contains **exactly one** hostname-specific branch, and it is for LD Tennis only: requests to `ldtennis.com.au` or `www.ldtennis.com.au` at path `/` redirect to `/tennis`. There is **no equivalent branch for `hlna.com.au`, `www.hlna.com.au`, or `app.hlna.com.au`** anywhere in the codebase.
- `/dashboard`, `/admin/founder`, `/command`, auth, and every API route are gated by **role and path only** — none inspect or branch on hostname.
- `app.hlna.com.au` has **no special semantics anywhere in code** — no hostname check, no distinct routing, no distinct app instance.
- Session cookies (`lib/session.ts`) have **no `domain` attribute set** — they default to host-only. A session established on `hlna.com.au` will not be recognised on `thebrainbase.com.au` (or `app.hlna.com.au`) until a user logs in again there — expected during any dual-domain period, not a bug.
- Given the above, `thebrainbase.com.au` can be added to Vercel as an additional domain alongside `hlna.com.au` with **zero application code changes required**.

---

## 4. BrainBase Email Findings

1. No route currently sends *from* an `hlna.com.au` address. The code-level default sender (when `EMAIL_FROM` is unset) is `Brainbase <noreply@brainbase.app>`.
2. Replies can land in an `hlna.com.au` inbox by fallback: `MAIL_TO`'s code default is `hello@hlna.com.au`, used for the demo-request recipient and the founder-pipeline-reply `replyTo`. The actual configured Vercel values for `EMAIL_FROM`/`MAIL_TO` are not visible from the repository.
3. Env vars that will eventually need updating: `EMAIL_FROM`, `MAIL_TO`, `ADMIN_EMAIL` (web-services lead recipient), `NEXT_PUBLIC_APP_URL` (every auth link), and — pending the anomaly decision above — `APP_URL`.
4. `thebrainbase.com.au` **can** be verified in Resend before changing any sender values — domain verification (DNS records) is independent of which `from` address code currently uses, exactly as already proven safe for `ldtennis.com.au`.
5. Sender addresses to prepare: `hello@thebrainbase.com.au` (mirrors today's `hello@hlna.com.au`) and `noreply@thebrainbase.com.au` (mirrors today's `noreply@brainbase.app`).
6. `noreply@thebrainbase.com.au` only needs Resend verification — no mailbox required. `hello@thebrainbase.com.au` is used as a real `replyTo` target and needs an actual monitored mailbox.
7. `hello@hlna.com.au` should keep receiving throughout the transition and for a defined grace period after cutover.

---

## 5. Auth / Absolute URL Findings

- `verificationEmail()`, `passwordResetEmail()` (both `lib/email.ts`), and `app/api/auth/verify-email/route.ts`'s post-verify redirect all build links from a single source: `process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'`. No hardcoded Production domain anywhere in the auth-link code paths.
- The admin "invite" flow doesn't use a separate magic-link mechanism — it sends the same `verificationEmail()`, so it's covered by the same lever.
- Demo requests and pipeline replies don't generate any user-facing absolute link at all.
- The one inconsistency: the LD-Tennis cancel-link uses a *different* env var (`APP_URL`, not `NEXT_PUBLIC_APP_URL`) with its own fallback (`https://brainbase.com.au`) — see the anomaly above.
- **Dual-domain operation is safe** based on code evidence: no middleware hostname branch treats `hlna.com.au` specially. The only caveats are UX, not breakage: link-generation reads one fixed env var rather than the incoming request's host, and sessions are host-only cookies — so during the parallel-domain period a user may receive a working link back to the "other" domain, and logging in on one domain won't carry over to the other. Neither is a security issue.

---

## 6. thebrainbase.com.au DNS Preparation

Mirroring the proven `ldtennis.com.au` pattern. **No AWS changes have been made — this is a checklist only.**

**Website (Route 53, once thebrainbase.com.au's zone exists there):**
- Apex/root — A record (or ALIAS) → *copy the exact target Vercel shows when the domain is added in the Vercel dashboard.*
- `www` — CNAME → *copy the exact target Vercel shows for `www.thebrainbase.com.au`.*
- `app.` subdomain — decision deferred (see §7 below); no record needed unless created.

**Email (Resend), once domain is added in Resend:**
- DKIM TXT at `resend._domainkey.thebrainbase.com.au` — *value supplied by Resend at verification time, not invented here.*
- MX at `send.thebrainbase.com.au` — *target supplied by Resend.*
- SPF TXT at `send.thebrainbase.com.au` — *value supplied by Resend.*
- DMARC TXT at `_dmarc.thebrainbase.com.au` — *policy value; reconcile with the eventual mailbox-provider's DMARC requirements too, not just Resend's.*
- Optional, later: mailbox-provider verification/MX records (Microsoft 365 or Google Workspace) — deferred until the provider decision (§8) is made, since it directly affects where the root MX record points.

---

## 7. app.hlna.com.au Recommendation

**Retain temporarily. Do not prioritise migrating it to `app.thebrainbase.com.au`.**

There is no hostname branch, no distinct routing, and no distinct app instance for the `app.` subdomain anywhere in the code — it appears to serve the exact same Next.js app as the apex domain, with no code-level reason for the split to exist under the current single-app architecture (the public marketing pages and the authenticated app already coexist on one domain, mirrored on `ldtennis.com.au` too). It may be a precautionary domain added early and never used, or something bookmarked/linked externally with no repo visibility. Recommend confirming via Vercel analytics/access logs before deciding between "deprecate later" and "redirect to thebrainbase.com.au," rather than deciding without that data.

---

## 8. Microsoft 365 / Google Workspace Notes

No pricing included — none was available as repository evidence.

| | Microsoft 365 | Google Workspace |
|---|---|---|
| Mailbox hosting | Exchange Online — full inbox/calendar for `hello@thebrainbase.com.au` etc. | Gmail — same, via Workspace |
| MX implications | Requires the root domain's MX record to point at Microsoft's mail servers (exact value from the M365 setup wizard) | Requires root MX pointed at Google's servers (exact values from the Workspace setup wizard) |
| Coexistence with Resend sending | **Yes, safe** — Resend's DNS pattern (already proven on `ldtennis.com.au`) puts its MX/SPF/DKIM on a `send.` subdomain, not the apex, specifically so it never competes with a real mailbox provider's MX at the root. |
| Recommended separation | Keep `noreply@thebrainbase.com.au` purely on Resend (sending-only, no mailbox). Keep `hello@thebrainbase.com.au` (and similar human-facing addresses) as a real mailbox in whichever provider is chosen. Don't route transactional app email through the mailbox provider's SMTP — keep Resend as the single transactional sending path. |

Neither provider is distinguished by anything in repository evidence — the choice is organisational, not technical.

---

## 9. Migration Risk Register

| Risk | Level | Mitigation | Verification step |
|---|---|---|---|
| Web downtime | Low | Adding `thebrainbase.com.au` to Vercel is purely additive (Stage B); never remove `hlna.com.au` until Stage H | Load both domains in a browser after each DNS/Vercel change |
| DNS delegation mistakes (wrong nameservers/zone) | Medium | Confirm the Route 53 hosted zone for `thebrainbase.com.au` matches the registrar's nameserver delegation before adding any record | `dig NS thebrainbase.com.au` resolves to the expected Route 53 nameservers before proceeding |
| SSL/domain validation delays | Low–Medium | Vercel auto-provisions certs once DNS resolves correctly; budget for propagation time | Vercel dashboard shows the domain as "Valid Configuration" with an issued cert |
| Authentication links pointing at the wrong domain mid-migration | Medium | Don't flip `NEXT_PUBLIC_APP_URL` until Stage F/G, after web+DNS+SSL are all confirmed on the new domain | Trigger a real password-reset/verification email and click the link end-to-end before flipping the env var |
| Password-reset links specifically | Medium | Same as above — most safety-sensitive links in the app | Same verification |
| Stale canonical/OG URLs | Low | None exist in the repo today, so nothing stale to fix, but nothing to guard if added later | Grep repeated after any future metadata work |
| Email deliverability during transition | Medium | Verify `thebrainbase.com.au` in Resend well before switching `EMAIL_FROM`; send test emails to multiple providers before relying on it | Resend dashboard shows domain "Verified"; test sends land in inbox, not spam |
| SPF/DMARC conflicts | Medium–High | Only one SPF TXT record per domain is valid — a mailbox provider's SPF include must be merged into the *same* TXT record as Resend's, not a second competing one | `dig TXT thebrainbase.com.au` shows exactly one SPF record listing all authorised senders |
| Changing MX before mailbox provider is ready | High | Do not touch the root MX record until Microsoft 365/Google Workspace setup is fully ready to receive | Confirm mailbox provisioned and test-inbound-mail received before any MX cutover |
| Redirect loops | Low | Not relevant until Stage H; test the redirect rule against every known path pattern before enabling broadly | Manually load 5–10 representative URLs after enabling the redirect |
| app.hlna.com.au | Low | No code depends on it; safe to leave untouched indefinitely | N/A until a deprecation decision is made |
| Hardcoded hlna.com.au references (email fallbacks, signature file, news UA string) | Low | All are dormant fallbacks or non-critical cosmetic text | Grep sweep after each future code change |
| LD Tennis accidental cross-impact | Low | LD Tennis is on its own Route 53 zone, its own Resend-verified domain, its own `LD_TENNIS_EMAIL_FROM`/`LD_TENNIS_MAIL_TO` env vars — no shared code path found that a BrainBase domain change would touch | Confirm `resolveEmailConfig()`'s `LD_TENNIS_ORG_ID` branch is unaffected by any BrainBase env var change (it isn't — different var names entirely) |
| Vercel environment scope mistakes (Preview vs Production) | Medium | Any new/changed env var must be scoped correctly — an accidental Preview-scoped `NEXT_PUBLIC_APP_URL` pointing at the new domain could send Preview-generated auth links to Production | Check the Vercel env var's environment scope explicitly before saving, every time |

---

## 10. Staged Migration Plan

Design only — **no stage has been executed.**

- **Stage A — Prepare `thebrainbase.com.au`**: confirm registrar ownership, confirm/create the Route 53 hosted zone, confirm nameserver delegation.
- **Stage B — Add it to Vercel alongside hlna.com.au**: add `thebrainbase.com.au` and `www.thebrainbase.com.au` as additional domains on the existing `brainbase` project. No removal of any existing domain.
- **Stage C — Verify web and HTTPS**: confirm DNS resolves, Vercel issues a valid cert, the site loads correctly end-to-end (including login, since sessions are host-only).
- **Stage D — Verify thebrainbase.com.au in Resend**: add the domain in Resend, add its DKIM/SPF/MX/DMARC records to Route 53, wait for "Verified." Zero effect on current sending.
- **Stage E — Prepare BrainBase-specific email variables**: decide final values for `EMAIL_FROM`/`MAIL_TO` (and reconcile the `brainbase.com.au`/`APP_URL` anomaly) — do not apply to Vercel yet.
- **Stage F — Update canonical/public-facing URLs**: none exist today, but this is the checkpoint to add `metadataBase`/canonical/OG tags if desired, and to decide the `NEXT_PUBLIC_APP_URL`/`APP_URL` cutover moment.
- **Stage G — Change primary/brand identity**: flip `NEXT_PUBLIC_APP_URL` (and `EMAIL_FROM`/`MAIL_TO` if ready) to `thebrainbase.com.au` values in Vercel Production. First stage with real user-facing behaviour change.
- **Stage H — Redirect hlna.com.au only after validation**: once Stage G is confirmed stable, add a redirect from `hlna.com.au`/`www.hlna.com.au` to `thebrainbase.com.au` — never before.
- **Stage I — Retain old email/domain compatibility for a defined period**: keep `hello@hlna.com.au` monitored, keep `hlna.com.au`'s Resend verification and DNS intact, for an explicitly agreed grace period (recommend 90 days minimum) before any retirement conversation.

---

## 11. Exact Tomorrow Checklist

**SAFE TO DO FIRST (additive, verification, parallel-domain testing — no risk to hlna.com.au):**
1. Confirm registrar/Route 53 zone for `thebrainbase.com.au` exists and nameservers are correctly delegated.
2. Add `thebrainbase.com.au` + `www.thebrainbase.com.au` as domains on the Vercel `brainbase` project (alongside existing domains, none removed).
3. Add the A/CNAME records Vercel provides for the new domain to Route 53.
4. Wait for DNS propagation and Vercel's automatic SSL issuance; confirm "Valid Configuration" in Vercel.
5. Load `thebrainbase.com.au` in a browser — confirm the site renders, `/login` works, and the dashboard is navigable (a fresh login will be required — expected, host-only cookie).
   - **Rollback point 1:** if anything above misbehaves, simply don't proceed — `hlna.com.au` is completely unaffected; remove the new domain from Vercel if desired.
6. Add `thebrainbase.com.au` to Resend, add its DKIM/SPF/MX/DMARC records to Route 53.
7. Wait for Resend to report "Verified."
8. Send a real test email through Resend's own test-send feature (not through the app) using the new domain, confirm it lands correctly.
   - **Rollback point 2:** none needed — verification alone changes nothing live.

**DO LAST (only after everything above is confirmed working):**
9. Decide and finalise `hello@thebrainbase.com.au` / `noreply@thebrainbase.com.au` as the intended sender/recipient values.
10. Update `EMAIL_FROM` / `MAIL_TO` in Vercel Production to the new addresses.
    - **Rollback point 3:** revert the two env var values back to their current settings if any email flow misbehaves.
11. Update `NEXT_PUBLIC_APP_URL` in Vercel Production to `https://thebrainbase.com.au`. Trigger one real password-reset and one real verification email immediately after, click both links end-to-end.
    - **Rollback point 4:** revert `NEXT_PUBLIC_APP_URL` back to the `hlna.com.au` value if either link is malformed or points somewhere unexpected.
12. Resolve the `APP_URL`/`brainbase.com.au` anomaly — decide its correct value and set it explicitly in Vercel rather than relying on its current fallback.
13. Only after steps 9–12 have been stable for a period judged sufficient: add the `hlna.com.au` → `thebrainbase.com.au` redirect.
    - **Rollback point 5:** removing the redirect rule immediately restores `hlna.com.au` to serving the app directly.
14. Do **not** remove `hlna.com.au`'s Vercel domain, Route 53 records, or Resend verification at all — that remains out of scope until Stage I's defined grace period has passed.

---

## 12. Rollback Plan

Every stage is designed so the previous stage's rollback is simply "stop, don't proceed, revert the one thing just changed" — the plan is strictly additive until Stage G/H:

- **Stages A–D** (DNS/Vercel/Resend additions for the new domain): rollback = remove the newly-added domain/DNS records; `hlna.com.au` was never touched.
- **Stages E–F** (env var value decisions, not yet applied): rollback = simply don't apply them.
- **Stage G** (env var cutover): rollback = revert `EMAIL_FROM`/`MAIL_TO`/`NEXT_PUBLIC_APP_URL` to their exact current values — no code change involved, so no deploy/merge to undo.
- **Stage H** (redirect): rollback = remove the redirect rule; `hlna.com.au` immediately resumes serving the app directly since its Vercel domain/DNS were never removed.
- **Stage I**: by design, nothing to roll back — it's the "leave old stuff running" stage.

---

## 13. Checkpoint Update Recommendation (Not Applied Tonight)

Once migration is actually complete, `BrainBase_Current_State_2026-08-20.md` should gain a new **§15 Domain Migration — hlna.com.au → thebrainbase.com.au** section documenting (mirroring how its existing §10 documents the LD Tennis domain): the final confirmed Route 53/Vercel/Resend state for `thebrainbase.com.au`; the exact date `EMAIL_FROM`/`MAIL_TO`/`NEXT_PUBLIC_APP_URL` were cut over; the `app.hlna.com.au` and `brainbase.com.au`/`APP_URL` decisions actually made; the redirect status of `hlna.com.au`; and an updated "Immediate Recommended Next Steps" section reflecting the new post-migration priorities. **This file was not modified as part of producing this migration plan.**

---

## 14. Safety Confirmation

- No code changed.
- No DNS changed.
- No Vercel settings changed.
- No Resend settings changed.
- No env vars changed.
- No database changes.
- No deployment.
- No merge to main.
- LD Tennis untouched — no LD Tennis file, config, DNS, or env var was modified. `hlna.com.au` remains fully operational and untouched; nothing in this plan disables, redirects, or retires it.
