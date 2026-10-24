import { EVENT_CHANGE_NOTICES_ENABLED } from '@/config/legal';

// DRAFT wording prepared for a limited, self-published private beta.
// It has NOT been reviewed or approved by a solicitor or accountant and must
// never be described as if it had been. Not legal advice and not final.
//
// Scope: events run by the operator (no third-party Event Organisers yet). Paid
// ticketing may be offered for some events: payments are taken by Stripe through the
// Event Organiser's own Stripe account (a direct charge), refunds are full-order only
// and are processed by a person, never automatically. The text deliberately takes NO
// position on GST or any other tax (that decision is open, see ADR 0004 and 0013) and,
// as the existing test requires while the operator is not registered for GST, never uses
// the words "GST" or "tax invoice". It says only that tax is not covered and where to ask.
//
// {{tokens}} are replaced at render time: operator facts come from the legal
// config (and stay visibly marked until they are set); nothing here invents an
// entity, ABN/ACN, address or jurisdiction. No charity, not-for-profit or
// public-benefit claim appears anywhere in this file.

// Support wording is deliberately NOT a service level: no time is promised.
export const SUPPORT_REPLY_NOTE = 'We read every message and will reply as soon as we reasonably can. We do not guarantee a response time.';
// Privacy access/correction requests: a reasonable time, aiming for 30 days.
export const PRIVACY_REQUEST_NOTE = 'We will respond within a reasonable time, and we aim to do so within 30 days.';
// Private-beta limitation, shown in the Terms and the Refunds policy.
export const PRIVATE_BETA_NOTE = 'Eve is currently being made available on a limited basis. Some features, including access for third-party organisers, may not yet be available. Paid tickets may be offered for some events, and only where an event shows a ticket price.';
// Principle-based retention wording (no fixed periods are promised yet).
export const RETENTION_PRINCIPLE = 'We keep personal information only for as long as reasonably required for the purposes described in this policy, our operational needs, dispute handling and any applicable legal obligations. When it is no longer reasonably required, we may delete or de-identify it.';

