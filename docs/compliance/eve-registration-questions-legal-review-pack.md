# Eve registration questions — legal / privacy review pack

**Status:** FOR EXTERNAL LEGAL REVIEW · prepared 2026-10-24 · nothing in this pack is live.
The wording below is in draft PR #483 (not merged). Merging publishes the Privacy Policy
text. The "last updated" date is **not** changed yet; it will be set on the actual
publication day (the policy currently shows 22 October 2026).

**What the feature does.** Event Organisers can add their own questions to an event's
booking form on Eve (eveevents.com.au) — for example accessibility needs, or "how did you
hear about this event". The organiser classifies each question into one of four categories
(STANDARD, SENSITIVE, THIRD_PARTY, CONSENT). The category decides the notice the buyer
sees, whether a separate acknowledgement is required, and how long the answer is kept.
Built-in templates (accessibility, dietary, emergency contact, photo consent) carry a fixed
category the organiser cannot lower. Nothing is ticked for the buyer. Answers never go to
CRM/contact records, emails, exports, marketing or other buyers.

---

## A. Privacy Policy — proposed sections 2, 3, 4, 5 and 8 (exact text)

Marking: **[NEW / CHANGED]** = new or reworded paragraph; _(unchanged)_ = as currently
published; **[REMOVED]** = currently published paragraph that would be removed. Generated
from the code (`apps/eve/content/legal.ts`) against the published version, not retyped.

#### 2. What we collect

- **[NEW / CHANGED]** If you book a ticket: your name, email address and optional phone number; each attendee's name; any promotion or access code you enter; and your answers to any registration questions the Event Organiser asks for that event (see section 5).
- _(unchanged)_ If you are an Event Organiser or team member: your username, a one-way hash of your password (never the password itself), your name, role, sign-in times and session records.
- _(unchanged)_ When tickets are checked in: the time of check-in and the organiser staff member who recorded it.
- _(unchanged)_ Technical data: our hosting provider's logs record technical request details such as your IP address. We also use hashed identifiers to limit repeated requests.
- _(unchanged)_ If you buy a paid ticket: the amount and currency and the order details; the references Stripe gives us for the checkout and the payment, and the refund status if a refund is made; and when you agreed to the Terms and the Refunds & cancellations policy and which version of each you agreed to. Your card details go directly to Stripe and are not seen or stored by us.
- **[REMOVED]** ~~If you book a ticket: your name, email address and optional phone number; each attendee's name; and any promotion or access code you enter. Eve's booking form does not currently ask registration questions, so we do not currently collect answers to them (see section 5).~~

#### 3. Why we use it

- _(unchanged)_ To process bookings and, for paid tickets, payments and refunds; to issue and deliver tickets; to send booking confirmations and event notices (such as cancellation, event-change and, where the Event Organiser has switched them on, reminder emails); to run organiser accounts and keep them secure; to prevent abuse; and to meet legal obligations.
- **[NEW / CHANGED]** Answers to registration questions are used to run that event, for example catering, access arrangements or contacting someone in an emergency.
- _(unchanged)_ We do not currently send marketing email or use your booking details for marketing, and agreeing to the Terms is not consent to marketing.

#### 4. Who we share it with

- _(unchanged)_ The Event Organiser. Your booking details are provided to the Event Organiser so they can administer the booking and communicate with you about the event. Your name, email address and phone number may also appear in the organiser's event contact records on our platform. This does not give anyone your consent to marketing. The Event Organiser handles that information under its own privacy practices.
- **[NEW / CHANGED]** Answers to registration questions go to the Event Organiser for that event. On our platform they can be seen only by the organiser's team members with a manager or administrator role, and by our own authorised administrators where that is needed for support or legal reasons. They are not added to the organiser's contact records, not included in ticket emails, and not used for marketing. The Event Organiser handles the answers it receives under its own privacy practices, including any copies it makes.
- _(unchanged)_ Our service providers: Vercel (hosting), Neon (database hosting) and Resend (email delivery). For paid tickets, Stripe processes the payment through the Event Organiser's Stripe account as an independent payment processor, under its own privacy policy. The Event Organiser can see the amount, payment status and refund status of paid bookings.
- _(unchanged)_ Where required or permitted by law.

