// Phase 2C.3c UI slices 1-2: the booking idempotency key (slice 1 prepared it; slice 2 sends it, minted once per distinct content at the review step). Pure of server imports (client components use it).
//
// The contract this encodes (docs/architecture/scheduling-phase2c3c-staff-booking-ui-design.md §3):
//   - format `bk_` + 32 lowercase hex characters (35 characters; the API accepts 16-80 of [A-Za-z0-9_-]);
//   - ONE key per distinct booking content: the same content always yields the same key, however often it is asked for, so a retry, a
//     timeout, a double click or a re-render can never invent a second key for the same intended booking;
//   - a different content yields a new key (the staff member changed the booking);
//   - the key lives in memory only. It is not written to sessionStorage, localStorage, a log or the DOM. It travels only in the
//     Idempotency-Key header of the one POST and in the reconcile lookup's query (GET ?idempotencyKey=), as the API contract defines.
//     This module never stores the key. Reload recovery (pendingStore.ts) keeps only the ORIGINAL key of an UNRESOLVED attempt, in sessionStorage, written before
//     the first send and removed on an authoritative outcome; the holder gets it back through adopt() and nowhere else;
//   - there is deliberately NO "rotate" operation here. The only ways to a new key are a changed content or an explicit `discard()`, which
//     slice 2 calls it solely from the IDEMPOTENCY_CONFLICT state, on the staff member's explicit choice to start a new booking. During an uncertain outcome nothing in this module can change the key.

export const BOOKING_KEY_PATTERN = /^bk_[0-9a-f]{32}$/;

/** What the key identifies: the offering, the resource, the engine-offered start and (slice 2) the party and customer fields, trimmed. The basis stamps are NOT part of it. */
export interface BookingContent {
  offeringId: string;
  resourceId: string;
  date: string;
  time: string;
  partySize?: number;
  customerName?: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export function newBookingKey(randomUuid: () => string = () => globalThis.crypto.randomUUID()): string {
  return `bk_${randomUuid().replace(/-/g, '').toLowerCase()}`;
}

export const canonicalContent = (c: BookingContent): string =>
  JSON.stringify([c.offeringId, c.resourceId, c.date, c.time, c.partySize ?? null, c.customerName ?? null, c.email ?? null, c.phone ?? null, c.notes ?? null]);

export interface BookingKeyHolder {
  /** The key for this content: the held key if the content is unchanged, otherwise a fresh one that replaces it. */
  keyFor(content: BookingContent): string;
  /** The held key, or null. Never creates one. */
  current(): string | null;
  /**
   * RELOAD RECOVERY ONLY: hold an EXISTING key (the original of an unresolved attempt) for this content. Called from exactly one place: REVIEW in
   * resume mode, after the content's keyed fingerprint matched the pending record. Never mints a key; ignores anything that is not a booking key.
   */
  adopt(key: string, content: BookingContent): void;
  /** Forget the held key. Only the IDEMPOTENCY_CONFLICT state calls it, on the staff member's choice; never during an uncertain outcome. */
  discard(): void;
}

export function createBookingKeyHolder(randomUuid?: () => string): BookingKeyHolder {
  let held: { content: string; key: string } | null = null;
  return {
    keyFor(content) {
      const next = canonicalContent(content);
      if (held && held.content === next) return held.key;
      held = { content: next, key: newBookingKey(randomUuid) };
      return held.key;
    },
    adopt(key, content) {
      if (BOOKING_KEY_PATTERN.test(key)) held = { content: canonicalContent(content), key };
    },
    current: () => held?.key ?? null,
    discard() {
      held = null;
    },
  };
}
