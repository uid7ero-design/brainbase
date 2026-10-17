import 'server-only';
import { emailLayout, escHtml, BASE_URL } from '@/lib/email';
import { buildTicketUrl } from '@/lib/events/qr';
import { formatReceiptMoney } from '@/lib/events/receipt';
import type { LifecycleEmailBranding } from '@/lib/organisations/branding';
import type { NotificationType } from './notifications';

// Phase 5B — lifecycle (transactional) email templates: order cancelled,
// order refunded, event cancelled, event reminder. Pure template
// construction, same discipline as lib/events/ticketEmail.ts's
// buildTicketEmail: server-derived domain data in, { subject, html,
// text } out, no provider call, no DB. Every purchaser/event/organiser
// string passes through lib/email.ts's escHtml(); the plain-text
// alternative is built from the same facts (Resend sends both parts as
// multipart/alternative — see sendEmail's `text` option).
//
// Content rules (brief §3–§6, §11):
//   * factual, neutral, no marketing language;
//   * amounts come ONLY from the order's committed snapshot columns
//     (payment_total_cents / refunded_cents / platform_fee_refunded_cents)
//     — never recomputed from a fee policy;
//   * a refund is never called a tax invoice or credit note, and no
//     settlement timing is claimed;
//   * an event-cancelled email states the order's ACTUAL refund state
//     (refunded / not yet refunded / free / unpaid) and never promises a
//     refund that has not happened;
//   * branding is the organisation's own (name/logo/website/footer/
//     support contact) via LifecycleEmailBranding — nothing product-
//     specific is added by these templates (the shared emailLayout shell
//     is inherited unchanged, exactly as the ticket email inherits it).

export type LifecycleEmailAttendee = {
  name: string;
  // The already-issued token (never minted here); null when the order
  // never reached a state that issues tokens (a PENDING reservation).
  ticketToken: string | null;
  sessionName: string | null;
};

export type LifecycleEmailData = {
  type: NotificationType;
  orderReference: string;
  purchaserName: string;
  eventName: string;
  eventStartsAt: string;
  eventEndsAt: string;
  eventTimezone: string;
  venue: string | null;
  description: string | null;
  orderStatus: string;
  paymentStatus: string;
  currency: string;
  // Committed snapshot (lib/events/receipt.ts semantics): net ticket
  // amount, what the customer paid (COALESCE'd by the reader), the
  // pass-through fee the customer paid, and what was refunded.
  totalCents: number;
  paymentTotalCents: number;
  platformFeeCents: number;
  feeMode: string | null;
  feeLabel: string | null;
  refundedCents: number | null;
  platformFeeRefundedCents: number | null;
  paidAt: string | null;
  refundedAt: string | null;
  attendees: LifecycleEmailAttendee[];
  bookingToken: string | null;
  branding: LifecycleEmailBranding;
  organisationName: string;
};

export type LifecycleEmail = { subject: string; html: string; text: string };

// Words these templates must never contain (asserted by the containment
// suite) — same rule as lib/events/receipt.ts's RECEIPT_FORBIDDEN_TERMS,
// widened with the settlement-timing and marketing phrases the brief
// forbids.
export const LIFECYCLE_EMAIL_FORBIDDEN_TERMS: readonly string[] = [
  'Tax Invoice', 'tax invoice', 'credit note', 'Credit Note', 'GST', 'ABN',
  'business days', 'within 5', 'within 10', 'Don’t miss', "Don't miss", 'Limited time', 'Book now', 'Buy now',
];

const MAX_DESCRIPTION_CHARS = 600;