#### 5. Registration questions and sensitive information  — **[HEADING CHANGED; was: 5. Sensitive information]**

- **[NEW / CHANGED]** Event Organisers may ask questions about their event when you book. You can leave a question marked optional blank.
- **[NEW / CHANGED]** Answers about accessibility or support needs may include health or disability information. Before you submit an answer to a question like this, we ask you to agree to the Event Organiser collecting it, and we record when you agreed. Nothing is ticked for you.
- **[NEW / CHANGED]** If you give another person's details, such as an emergency contact, please make sure they know you are giving their details to the Event Organiser for this event. Before you submit them, we ask you to confirm this, and we record that you confirmed. That confirmation is yours; it is not that person's consent.
- **[NEW / CHANGED]** Event Organisers should only ask for what they need to run the event.
- **[REMOVED]** ~~Eve does not currently show registration questions on its booking form, so it does not collect answers to them. If that changes, this policy will be updated first. Event Organisers who ask such questions elsewhere (for example about access or dietary needs) should only ask for what they need, because answers can reveal sensitive information such as health or disability.~~

#### 8. How long we keep information

- _(unchanged)_ We keep personal information only for as long as reasonably required for the purposes described in this policy, our operational needs, dispute handling and any applicable legal obligations. When it is no longer reasonably required, we may delete or de-identify it.
- **[NEW / CHANGED]** Answers to registration questions are removed on a set schedule after the event: another person's details (such as an emergency contact) about 7 days after; health, accessibility and other sensitive answers about 30 days after; a consent choice (such as for photography), where a record of it needs to be kept, about 3 years after; and other answers about 12 months after. If an event is cancelled, sensitive answers and other people's details are removed about 7 days after the cancellation. We keep an answer longer only where a complaint, incident, dispute or legal obligation requires it. Your booking, payment and ticket records are not affected by this schedule.
- **[NEW / CHANGED]** Deleted information may remain in our controlled backups for a limited period before those copies expire.
- **[NEW / CHANGED]** Apart from registration answers, we do not currently delete information automatically. If you would like us to review your information, contact [support email]. Sign-in sessions expire after 8 hours.
- **[REMOVED]** ~~We do not currently delete information automatically. If you would like us to review your information, contact [support email]. Sign-in sessions expire after 8 hours.~~


**Context, unchanged (relevant to questions 8 and 10):**

- §1: "{{operatorLegalName}} ({{entityType}}, {{entityIdentifier}}), {{operatorLocation}}, operates Eve at https://eveevents.com.au. We aim to handle personal information responsibly and, to the extent the Australian Privacy Principles and the Privacy Act 1988 (Cth) apply to us, in line with them." (operator facts are still placeholders pending confirmation)
- §7: "Our database is hosted in Australia (Sydney). Our hosting provider processes requests in the United States, and our email provider (Resend) and, for paid tickets, Stripe may process information in other countries. This means some personal information may be handled outside Australia."

---

## B. In-form notices (exact text; `{Organiser}` = the organiser's name)

1. **General notice** — shown immediately before the first registration question:
   > {Organiser} asks these questions to help run this event. Your answers go to {Organiser} for this event. You can leave optional questions blank. [How we handle your answers]

   The bracketed phrase links to Privacy Policy section 5.

2. **SENSITIVE question** — shown under each such field:
   > This may include health, disability or accessibility information. {Organiser} asks so they can make arrangements for you at this event. Only share what you’re comfortable with.

3. **THIRD_PARTY question** — shown under each such field:
   > Please make sure this person knows you’re giving their details to {Organiser} for this event.