// `id` is an optional in-page anchor (e.g. /privacy#registration-questions,
// linked from the booking form's registration-question notice).
export type LegalSection = { heading: string; body: string[]; id?: string };
export type LegalDoc = { slug: 'terms' | 'privacy' | 'refunds'; title: string; intro: string; sections: LegalSection[] };

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Use and Ticket Purchase Terms',
  intro: 'These terms apply when you use Eve to register for or book tickets. Please read them together with our Privacy Policy and our Refunds & cancellations policy.',
  sections: [
    {
      heading: '1. Who we are and what Eve does',
      body: [
        'Eve is an online ticketing service operated by {{operatorLegalName}} ({{entityType}}, {{entityIdentifier}}), {{operatorLocation}} ("we", "us").',
        'Eve is the ticketing platform. It lets event organisers list events, issue tickets, and manage registrations and check-in. Each event is run by an event organiser (the "Event Organiser"), who is responsible for conducting the event and for its content. During the private beta the Event Organiser may be the operator of Eve.',
        PRIVATE_BETA_NOTE,
      ],
    },
    {
      heading: '2. Who you contract with',
      body: [
        'When you book a ticket you make a contract for the event with the Event Organiser named on the event page. We provide the ticketing platform, the delivery of your ticket and booking confirmation, and a way to contact us about your booking.',
        'If you buy a paid ticket, you pay the Event Organiser for it: the payment is processed by Stripe through the Event Organiser\'s Stripe account.',
      ],
    },
    {
      heading: '3. Free and paid tickets',
      body: [
        'Free tickets cost nothing. Paid tickets may be offered for some events. Where a ticket has a price, the event page shows it before you pay, in the currency shown, and any booking fee is shown separately. The total shown at checkout is the amount you will be charged.',
        'These terms do not set out how any tax applies to ticket prices. The payment summary in your ticket email is a summary of your order. If you have a question about tax on a ticket, or need other payment documents, contact the Event Organiser or {{supportEmail}}.',
      ],
    },
    {
      heading: '4. Payments',
      body: [
        'No payment is taken for free tickets. Card payments for paid tickets are processed by Stripe through the Event Organiser\'s Stripe account. You enter your card details with Stripe; we do not see or store them, and Stripe\'s own terms and privacy policy apply to the payment.',
        'Before you pay you are asked to agree to these terms and to our Refunds & cancellations policy; we record that you agreed, when, and which version of each. A paid booking is confirmed only after the payment succeeds. Until then your place is held for a limited time, and if the payment is not completed the booking is released.',
        'If a payment is taken but you do not receive your ticket, contact {{supportEmail}} with your order reference and we will look into it.',
      ],
    },
    {
      heading: '5. Your tickets and booking links',
      body: [
        'After you book, we email you links to your tickets and your booking. Anyone who has a ticket or booking link can view and use that ticket, so please keep your links private and do not share them publicly.',
      ],
    },
    {
      heading: '6. Cancellations, refunds and event changes',
      body: ['These are explained in our Refunds & cancellations policy, which forms part of these terms.'],
    },
    {
      heading: '7. Using Eve',
      body: [
        'Please give accurate details, and do not misuse the service, attempt unauthorised access, or interfere with other people\'s bookings. We may suspend access where needed to protect the service or other users.',
      ],
    },
    {
      heading: '8. Event Organisers',
      body: [
        'The Event Organiser is responsible for conducting the event, for the accuracy of its event information, and for how it uses the booking details it receives. An Event Organiser may have its own conditions of entry and, where it does, it should make them available on or with the event.',
      ],
    },
    {
      heading: '9. Your rights under Australian Consumer Law',
      body: [
        'Our services, and the Event Organiser\'s, come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms limits those guarantees or your rights to a remedy, including where an event is cancelled, is materially different from what was promised, or a service is not provided with due care and skill.',
      ],
    },
    {
      heading: '10. Responsibility for events',
      body: [
        'The Event Organiser is responsible for conducting the event. Nothing in these terms limits any right or remedy you have under Australian law that cannot lawfully be limited.',
      ],
    },
    {
      heading: '11. Privacy',
      body: ['Our Privacy Policy explains how personal information is handled.'],
    },
    {
      heading: '12. Changes, governing law and contact',
      body: [
        'We may update these terms and will show the date they were last updated ({{lastUpdated}}). These terms are governed by the laws of {{governingState}}, Australia, and the courts of that jurisdiction have non-exclusive jurisdiction, without limiting your statutory rights.',
        `Contact us at {{supportEmail}}. ${SUPPORT_REPLY_NOTE}`,
      ],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  slug: 'privacy',
  title: 'Privacy Policy',
  intro: 'This policy explains how personal information is handled when you use Eve.',
  sections: [
    {
      heading: '1. About this policy',
      body: [
        '{{operatorLegalName}} ({{entityType}}, {{entityIdentifier}}), {{operatorLocation}}, operates Eve at https://eveevents.com.au. We aim to handle personal information responsibly and, to the extent the Australian Privacy Principles and the Privacy Act 1988 (Cth) apply to us, in line with them.',
      ],
    },
    {
      heading: '2. What we collect',
      body: [
        // Registration questions (ADR 0013 §4a–§4d): the wording in sections 2, 3,
        // 4, 5 and 8 is accepted by the OWNER (2026-10-24) WITHOUT external legal
        // review. Never describe it as legally reviewed or approved.
        'If you book a ticket: your name, email address and optional phone number; each attendee\'s name; any promotion or access code you enter; and your answers to any registration questions the Event Organiser asks for that event (see section 5).',
        'If you are an Event Organiser or team member: your username, a one-way hash of your password (never the password itself), your name, role, sign-in times and session records.',
        'When tickets are checked in: the time of check-in and the organiser staff member who recorded it.',
        'Technical data: our hosting provider\'s logs record technical request details such as your IP address. We also use hashed identifiers to limit repeated requests.',
        'If you buy a paid ticket: the amount and currency and the order details; the references Stripe gives us for the checkout and the payment, and the refund status if a refund is made; and when you agreed to the Terms and the Refunds & cancellations policy and which version of each you agreed to. Your card details go directly to Stripe and are not seen or stored by us.',
      ],
    },
    {
      heading: '3. Why we use it',
      body: [
        'To process bookings and, for paid tickets, payments and refunds; to issue and deliver tickets; to send booking confirmations and event notices (such as cancellation, event-change and, where the Event Organiser has switched them on, reminder emails); to run organiser accounts and keep them secure; to prevent abuse; and to meet legal obligations.',
        'Answers to registration questions are used to run that event, for example catering, access arrangements or contacting someone in an emergency.',
        'We do not currently send marketing email or use your booking details for marketing, and agreeing to the Terms is not consent to marketing.',
      ],
    },
    {
      heading: '4. Who we share it with',
      body: [
        'The Event Organiser. Your booking details are provided to the Event Organiser so they can administer the booking and communicate with you about the event. Your name, email address and phone number may also appear in the organiser\'s event contact records on our platform. This does not give anyone your consent to marketing. The Event Organiser handles that information under its own privacy practices.',
        'Answers to registration questions go to the Event Organiser for that event. On our platform they can be seen only by the organiser\'s team members with a manager or administrator role, and by our own authorised administrators where that is needed for support or legal reasons. They are not added to the organiser\'s contact records, not included in ticket emails, and not used for marketing. The Event Organiser handles the answers it receives under its own privacy practices, including any copies it makes.',
        'Our service providers: Vercel (hosting), Neon (database hosting) and Resend (email delivery). For paid tickets, Stripe processes the payment through the Event Organiser\'s Stripe account as an independent payment processor, under its own privacy policy. The Event Organiser can see the amount, payment status and refund status of paid bookings.',
        'Where required or permitted by law.',
      ],
    },
    {
      id: 'registration-questions',
      heading: '5. Registration questions and sensitive information',
      body: [
        'Eve provides the ticketing platform. We handle the core booking and platform information needed to run the service, such as your contact details, your tickets and, for paid tickets, the payment records.',
        'Each Event Organiser decides which registration questions to ask for its event, why it asks them, and whether each one is required or optional. We collect and store your answers on the Event Organiser\'s behalf. You can leave a question marked optional blank.',
        'Event Organisers should only ask for information that is reasonably needed to run their event, for example accessibility or support needs, dietary requirements, an emergency contact, or other details the event genuinely needs. The Event Organiser remains responsible for its own use of the answers and for any copies it makes.',
        'Answers about accessibility, support or dietary needs may include health or disability information. Before you submit an answer to a question like this, we ask you to agree to the Event Organiser collecting it, and we record when you agreed. Nothing is ticked for you.',
        'If you give another person\'s details, such as an emergency contact, please make sure they know you are giving their details to the Event Organiser for this event. Before you submit them, we ask you to confirm this, and we record that you confirmed. That confirmation is yours; it is not that person\'s consent. Event Organisers should only ask for another person\'s details where the event genuinely needs them, for example to contact someone in an emergency.',
      ],
    },
    {
      heading: '6. Cookies and tracking',
      body: [
        'Pages used by ticket buyers do not set cookies, and we do not use analytics or advertising trackers. Event Organiser sign-in uses one essential cookie that keeps you signed in for up to 8 hours and is removed when you sign out.',
      ],
    },
    {
      heading: '7. Where information is processed',
      body: [
        'Our database is hosted in Australia (Sydney). Our hosting provider processes requests in the United States, and our email provider (Resend) and, for paid tickets, Stripe may process information in other countries. This means some personal information may be handled outside Australia.',
      ],
    },
    {
      heading: '8. How long we keep information',
      body: [
        RETENTION_PRINCIPLE,
        // Principle-based on purpose: the exact per-category timers are internal
        // (RETENTION_POLICY in lib/events/answerRetention.ts, ADR 0013 §4b/§4c).
        'We keep registration-question answers only for as long as they are reasonably needed for the event and their purpose. Sensitive information and details about other people are generally removed sooner than ordinary event information. We may keep information longer where reasonably required for an incident, complaint, dispute or legal obligation. Removing answers does not affect your booking, payment or ticket records.',
        'Deleted information may remain in our controlled backups for a limited period before those copies expire.',
        'Apart from registration answers, we do not currently delete information automatically. If you would like us to review your information, contact {{supportEmail}}. Sign-in sessions expire after 8 hours.',
      ],
    },
    {
      heading: '9. Security',
      body: [
        'We use encrypted connections, hashed passwords, access controls and revocable sessions. No system is perfectly secure. If a data breach occurs, we will assess it and notify affected people and the regulator where the law requires.',
      ],
    },
    {
      heading: '10. Your rights, questions and complaints',
      body: [
        `You can ask to access or correct your personal information, or raise a question or complaint, by emailing {{supportEmail}}. ${PRIVACY_REQUEST_NOTE} If you are not satisfied, you can contact the Office of the Australian Information Commissioner at oaic.gov.au.`,
      ],
    },
    {
      heading: '11. Changes',
      body: ['We will publish updates on this page and show the date they were last updated ({{lastUpdated}}).'],
    },
  ],
};

export function refundsDoc(changeNotices: boolean = EVENT_CHANGE_NOTICES_ENABLED): LegalDoc {
  return {
    slug: 'refunds',
    title: 'Refunds & cancellations',
    intro: 'This policy explains what happens when an event is cancelled or its details change, and how to ask for help. It does not limit your rights under the Australian Consumer Law.',
    sections: [
      {
        heading: '1. Free tickets and the private beta',
        body: [
          PRIVATE_BETA_NOTE,
          'Free bookings have no ticket price, so there is nothing to refund. If you cannot attend a free event, please tell the Event Organiser so your place can be released. The sections below about payments and refunds apply to paid tickets, where an event offers them.',
        ],
      },
      {
        heading: '2. Who is responsible',
        body: [
          'Each event is run by its Event Organiser, who is responsible for conducting the event. During the private beta the Event Organiser may be the operator of Eve. We provide the ticketing platform and will try to help.',
        ],
      },
      {
        heading: '3. If an event is cancelled',
        body: [
          'If an event is cancelled, we aim to email people with a confirmed booking. We cannot guarantee that an email will be delivered, so please also check the event page.',
          'If you have paid for a ticket you are generally entitled to a remedy under Australian law. This will usually be a refund of what you paid, or a replacement if the Event Organiser offers one that you agree to. Cancelling an event does not refund payments automatically: a refund is made once it has been approved or is required, and is processed by us or the Event Organiser to your original payment method. It can take time to appear, depending on your bank or card issuer.',
        ],
      },
      {
        heading: '4. If an event changes significantly',
        body: [
          changeNotices
            ? 'If the date, time or venue of an event changes, we aim to email people with a confirmed booking to tell them what has changed. We cannot guarantee that an email will be delivered, so please also check the event page. A change that materially affects what you bought may entitle you to a refund or another remedy under Australian law. Contact the Event Organiser or {{supportEmail}} if you think a change is significant.'
            : 'If the date, time, venue or a major feature of an event changes in a way that materially affects what you bought, you may be entitled to a refund or another remedy under Australian law. The Event Organiser is responsible for telling you about changes. Contact the Event Organiser or {{supportEmail}} if you think a change is significant.',
        ],
      },
      {
        heading: '5. If you can no longer attend',
        body: [
          'Unless the Event Organiser says otherwise, a change of mind is not by itself a reason for a refund of a paid ticket. Please ask the Event Organiser or contact {{supportEmail}}. This does not affect your statutory rights.',
        ],
      },
      {
        heading: '6. If something is wrong with your booking',
        body: [
          'If you did not receive your ticket, or think something is wrong with your booking, contact {{supportEmail}} and we will look into it. If you think you were charged incorrectly or twice, contact us in the same way. If we find a charge was made in error, we will correct it.',
        ],
      },
      {
        heading: '7. How refunds are made',
        body: [
          'Refunds for paid tickets are made for the full order, to the original payment method, through Stripe. A refund is not made automatically when you ask for one: your request is reviewed and, where a refund is approved or required, it is processed by us or the Event Organiser. Asking for a refund does not mean one will be given, except where you are entitled to one under Australian law. Partial refunds are not currently available through Eve, but this does not limit your rights under Australian law.',
          'When an order is refunded, the tickets on that order stop being valid and the places are released, and we aim to email you to tell you.',
        ],
      },
      {
        heading: '8. How to ask for help',
        body: [`Email {{supportEmail}} with your order reference (shown in your ticket email). ${SUPPORT_REPLY_NOTE}`],
      },
    ],
  };
}
