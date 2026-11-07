// Phase 2C.3c UI slice 1: the booking idempotency key, PREPARED but never sent. Pure of server imports (client components use it).
//
// The contract this encodes (docs/architecture/scheduling-phase2c3c-staff-booking-ui-design.md §3):
//   - format `bk_` + 32 lowercase hex characters (35 characters; the API accepts 16-80 of [A-Za-z0-9_-]);
//   - ONE key per distinct booking content: the same content always yields the same key, however often it is asked for, so a retry, a
//     timeout, a double click or a re-render can never invent a second key for the same intended booking;
//   - a different content yields a new key (the staff member changed the booking);
//   - the key lives in memory only. It is not written to sessionStorage, localStorage, a URL, a log or the DOM (slice 2 adds the
//     reload-recovery record, which holds only {key, payloadHash, savedAt}, never customer data);
//   - there is deliberately NO "rotate" operation here. The only ways to a new key are a changed content or an explicit `discard()`, which
//     slice 2 may call solely after a KNOWN definitive refusal. During an uncertain outcome nothing in this module can change the key.

export const BOOKING_KEY_PATTERN = /^bk_[0-9a-f]{32}$/;

/** What the key identifies in slice 1: the facility, the resource and the engine-offered start. Customer fields join the content in slice 2. */
export interface BookingContent {
  offeringId: string;
  resourceId: string;
  date: string;
  time: string;
}

export function newBookingKey(randomUuid: () => string = () => globalThis.crypto.randomUUID()): string {
  return `bk_${randomUuid().replace(/-/g, '').toLowerCase()}`;
}

const canonical = (c: BookingContent): string => JSON.stringify([c.offeringId, c.resourceId, c.date, c.time]);

export interface BookingKeyHolder {
  /** The key for this content: the held key if the content is unchanged, otherwise a fresh one that replaces it. */
  keyFor(content: BookingContent): string;
  /** The held key, or null. Never creates one. */
  current(): string | null;
  /** Forget the held key. For a KNOWN definitive refusal only (slice 2); never during an uncertain outcome. */
  discard(): void;
}

export function createBookingKeyHolder(randomUuid?: () => string): BookingKeyHolder {
  let held: { content: string; key: string } | null = null;
  return {
    keyFor(content) {
      const next = canonical(content);
      if (held && held.content === next) return held.key;
      held = { content: next, key: newBookingKey(randomUuid) };
      return held.key;
    },
    current: () => held?.key ?? null,
    discard() {
      held = null;
    },
  };
}