function formatDateTime(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-AU', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone,
    }).format(d);
  } catch {
    return d.toISOString();
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

// Organiser display name: the configured branding name, else the
// organisation's own record name — a cancellation/refund message must
// always be able to say who the organiser is.
function organiserName(data: LifecycleEmailData): string {
  return data.branding.name?.trim() || data.organisationName;
}

function contactLines(data: LifecycleEmailData): string[] {
  const b = data.branding;
  const parts: string[] = [];
  if (b.supportEmail) parts.push(b.supportEmail);
  if (b.supportPhone) parts.push(b.supportPhone);
  if (b.website) parts.push(b.website);
  return parts;
}

type Facts = { label: string; value: string }[];

// Shared body renderer — one HTML shape and one text shape for all four
// types, so the templates differ only in their facts and sentences.
function render(data: LifecycleEmailData, opts: {
  subject: string;
  heading: string;
  paragraphs: string[];     // plain sentences (escaped at render time)
  facts: Facts;             // label/value rows (escaped at render time)
  links: { label: string; url: string }[];
  attendeeList: boolean;
  closing: string | null;
}): LifecycleEmail {
  const accent = data.branding.accentColor ?? '#7C3AED';
  const organiser = organiserName(data);
  const contact = contactLines(data);

  const factRows = opts.facts.map(f => `
        <tr>
          <td style="padding:6px 0;color:#888;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;vertical-align:top;width:140px">${escHtml(f.label)}</td>
          <td style="padding:6px 0 6px 12px;color:#222;font-size:14px;border-bottom:1px solid #f0f0f0">${escHtml(f.value)}</td>
        </tr>`).join('');

  const attendeeRows = opts.attendeeList && data.attendees.length
    ? `
      <p style="margin:20px 0 6px;font-size:12px;font-weight:600;color:#888;text-transform:uppercase;letter-spacing:.04em">Attendees</p>
      <ul style="margin:0 0 8px;padding-left:18px;color:#222;font-size:14px;line-height:1.7">
        ${data.attendees.map(a => `<li>${escHtml(a.name)}${a.sessionName ? ` <span style="color:#888">· ${escHtml(a.sessionName)}</span>` : ''}</li>`).join('')}
      </ul>`
    : '';

  const linkButtons = opts.links.map(l => `
      <p style="margin:0 0 12px">
        <a href="${escHtml(l.url)}" style="display:inline-block;padding:12px 26px;background:${accent};color:#fff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;letter-spacing:0.02em">${escHtml(l.label)}</a>
      </p>`).join('');

  const contactHtml = `
      <p style="margin:24px 0 0;font-size:13px;color:#555;line-height:1.6">
        Questions about this order? Contact <strong>${escHtml(organiser)}</strong>${contact.length ? ` — ${contact.map(c => escHtml(c)).join(' · ')}` : ''}.
      </p>`;

  const html = emailLayout(`
      <h2 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111">${escHtml(opts.heading)}</h2>
      <p style="margin:0 0 16px;color:#444;line-height:1.6">Hi ${escHtml(data.purchaserName)},</p>
      ${opts.paragraphs.map(p => `<p style="margin:0 0 14px;color:#444;line-height:1.6">${escHtml(p)}</p>`).join('')}
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:8px 0 4px">${factRows}
      </table>
      ${attendeeRows}
      ${linkButtons ? `<div style="margin:18px 0 0">${linkButtons}</div>` : ''}
      ${opts.closing ? `<p style="margin:16px 0 0;color:#444;line-height:1.6">${escHtml(opts.closing)}</p>` : ''}
      ${contactHtml}
      <p style="margin:20px 0 0;font-size:12px;color:#888">Order reference ${escHtml(data.orderReference)}</p>
    `, {
    name: data.branding.name ?? null,
    logoUrl: data.branding.logoUrl ?? null,
    website: data.branding.website ?? null,
    footerText: data.branding.emailFooter ?? null,
  });

  const textLines: string[] = [
    opts.heading,
    '',
    `Hi ${data.purchaserName},`,
    '',
    ...opts.paragraphs.flatMap(p => [p, '']),
    ...opts.facts.map(f => `${f.label}: ${f.value}`),
  ];
  if (opts.attendeeList && data.attendees.length) {
    textLines.push('', 'Attendees:');
    for (const a of data.attendees) textLines.push(`- ${a.name}${a.sessionName ? ` (${a.sessionName})` : ''}`);
  }
  if (opts.links.length) {
    textLines.push('');
    for (const l of opts.links) textLines.push(`${l.label}: ${l.url}`);
  }
  if (opts.closing) textLines.push('', opts.closing);
  textLines.push('', `Questions about this order? Contact ${organiser}${contact.length ? ` — ${contact.join(' · ')}` : ''}.`);
  textLines.push('', `Order reference ${data.orderReference}`);
  if (data.branding.emailFooter) textLines.push('', data.branding.emailFooter);

  return { subject: opts.subject, html, text: textLines.join('\n') };
}

function money(cents: number, currency: string): string {
  return formatReceiptMoney(cents, currency);
}

function eventFacts(data: LifecycleEmailData): Facts {
  const facts: Facts = [
    { label: 'Event', value: data.eventName },
    { label: 'When', value: `${formatDateTime(data.eventStartsAt, data.eventTimezone)} – ${formatDateTime(data.eventEndsAt, data.eventTimezone)}` },
  ];
  if (data.venue) facts.push({ label: 'Where', value: data.venue });
  return facts;
}

// Refund-state sentence shared by the event-cancelled template — derived
// from the order's ACTUAL payment state at send time, never assumed.
function refundStateSentence(data: LifecycleEmailData): string {
  const paid = money(data.paymentTotalCents, data.currency);
  switch (data.paymentStatus) {
    case 'REFUNDED': {
      const amount = money(data.refundedCents ?? data.paymentTotalCents, data.currency);
      const on = formatDate(data.refundedAt);
      return `Your payment of ${amount} was refunded${on ? ` on ${on}` : ''} to your original payment method.`;
    }
    case 'PAID':
      return `You paid ${paid} for this order. No refund has been processed for it yet — please contact the organiser for information about refunds.`;
    case 'NOT_REQUIRED':
      return 'This was a free registration, so no payment was taken.';
    case 'PENDING':
      return 'Your order was still awaiting payment. No payment has been taken.';
    default:
      return 'No payment is held for this order.';
  }
}

function buildOrderCancelled(data: LifecycleEmailData): LifecycleEmail {
  const facts = eventFacts(data);
  const paragraphs: string[] = [];
  const unpaidReservation = data.paymentStatus === 'EXPIRED' || data.paymentStatus === 'PENDING';
  if (unpaidReservation) {
    paragraphs.push(`Your order for ${data.eventName} was cancelled before payment was completed. No payment has been taken and nothing is owed.`);
  } else if (data.paymentStatus === 'NOT_REQUIRED') {
    paragraphs.push(`Your registration for ${data.eventName} has been cancelled by the organiser. This was a free registration, so no payment was taken.`);
  } else {
    paragraphs.push(`Your order for ${data.eventName} has been cancelled by the organiser.`);
  }
  paragraphs.push('The tickets on this order are no longer valid and cannot be used for entry.');
  facts.push({ label: 'Tickets', value: `${data.attendees.length} ticket${data.attendees.length === 1 ? '' : 's'} cancelled` });
  return render(data, {
    subject: `Your order for ${data.eventName} has been cancelled`,
    heading: unpaidReservation ? 'Order cancelled' : 'Registration cancelled',
    paragraphs,
    facts,
    links: [],
    attendeeList: true,
    closing: null,
  });
}

function buildOrderRefunded(data: LifecycleEmailData): LifecycleEmail {
  const refunded = data.refundedCents ?? data.paymentTotalCents;
  const facts = eventFacts(data);
  const paidOn = formatDate(data.paidAt);
  const refundedOn = formatDate(data.refundedAt);
  facts.push({ label: 'Amount paid', value: `${money(data.paymentTotalCents, data.currency)}${paidOn ? ` on ${paidOn}` : ''}` });
  const feeRefunded = data.platformFeeRefundedCents ?? 0;
  if (data.feeMode === 'PASS_THROUGH' && feeRefunded > 0) {
    facts.push({ label: data.feeLabel?.trim() || 'Booking fee', value: `${money(feeRefunded, data.currency)} refunded` });
  }
  facts.push({ label: 'Total refunded', value: `${money(refunded, data.currency)} ${data.currency.toUpperCase()}${refundedOn ? ` on ${refundedOn}` : ''}` });
  return render(data, {
    subject: `Your refund for ${data.eventName}`,
    heading: 'Refund issued',
    paragraphs: [
      `A full refund has been issued for your order for ${data.eventName}. The refund was sent to the payment method you used for this order.`,
      'The tickets on this order are no longer valid and cannot be used for entry.',
    ],
    facts,
    links: [],
    attendeeList: true,
    closing: null,
  });
}

function buildEventCancelled(data: LifecycleEmailData): LifecycleEmail {
  const facts = eventFacts(data);
  const sessions = Array.from(new Set(data.attendees.map(a => a.sessionName).filter((s): s is string => !!s)));
  if (sessions.length) facts.push({ label: 'Session', value: sessions.join(', ') });
  facts.push({ label: 'Tickets', value: `${data.attendees.length} ticket${data.attendees.length === 1 ? '' : 's'} on this order` });
  return render(data, {
    subject: `${data.eventName} has been cancelled`,
    heading: 'Event cancelled',
    paragraphs: [
      `${organiserName(data)} has cancelled ${data.eventName}. The event will not go ahead as scheduled and the tickets on this order are no longer valid.`,
      refundStateSentence(data),
    ],
    facts,
    links: [],
    attendeeList: true,
    closing: null,
  });
}

function buildEventReminder(data: LifecycleEmailData): LifecycleEmail {
  const facts = eventFacts(data);
  facts.push({ label: 'Tickets', value: `${data.attendees.length} ticket${data.attendees.length === 1 ? '' : 's'}` });
  const links: { label: string; url: string }[] = [];
  if (data.bookingToken) {
    links.push({ label: data.attendees.length > 1 ? 'View all tickets' : 'View ticket', url: `${BASE_URL}/b/${data.bookingToken}/tickets` });
  } else {
    for (const a of data.attendees) {
      if (a.ticketToken) links.push({ label: `View ticket — ${a.name}`, url: buildTicketUrl(BASE_URL, a.ticketToken) });
    }
  }
  const paragraphs = [
    `This is a reminder that ${data.eventName} is coming up. Your ticket${data.attendees.length === 1 ? ' is' : 's are'} ready — have ${data.attendees.length === 1 ? 'it' : 'them'} on your phone or printed when you arrive.`,
  ];
  if (data.description) paragraphs.push(truncate(data.description, MAX_DESCRIPTION_CHARS));
  return render(data, {
    subject: `Reminder: ${data.eventName} — ${formatDateTime(data.eventStartsAt, data.eventTimezone)}`,
    heading: 'Your event is coming up',
    paragraphs,
    facts,
    links,
    attendeeList: true,
    closing: null,
  });
}

export function buildLifecycleEmail(data: LifecycleEmailData): LifecycleEmail {
  switch (data.type) {
    case 'ORDER_CANCELLED': return buildOrderCancelled(data);
    case 'ORDER_REFUNDED': return buildOrderRefunded(data);
    case 'EVENT_CANCELLED': return buildEventCancelled(data);
    case 'EVENT_REMINDER': return buildEventReminder(data);
  }
}
