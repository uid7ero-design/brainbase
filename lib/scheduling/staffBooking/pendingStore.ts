import { BOOKING_KEY_PATTERN } from './key';
import { hmacText } from './hmac';

// Phase 2C.3c reload recovery, tier 2: the write-ahead record in sessionStorage. Client only; pure of server imports.
//
// WHAT IS STORED (and nothing else):  bb.sched.pending.<scope>  =  {"v":1,"key":"bk_<32 hex>","fp":"<base64url HMAC>","savedAt":<epoch ms>}
//   - `key`     the ORIGINAL idempotency key of an attempt whose outcome is not yet known. It is a random identifier, not customer data.
//   - `fp`      a KEYED fingerprint (HMAC-SHA-256 under the per-user recovery secret) of the canonical booking content. A plain hash of a name or a phone
//               number can be guessed offline; a keyed one cannot be checked without the secret. It is used for one thing only: so that "Enter the
//               booking again" can refuse different content BEFORE a key is reused. The server remains the authority on "same content".
//   - `savedAt` when it was written. It is NEVER read to decide anything: there is no expiry, no quiet period and no automatic release. A record is
//               removed only by an authoritative outcome (see clear()), or when the tab closes (sessionStorage).
// NEVER stored: names, email, phone, notes, party size, date, time, resource or offering ids, the request body, the reservation id, user or organisation
// ids, the secret.
//
// ISOLATION: the storage name embeds `scope`, derived from the per-(user, organisation) secret. A store built from another secret computes another name,
// so it cannot read, overwrite or clear this record, and never looks up its key.
//
// FAIL CLOSED: status() reports 'unavailable' when storage cannot be read or written, and 'corrupt' for a record that is present but not a valid v1
// record. Neither is treated as "nothing pending": the caller must offer no booking.

export const PENDING_PREFIX = 'bb.sched.pending.';
export const RECORD_VERSION = 1;

export interface PendingRecord {
  v: 1;
  key: string;
  fp: string;
  savedAt: number;
}

export type PendingStatus = { kind: 'none' } | { kind: 'record'; record: PendingRecord } | { kind: 'corrupt' } | { kind: 'unavailable' };

export interface PendingStore {
  /** The opaque storage suffix for this user and organisation. */
  readonly scope: string;
  status(): PendingStatus;
  /** The valid record, or null (absent, unreadable, malformed or of another version). Use status() to tell those apart. */
  read(): PendingRecord | null;
  /** Writes the record. {ok:false} if the browser refused or did not keep it; the caller must then send nothing. */
  write(key: string, canonicalContent: string): { ok: boolean };
  /** write() unless a record for the SAME key is already kept. A record for a DIFFERENT key is never replaced here: that would abandon an unresolved attempt. */
  ensure(key: string, canonicalContent: string): { ok: boolean };
  /** Removes the record. Callers do this only on an authoritative outcome. */
  clear(): void;
  fingerprint(canonicalContent: string): string;
  /** Can this browser keep a record at all? A tiny write-and-remove probe under a separate name. */
  canStore(): boolean;
}

const isRecord = (v: unknown): v is PendingRecord => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const r = v as Record<string, unknown>;
  const keys = Object.keys(r);
  return (
    keys.length === 4 &&
    r.v === RECORD_VERSION &&
    typeof r.key === 'string' &&
    BOOKING_KEY_PATTERN.test(r.key) &&
    typeof r.fp === 'string' &&
    r.fp.length > 0 &&
    r.fp.length <= 64 &&
    typeof r.savedAt === 'number' &&
    Number.isFinite(r.savedAt)
  );
};

export function createPendingStore(secret: string, storage: Storage): PendingStore {
  const scope = hmacText(secret, 'scope').slice(0, 22);
  const name = `${PENDING_PREFIX}${scope}`;
  const fingerprint = (canonicalContent: string) => hmacText(secret, `fp\u0000${canonicalContent}`);

  function status(): PendingStatus {
    let raw: string | null;
    try {
      raw = storage.getItem(name);
    } catch {
      return { kind: 'unavailable' };
    }
    if (raw === null) return { kind: 'none' };
    try {
      const parsed: unknown = JSON.parse(raw);
      return isRecord(parsed) ? { kind: 'record', record: parsed } : { kind: 'corrupt' };
    } catch {
      return { kind: 'corrupt' };
    }
  }

  function write(key: string, canonicalContent: string): { ok: boolean } {
    if (!BOOKING_KEY_PATTERN.test(key)) return { ok: false };
    const record: PendingRecord = { v: RECORD_VERSION, key, fp: fingerprint(canonicalContent), savedAt: Date.now() };
    const text = JSON.stringify(record);
    try {
      storage.setItem(name, text);
      return storage.getItem(name) === text ? { ok: true } : { ok: false }; // a browser that silently drops writes is not a recovery store
    } catch {
      return { ok: false };
    }
  }

  return {
    scope,
    status,
    read() {
      const s = status();
      return s.kind === 'record' ? s.record : null;
    },
    write,
    ensure(key, canonicalContent) {
      const s = status();
      if (s.kind === 'record') return s.record.key === key ? { ok: true } : { ok: false };
      if (s.kind !== 'none') return { ok: false };
      return write(key, canonicalContent);
    },
    clear() {
      try {
        storage.removeItem(name);
      } catch {
        // nothing more can be done; the record stays and the next load reconciles it
      }
    },
    fingerprint,
    canStore() {
      const probe = `${PENDING_PREFIX}probe`;
      try {
        storage.setItem(probe, '1');
        const ok = storage.getItem(probe) === '1';
        storage.removeItem(probe);
        return ok;
      } catch {
        return false;
      }
    },
  };
}
