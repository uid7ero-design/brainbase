import { EVENT_CHANGE_NOTICES_ENABLED } from '@/config/legal';

// FIRST-DRAFT legal wording for counsel review. Not legal advice and not final.
// {{tokens}} are replaced at render time: operator facts come from the legal
// config (and stay visibly marked until they are set); nothing here invents an
// entity, ABN/ACN, address or jurisdiction. No charity, not-for-profit or
// public-benefit claim appears anywhere in this file.

export type LegalSection = { heading: string; body: string[] };
export type LegalDoc = { slug: 'terms' | 'privacy' | 'refunds'; title: string; intro: string; sections: LegalSection[] };

export const TERMS: LegalDoc = {
  slug: 'terms',
  title: 'Terms of Use and Ticket Purchase Terms',
  intro: 'These terms apply when you use Eve to book or buy tickets. Please read them together with our Privacy Policy and our Refunds & cancellations policy.',
  sections: [
    {
      heading: '1. Who we are and what Eve does',
      body: [
        'Eve is an online ticketing service operated by {{operatorLegalName}} ({{entityType}}, {{entityIdentifier}}), {{registeredAddress}} ("we", "us").',
        'Eve lets event organisers list events, sell or issue tickets, and manage registrations and check-in. We are not the organiser of the events listed on Eve. Each event is run by an independent event organiser (the "Event Organiser"), who is responsible for the event, its content, its price and its delivery.',
      ],
    },
    {
      heading: '2. Who you contract with',
      body: [
        'When you book a ticket you make a contract for the event with the Event Organiser named on the event page. We provide the ticketing platform, the delivery of your ticket and booking confirmation, and support for your booking.',
      ],
    },
    {
      heading: '3. Free and paid tickets',
      body: [
        'Free tickets cost nothing. For paid tickets, the price shown at checkout before you pay is the price you pay, in the currency shown. Any booking fee is shown separately before you pay.',
        'Tickets are sold by the Event Organiser. Prices, availability and sale periods are set by the Event Organiser.',
      ],
    },
    {
      heading: '4. Payments',
      body: [
        'Card payments are processed by Stripe on the Event Organiser\'s Stripe account. Your card details are entered with Stripe and are not seen or stored by us. Stripe\'s own terms and privacy policy apply to the payment.',
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
        'Event Organisers are responsible for the accuracy of their event information, for the event itself, for honouring their refund and cancellation obligations under Australian law, and for how they use the booking details they receive. Event Organisers who use Eve do so under a separate agreement with us.',
        'An Event Organiser may have its own conditions of entry. Where it does, it should make them available on or with the event.',
      ],
    },
    {
      heading: '9. Your rights under Australian Consumer Law',
      body: [
        'Our services, and the Event Organiser\'s, come with guarantees that cannot be excluded under the Australian Consumer Law. Nothing in these terms limits those guarantees or your rights to a remedy, including where an event is cancelled, is materially different from what was promised, or a service is not provided with due care and skill.',
      ],
    },
    {
      heading: '10. Liability',
      body: [
        'To the extent the law allows, we are not responsible for the acts or omissions of Event Organisers or for loss that was not reasonably foreseeable. Nothing in these terms excludes liability that cannot lawfully be excluded.',
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
        'Contact us at {{supportEmail}}. We aim to respond within {{supportResponseTime}}.',
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
        '{{operatorLegalName}} ({{entityType}}, {{entityIdentifier}}) operates Eve at https://eveevents.com.au. We handle personal information in line with the Australian Privacy Principles and the Privacy Act 1988 (Cth) to the extent they apply to us.',
      ],
    },
    {
      heading: '2. What we collect',
      body: [
        'If you book a ticket: your name, email address and optional phone number; each attendee\'s name and optional email address; any promotion or access code you enter; and any answers to registration questions that the Event Organiser asks.',
        'If you are an Event Organiser or team member: your username, a one-way hash of your password (never the password itself), your name, role, sign-in times and session records.',
        'For payments: card details go directly to Stripe and are not seen or stored by us. We keep the amount, the Stripe order and payment references, and the refund status.',
        'When tickets are checked in: the time of check-in and the organiser staff member who recorded it.',
        'Technical data: our hosting provider\'s logs record technical request details such as your IP address. We also use hashed identifiers to limit repeated requests.',
      ],
    },
    {
      heading: '3. Why we use it',
      body: [
        'To process bookings and payments; to issue and deliver tickets; to send booking confirmations and event notices (such as cancellation, refund and, where the organiser has switched them on, reminder emails); to run organiser accounts and keep them secure; to prevent abuse; and to meet legal obligations.',
        'We do not send marketing email. Your booking details are not used for marketing, and agreeing to the Terms is not consent to marketing.',
      ],
    },
    {
      heading: '4. Who we share it with',
      body: [
        'The Event Organiser. Your booking details are provided to the Event Organiser so they can administer the booking and communicate with you about the event. Your name, email address and phone number may also appear in the organiser\'s event contact records on our platform. This does not give anyone your consent to marketing. The Event Organiser handles that information under its own privacy practices.',
        'Our service providers: Vercel (hosting), Neon (database hosting), Stripe (payment processing) and Resend (email delivery). Stripe is an independent payment processor with its own privacy policy.',
        'Where required or permitted by law.',
      ],
    },
    {
      heading: '5. Sensitive information',
      body: [
        'Some Event Organisers ask registration questions (for example about access or dietary needs) whose answers can reveal sensitive information such as health or disability. Event Organisers should only ask for what they need. Answers are provided to the Event Organiser for event administration and are not used for any other purpose by us.',
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
        'Our database is hosted in Australia (Sydney). Our hosting provider processes requests in the United States. Our payment and email providers may process information in other countries. By using Eve you understand that your information may be handled outside Australia.',
      ],
    },
    {
      heading: '8. How long we keep information',
      body: [
        'We keep booking, ticket and payment records for as long as needed to run the service and meet legal and financial record-keeping obligations. Retention periods: {{retentionPeriods}}. Sign-in sessions expire after 8 hours.',
      ],
    },
    {
      heading: '9. Security',
      body: [
        'We use encrypted connections, hashed passwords, access controls and revocable sessions. No system is perfectly secure. If a data breach is likely to result in serious harm, we will notify the people affected and the regulator as the law requires.',
      ],
    },
    {
      heading: '10. Your rights, questions and complaints',
      body: [
        'You can ask to access or correct your personal information, or raise a question or complaint, by emailing {{supportEmail}} (privacy contact: {{privacyContact}}). We aim to respond within {{supportResponseTime}}. If you are not satisfied, you can contact the Office of the Australian Information Commissioner at oaic.gov.au.',
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
    title: 'Refunds, Cancellations & Event Changes',
    intro: 'This policy explains what happens when an event is cancelled or changed, and how to ask for help. It does not limit your rights under the Australian Consumer Law.',
    sections: [
      {
        heading: '1. Who is responsible',
        body: [
          'Events on Eve are run by independent Event Organisers, who are responsible for cancelling and refunding in line with Australian law. We provide the ticketing platform and will help you reach the right outcome.',
        ],
      },
      {
        heading: '2. If the Event Organiser cancels the event',
        body: [
          'You are entitled to a refund of what you paid for the cancelled event, or a replacement if the organiser offers one that you agree to. The cancellation email states your actual refund status.',
          'Cancelling an event does not refund payments automatically: the Event Organiser issues each refund. Refunds go to your original payment method and can take time to appear, depending on your bank. If you have not received a refund, contact the Event Organiser or {{supportEmail}}.',
        ],
      },
      {
        heading: '3. If an event changes significantly',
        body: [
          changeNotices
            ? 'If the date, time or venue of an event changes, we email the people with tickets to tell them what has changed. A change that materially affects what you bought may entitle you to a refund or another remedy under Australian law. Contact the Event Organiser or {{supportEmail}} if you think a change is significant.'
            : 'If the date, time, venue or a major feature of an event changes in a way that materially affects what you bought, you may be entitled to a refund or another remedy under Australian law. The Event Organiser is responsible for telling you about changes. Contact the Event Organiser or {{supportEmail}} if you think a change is significant.',
        ],
      },
      {
        heading: '4. If you can no longer attend',
        body: [
          'Unless the Event Organiser says otherwise, a change of mind is not by itself a reason for a refund. Some organisers allow transfers or refunds, so please ask them or contact {{supportEmail}}. This does not affect your statutory rights.',
        ],
      },
      {
        heading: '5. If something is wrong with your booking',
        body: [
          'If you were charged incorrectly, charged twice, or did not receive your ticket, contact {{supportEmail}} and we will look into it. Charges made in error will be corrected.',
        ],
      },
      {
        heading: '6. Free tickets',
        body: ['Nothing is charged for free tickets. If you cannot attend, please tell the Event Organiser so your place can be released.'],
      },
      {
        heading: '7. How refunds are made',
        body: [
          'Refunds for paid tickets are made for the full order, to the original payment method, through Stripe. Partial refunds are not currently available through Eve. If a booking fee was charged and the order is refunded, the booking fee is refunded too.',
        ],
      },
      {
        heading: '8. How to ask for help',
        body: ['Email {{supportEmail}} with your order reference (shown in your ticket email). We aim to respond within {{supportResponseTime}}.'],
      },
    ],
  };
}
