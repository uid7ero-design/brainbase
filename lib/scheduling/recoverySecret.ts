import 'server-only';
import { createHmac } from 'node:crypto';

// Phase 2C.3c reload recovery (SERVER ONLY: never import this from a client component; a static pin enforces it).
//
// The recovery secret is an opaque per-(user, organisation) value the server component hands to the staff booking dialog as a prop. The browser
// derives from it (a) the NAME of the sessionStorage record and (b) the keyed fingerprint of the booking content. It exists so that one user,
// or one organisation, can never find, read, resume or clear another's pending record in the same browser.
//
// SECURITY MODEL
//   - It is HMAC-SHA-256 keyed by the server's session secret over a domain-separation label and the length-prefixed ids. HMAC is one-way: the value
//     reveals nothing about SESSION_SECRET, and it is not the session cookie, a JWT or any token the API accepts. No route reads it; holding it
//     authorises nothing. The label "sched-recovery-v1" separates it from every other use of the key.
//   - Length-prefixing makes the encoding unambiguous: ("a|b","c") and ("a","b|c") cannot collide.
//   - It is stable for a user and organisation across sign-outs, so the same user signing back in finds their own unresolved record.
//   - A rotated session secret changes it, which orphans one unresolved record (documented residual risk).
//   - It is never written to storage, logs or a URL by this feature. It is in the page's props for the signed-in user only.

const LABEL = 'sched-recovery-v1';

function lengthPrefixed(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length, 0);
  return Buffer.concat([length, bytes]);
}

export function deriveRecoverySecret(sessionSecret: string, userId: string, organisationId: string): string {
  return createHmac('sha256', sessionSecret).update(Buffer.concat([lengthPrefixed(LABEL), lengthPrefixed(userId), lengthPrefixed(organisationId)])).digest('base64url');
}
