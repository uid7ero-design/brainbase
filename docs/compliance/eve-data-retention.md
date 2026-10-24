# Eve data retention, access, correction and erasure (internal)

Status: **DRAFT — retention periods PENDING LEGAL/ACCOUNTING APPROVAL.**
Nothing in this document is a public statement. It records what the system does
today so that the public Privacy Policy never claims more than exists.

**Public policy (Phase 3.6, draft):** the published Privacy text is principle-based only (kept for as long as reasonably required for the stated purposes, operational needs, dispute handling and legal obligations; may be deleted or de-identified when no longer required) and promises no fixed period and no automated deletion. The 7-year financial-record period is a recommendation pending accountant confirmation and is NOT published; it can be finalised before paid events launch. The per-category periods below are internal recommendations only and are NOT published. Registration-answer timers are implemented (`RETENTION_POLICY`) but, since 2026-10-24, the Privacy Policy describes them by purpose only, with no exact period (ADR 0013 §4c).

**There is no automated retention, anonymisation or erasure for event, order,
attendee or registration-answer data.** Nothing is deleted by a schedule. The
only things that expire by themselves are listed in the last two rows.

## 1. Inventory

| Category | Where | What it holds | Behaviour today | Retention period |
|---|---|---|---|---|
| Orders and payment snapshots | `event_orders`, `event_order_items` | purchaser name/email/phone, amounts, fee and refund snapshot, Stripe checkout/payment/account identifiers, product (`EVE`/`BRAINBASE`), and for paid Eve orders the time and versions of the Terms and Refunds policy accepted (`terms_accepted_at`, `terms_version`, `refunds_version`; written once, never edited) | kept indefinitely; cancelled/expired/refunded orders stay | PENDING LEGAL/ACCOUNTING APPROVAL (financial records) |
| Attendees and tickets | `event_attendees` | attendee name, optional email, ticket token, check-in time and checker | kept indefinitely | PENDING LEGAL/ACCOUNTING APPROVAL |
| Registration answers | `event_registration_responses` | organiser-defined answers with snapshots of the question wording, type and category (STANDARD / SENSITIVE / THIRD_PARTY / CONSENT), and the Eve buyer's agreement time for SENSITIVE / THIRD_PARTY answers | answer value removed by the daily retention job (`lib/events/answerRetention.ts`): THIRD_PARTY 7 days after event end, SENSITIVE 30 days, STANDARD 12 months, CONSENT 3 years; cancelled event: SENSITIVE / THIRD_PARTY 7 days after cancellation; legal hold (event/order) pauses it; row keeps structure only. Never copied to CRM; not in emails or exports; manager+ only | APPROVED by operator 2026-10-24 (ADR 0013 §4b); PENDING LEGAL REVIEW of the Privacy wording; enforcement off until `EVE_ANSWER_RETENTION_ENFORCE=true` |
| Email delivery records | `event_ticket_email_deliveries` | order id, provider message id, delivery status and timestamps (no address) | kept indefinitely | PENDING |
| Lifecycle notifications | `event_notifications` | recipient email, type, status, provider message id; for event-change notices a buyer-safe payload of the old/new date, time and venue | kept indefinitely | PENDING |
| CRM contacts | `crm_contacts`, `crm_activities` | buyer name/email/phone copied best-effort at booking, a fixed note and an activity line | kept until an organiser staff member deletes the contact; deletion does not remove the order | PENDING |
| Organiser accounts | `users` | username, password hash, name, role, status | kept until an administrator removes the user | PENDING |
| Eve sessions | `ticketing_sessions` | session id, user, organisation, times | expire after 8 hours; up to 100 long-expired rows pruned on each sign-in | 8 hours (+ pruning); operational |
| Rate-limit counters | `ticketing_rate_limits` | hashed key, window, count | expire with their window; ~1% of calls prune expired rows | operational (≤ window length) |
| Audit logs | `audit_logs` | actor, action, resource, masked recipient, IP/user-agent where recorded | kept indefinitely; never edited to hide evidence | PENDING (security/audit) |
| Database history | Neon point-in-time history | all of the above | provider-managed (project history retention is currently 6 hours) | provider setting |

## 2. Operational process for individual requests (manual)

All requests arrive at `support@eveevents.com.au` and are handled by a person.
Target response time: **[SUPPORT RESPONSE TIME — to be set]**.

1. **Verify the requester.** Match the request to an order using the order
   reference or the email address on the booking. Do not release information to
   someone who cannot show they are the purchaser or attendee. The ticket and
   booking links are bearer links: possession of a link is not identity.
2. **Access request.** An administrator exports the purchaser's records from the
   order, attendee and (if any) registration-answer tables for that person only.
   Organiser-held copies (CRM contact, the organiser's own records) are the
   organiser's responsibility; point the requester to the Event Organiser.
3. **Correction request.** An administrator corrects the name/email/phone on the
   order and attendee rows (and asks the organiser to correct any CRM copy).
   Ticket tokens are not regenerated unless the requester asks.
4. **Deletion / erasure request.**
   - Free registrations with no financial record and a past event: an
     administrator may delete or de-identify the attendee, order and answer rows
     once the Event Organiser confirms they have no need for them.
   - Orders with a payment, refund or tax record: **do not delete.** De-identify
     only what is lawful to de-identify and keep the financial fields. Record the
     decision.
   - CRM contact copies: an organiser staff member deletes the contact.
   - Anything under a legal hold, dispute or open refund is retained.
5. **Legal/accounting conflicts.** Where a record must be kept for financial
   record-keeping, tell the requester what is kept and why, and that the rest
   has been handled. Escalate unclear cases to counsel.
6. **Record the request** and the outcome in a private log (no personal data
   beyond the order reference).

## 3. Open decisions (need counsel/accountant)

- Retention period for each category in §1.
- Whether registration answers should be deleted on a fixed schedule after the
  event.
- Whether CRM copies should be removed automatically when an order is erased.
- Whether to build self-service access/erasure tooling.
