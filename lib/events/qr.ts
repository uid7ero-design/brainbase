import 'server-only';
import QRCode from 'qrcode';

// The QR encodes only the ticket's own public URL (a bare opaque
// token embedded in a path segment) — never attendee name/email, never
// an order id or DB row id alone, never anything predictable. Scanning
// it with a phone camera opens the same public, token-gated ticket page
// this value points at; the staff check-in scanner (see
// CheckInClient.tsx) decodes the SAME value and extracts the token from
// it, so one QR payload serves both purposes without a second, parallel
// encoding.
export function buildTicketUrl(origin: string, ticketToken: string): string {
  return `${origin}/t/${ticketToken}`;
}

// Renders as inline SVG (not a PNG data URI) — resolution-independent,
// crisp at any print/display size, and small enough to embed directly
// in server-rendered HTML with no extra network request. Deliberately
// classic black-on-white regardless of the surrounding page's dark
// theme: QR scan reliability depends on strong contrast, and every
// scanner (a phone camera, a check-in device) expects that convention.
export async function generateTicketQrSvg(ticketUrl: string): Promise<string> {
  return QRCode.toString(ticketUrl, {
    type: 'svg',
    margin: 1,
    color: { dark: '#0B0B12', light: '#FFFFFF' },
  });
}
