import { EVENT_CHANGE_NOTICES_ENABLED } from '@/config/legal';

// DRAFT wording prepared for a limited, self-published FREE-EVENT PRIVATE BETA.
// It has NOT been reviewed or approved by a solicitor or accountant and must
// never be described as if it had been. Not legal advice and not final.
//
// Scope of this beta: free events only, run by the operator; no third-party
// Event Organisers yet; paid ticketing not available. Paid-ticket wording is kept
// where it will be needed later and is marked "not currently available".
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
export const PRIVATE_BETA_NOTE = 'Eve is currently being made available on a limited basis. Some features, including paid ticketing and access for third-party organisers, may not yet be available.';
// Principle-based retention wording (no fixed periods are promised yet).
export const RETENTION_PRINCIPLE = 'We keep personal information only for as long as reasonably required for the purposes described in this policy, our operational needs, dispute handling and any applicable legal obligations. When it is no longer reasonably required, we may delete or de-identify it.';

export type LegalSection = { heading: string; body: string[] };
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
      ],
    },
    {
      heading: '3. Free and paid tickets',
      body: [
        'Free tickets cost nothing. Paid ticketing is not currently available.',
        'If paid tickets are offered in future, the price shown before you pay will be the price you pay, in the currency shown, and any booking fee will be shown separately before you pay.',
      ],
    },
    {
      heading: '4. Payments',
      body: [
        'No payment is taken for free tickets. If paid ticketing is offered in future, card payments are expected to be processed by Stripe, your card details would be entered with Stripe and not seen or stored by us, and Stripe\'s own terms and privacy policy would apply to the payment.',
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
        'If you book a ticket: your name, email address and optional phone number; each attendee\'s name; and any promotion or access code you enter. Eve\'s booking form does not currently ask registration questions, so we do not currently collect answers to them (see section 5).',
        'If you are an Event Organiser or team member: your username, a one-way hash of your password (never the password itself), your name, role, sign-in times and session records.',
        'When tickets are checked in: the time of check-in and the organiser staff member who recorded it.',
        'Technical data: our hosting provider\'s logs record technical request details such as your IP address. We also use hashed identifiers to limit repeated requests.',
        'Paid ticketing is not currently available. If it is offered in future, card details would go directly to Stripe and not be seen or stored by us, and we would keep the amount, the Stripe order and payment references, the refund status, and when you agreed to the Terms and the Refunds & cancellations policy and which version of each you agreed to.',
      ],
    },
    {
      heading: '3. Why we use it',
      body: [
        'To process bookings; to issue and deliver tickets; to send booking confirmations and event notices (such as cancellation, event-change and, where the Event Organiser has switched them on, reminder emails); to run organiser accounts and keep them secure; to prevent abuse; and to meet legal obligations.',
        'We do not currently send marketing email or use your booking details for marketing, and agreeing to the Terms is not consent to marketing.',
      ],
    },
    {
      heading: '4. Who we share it with',
      body: [
        'The Event Organiser. Your booking details are provided to the Event Organiser so they can administer the booking and communicate with you about the event. Your name, email address and phone number may also appear in the organiser\'s event contact records on our platform. This does not give anyone your consent to marketing. The Event Organiser handles that information under its own privacy practices.',
        'Our service providers: Vercel (hosting), Neon (database hosting) and Resend (email delivery). If paid ticketing is offered in future, Stripe would process payments as an independent payment processor with its own privacy policy.',
        'Where required or permitted by law.',
      ],
    },
    {
      heading: '5. Sensitive information',
      body: [
        'Eve does not currently show registration questions on its booking form, so it does not collect answers to them. If that changes, this policy will be updated first. Event Organisers who ask such questions elsewhere (for example about access or dietary needs) should only ask for what they need, because answers can reveal sensitive information such as health or disability.',
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
        'Our database is hosted in Australia (Sydney). Our hosting provider processes requests in the United States, and our email provider (Resend) may process information in other countries. This means some personal information may be handled outside Australia.',
      ],
    },
    {
      heading: '8. How long we keep information',
      body: [
        RETENTION_PRINCIPLE,
        'We do not currently delete information automatically. If you would like us to review your information, contact {{supportEmail}}. Sign-in sessions expire after 8 hours.',
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
          'Free bookings have no ticket price, so there is nothing to refund. Paid ticketing is not currently available: the sections below about payments and refunds apply only if and when it is offered. If you cannot attend a free event, please tell the Event Organiser so your place can be released.',
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
          'If you have paid for a ticket (when paid ticketing is available) you are generally entitled to a remedy under Australian law. This will usually be a refund of what you paid, or a replacement if the Event Organiser offers one that you agree to. Cancelling an event would not refund payments automatically: refunds would go to your original payment method and can take time to appear, depending on your bank.',
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
          'If you did not receive your ticket, or think something is wrong with your booking, contact {{supportEmail}} and we will look into it. If paid ticketing is offered in future and you think you were charged incorrectly or twice, contact us in the same way. If we find a charge was made in error, we will correct it.',
        ],
      },
      {
        heading: '7. How refunds would be made',
        body: [
          'Paid ticketing is not currently available. If it is offered in future, refunds for paid tickets are expected to be made for the full order, to the original payment method, through Stripe. Partial refunds are not currently available through Eve, but this does not limit your rights under Australian law.',
        ],
      },
      {
        heading: '8. How to ask for help',
        body: [`Email {{supportEmail}} with your order reference (shown in your ticket email). ${SUPPORT_REPLY_NOTE}`],
      },
    ],
  };
}