4. **Acknowledgement checkboxes.** These are never pre-ticked. Each appears only once a question of that kind has been answered, and each must be ticked before submitting.
   - SENSITIVE (the purchaser's agreement to collection):
     > I agree to {Organiser} collecting my answers to {question labels} for this event, including health, disability or accessibility information. Only answer what you are comfortable sharing.
   - THIRD_PARTY (the purchaser's own confirmation — recorded as such, **not** as the other person's consent):
     > I confirm that the person whose details I have given ({question labels}) knows I am giving them to {Organiser} for this event, or that I am allowed to give them.

5. **CONSENT question guidance** (yes/no with no default) — shown under the field:
   > Choosing No won’t affect your booking.

6. **Existing general collection notice** — shown above the submit button; wording extended only to mention answers:
   > Your booking details (your name, email and phone, the attendees' names, and your answers to the organiser's questions) are provided to the event organiser so they can run the booking and contact you about the event. Your name, email and phone may also appear in the organiser's event contact records. This is not consent to marketing. See the Privacy Policy.

**What is recorded:**
- the answer;
- the question's wording, type and category as shown;
- for SENSITIVE / THIRD_PARTY answers, the time the **purchaser** ticked the relevant box (`buyer_acknowledged_at`).

A "No" to a consent question is stored as No.

---

## C. Retention schedule (answers only)

| Category | Example | Answer removed |
|---|---|---|
| STANDARD | how did you hear | 12 months after the event ends |
| SENSITIVE | accessibility, dietary | 30 days after the event ends; if cancelled, 7 days after cancellation |
| THIRD_PARTY | emergency contact | 7 days after the event ends; if cancelled, 7 days after cancellation |
| CONSENT | photo/video consent | **3 years after the event ends — PROVISIONAL, pending advice (Q5)** |

- **"Removed"** means the answer value is deleted. A structural record remains (question wording, type, category, timestamps, acknowledgement time), so it can be shown that an answer existed.
- **Never affected:** orders, payments, refunds, tickets/check-in, acceptance of the Terms/Refunds policy, audit history.
- **Legal hold:** an administrator can place a hold on an event or a single order with a reason code (complaint, incident, dispute, legal obligation). Held answers are not removed. Removal resumes on the normal schedule when the hold is cleared.
- **Enforcement:** a daily job applies the schedule. It is currently **report-only** and will be switched on separately after approval. The CONSENT period is one setting and can be changed before enforcement starts, including to "not removed automatically".
- **Backups and copies:** the database keeps 6 hours of point-in-time history. Development and preview copies follow the separate data-copies standard (`docs/compliance/eve-production-data-copies.md`). That standard proposes that no Production-derived copy is kept beyond 30 days except under a documented hold.

---

## D. Access model

- **Organiser roles:** answers, and even answer counts, are visible only to the organiser's **Manager, Admin or Super Admin** roles, for that organiser's own events.
- **Platform administrators:** our own authorised administrators can access answers where needed for support or legal reasons.
- **Viewer and Analyst** roles see no answers and no counts.
- **Never shown elsewhere:** not to other buyers, not on tickets or in emails, not in exports or CRM/contact records. Audit logs record ids and counts, never answer text.

---

## E. Questions for the reviewer

We are asking for advice on each of these; none is treated as settled.

1. Are the proposed collection notices (B.1–B.6, and Privacy sections 2–5) sufficient for STANDARD, SENSITIVE and THIRD_PARTY information?
2. Is a separate, unticked agreement checkbox (B.4, SENSITIVE) adequate where an answer may reveal health or disability information? Does anything change where the purchaser answers an attendee-level SENSITIVE question **about another attendee** (e.g. booking for a family member)?
3. Is the THIRD_PARTY wording (B.3, B.4 and section 5) appropriate? Does it make clear that the purchaser is **not** consenting on the third party's behalf? Is "or that I am allowed to give them" appropriate?
4. Are the category-specific retention periods (section C) reasonable?
5. What retention period should apply to CONSENT evidence, particularly photography/media consent, given that the record may need to exist for as long as the media is used? Should it be event-based, use-based, or set per question?
6. Is "Deleted information may remain in our controlled backups for a limited period before those copies expire" acceptable, given the backup and copy lifecycle in section C?
7. Is any additional disclosure needed because authorised platform administrators can access answers (section D)?
8. Given the actual hosting and providers (database in Sydney; hosting in the United States; Resend and Stripe), does section 7 adequately cover registration answers, or is more specific overseas/cloud disclosure needed?
9. Do any State/Territory privacy laws or event-specific obligations (e.g. health records legislation, venue or licensing requirements) materially change this approach?
10. Does Eve / HLNA currently fall within the Privacy Act 1988 (Cth) or the small-business exemption? Does voluntarily applying APP-style controls change anything we should disclose, or how section 1 should be worded?
