import 'server-only';
import { Resend } from 'resend';

// Resend delivery-status visibility — signature verification only. No DB
// access lives in this file; see lib/events/ticketEmailDeliveryTracking.ts
// for what happens to a verified event. Kept separate on purpose: this
// file is pure provider-SDK mechanics (construct a client, verify a
// signature), matching the "mechanics vs data" split already implicit in
// lib/events/ticketEmail.ts (pure send/template logic) vs
// lib/events/ticketEmailDelivery.ts (DB state machine).
//
// Verification mechanism (confirmed by reading the installed resend@
// package's own compiled source and type declarations, not guessed):
// resend.webhooks.verify() is a genuine Svix-standard HMAC-SHA256
// wrapper (node_modules/resend/dist/index.cjs constructs
// `new svix.Webhook(webhookSecret).verify(payload, headers)` internally;
// svix's own Webhook class is in turn a thin re-export of the
// `standardwebhooks` package — see node_modules/standardwebhooks/dist/
// index.js: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${payload}`,
// keyed by the base64-decoded `whsec_...` secret, constant-time
// comparison, and a built-in 5-minute timestamp tolerance window). This
// is real cryptographic verification, not a placeholder.
//
// verify() is SYNCHRONOUS and throws on any failure (bad signature,
// missing headers, expired timestamp) rather than returning a
// discriminated result — see node_modules/resend/dist/index.d.mts's
// `verify(payload: VerifyWebhookOptions): WebhookEventPayload`. This
// file deliberately catches ANY thrown error as a generic verification
// failure rather than importing `WebhookVerificationError` from `svix`
// (the concrete error class `standardwebhooks` throws): `svix` is only
// an undeclared TRANSITIVE dependency of `resend` here, never a direct
// dependency of this repo's own package.json, and the `resend` package
// itself does not re-export that error class (confirmed: its compiled
// bundle's only top-level export is `exports.Resend = Resend`). Treating
// every verification failure identically (400, reject) is also exactly
// what "fail closed on invalid signature" requires — there is no
// legitimate reason for this route to behave differently for a bad
// signature vs. a missing header vs. an expired timestamp.
//
// The Resend SDK's own constructor unconditionally requires an API key
// (throws "Missing API key" if absent, even though verify() itself never
// uses it — verify() only touches the webhookSecret argument). Since
// RESEND_API_KEY is already a hard requirement for this codebase's
// EXISTING ticket-email sending to function at all (lib/email.ts), this
// is not a new operational burden — an environment that can't send
// ticket emails has nothing meaningful for this webhook to report on
// either. isResendWebhookConfigured() checks both env vars up front so
// the route can return a clean 503 without ever constructing the SDK
// client on a half-configured environment.

export type ResendWebhookHeaders = { id: string; timestamp: string; signature: string };

let cachedClient: Resend | null = null;

function getResendClient(): Resend {
  if (!cachedClient) cachedClient = new Resend(process.env.RESEND_API_KEY);
  return cachedClient;
}

export function isResendWebhookConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.RESEND_WEBHOOK_SECRET);
}

export class ResendWebhookSignatureError extends Error {}

// Returns the verified event on success; throws ResendWebhookSignatureError
// on any verification failure. Callers must check isResendWebhookConfigured()
// first — this function assumes both env vars are present.
export function verifyResendWebhookEvent(rawBody: string, headers: ResendWebhookHeaders) {
  try {
    return getResendClient().webhooks.verify({
      payload: rawBody,
      headers,
      webhookSecret: process.env.RESEND_WEBHOOK_SECRET!,
    });
  } catch (err) {
    throw new ResendWebhookSignatureError(err instanceof Error ? err.message : 'Signature verification failed.');
  }
}
