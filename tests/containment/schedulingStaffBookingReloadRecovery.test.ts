import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

// Phase 2C.3c RELOAD-RECOVERY: FAILING-FIRST contract tests for the two small modules the design introduces. Nothing here exists yet.
//   lib/scheduling/recoverySecret.ts   (server only)  deriveRecoverySecret(sessionSecret, userId, organisationId): string
//   lib/scheduling/staffBooking/pendingStore.ts      (client)       createPendingStore(secret, storage): { read, write, clear, fingerprint }
// Registered with it(...): it.fails until implemented (suite stays green, failure proven); RECOVERY_IMPLEMENTED=1 makes them plain tests (the red run).
// See docs/architecture/scheduling-phase2c3c-reload-recovery-design.md. The component/browser/database tests are in their own files.


type Derive = (sessionSecret: string, userId: string, organisationId: string) => string;
type Store = {
  read: () => { v: number; key: string; fp: string; savedAt: number } | null;
  write: (key: string, canonicalContent: string) => Promise<{ ok: true } | { ok: false }>;
  clear: () => void;
  fingerprint: (canonicalContent: string) => Promise<string>;
};
type CreateStore = (secret: string, storage: Storage) => Store;

const derive = async (): Promise<Derive> => ((await import('@/lib/scheduling/recoverySecret' as string)) as { deriveRecoverySecret: Derive }).deriveRecoverySecret;
const createStore = async (): Promise<CreateStore> => ((await import('@/lib/scheduling/staffBooking/pendingStore' as string)) as { createPendingStore: CreateStore }).createPendingStore;

function memoryStorage(): Storage & { dump: () => Record<string, string> } {
  const m = new Map<string, string>();
  return {
    get length() { return m.size; },
    clear: () => m.clear(),
    getItem: k => m.get(k) ?? null,
    key: i => [...m.keys()][i] ?? null,
    removeItem: k => void m.delete(k),
    setItem: (k, v) => void m.set(k, v),
    dump: () => Object.fromEntries(m),
  };
}

const KEY = `bk_${'a'.repeat(32)}`;
const CONTENT = JSON.stringify(['off-1', 'court-1', '2027-01-11', '10:00', 2, 'Pat Customer', 'pat@example.test', '0400 000 000', 'Bring a ball hopper']);
const PII = ['Pat Customer', 'pat@example.test', '0400 000 000', 'Bring a ball hopper', 'court-1', 'off-1'];

describe('recovery secret: server-derived, per user and organisation, opaque', () => {
  it('the same session secret, user and organisation always give the same value', async () => {
    const d = await derive();
    expect(d('server-secret', 'user-1', 'org-1')).toBe(d('server-secret', 'user-1', 'org-1'));
  });

  it('a different user, a different organisation or a different server secret gives a different value', async () => {
    const d = await derive();
    const base = d('server-secret', 'user-1', 'org-1');
    expect(d('server-secret', 'user-2', 'org-1')).not.toBe(base);
    expect(d('server-secret', 'user-1', 'org-2')).not.toBe(base);
    expect(d('other-secret', 'user-1', 'org-1')).not.toBe(base);
  });

  it('the encoding is unambiguous: moving characters between the user id and the organisation id changes the value', async () => {
    const d = await derive();
    expect(d('s', 'a|b', 'c')).not.toBe(d('s', 'a', 'b|c'));
    expect(d('s', 'ab', 'c')).not.toBe(d('s', 'a', 'bc'));
  });

  it('the value contains neither id nor the server secret, is url-safe and at least 256 bits', async () => {
    const d = await derive();
    const v = d('server-secret-VALUE', 'user-1-VALUE', 'org-1-VALUE');
    expect(v).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    for (const part of ['server-secret-VALUE', 'user-1-VALUE', 'org-1-VALUE']) expect(v).not.toContain(part);
  });
});

describe('pending store: scoped, write-ahead, no personal data', () => {
  it('a record holds exactly {v, key, fp, savedAt} and nothing a customer typed, no resource or offering id, no secret', async () => {
    const storage = memoryStorage();
    const store = (await createStore())('secret-A', storage);
    expect(await store.write(KEY, CONTENT)).toEqual({ ok: true });
    const entries = Object.entries(storage.dump());
    expect(entries).toHaveLength(1);
    expect(entries[0][0].startsWith('bb.sched.pending.')).toBe(true);
    const rec = JSON.parse(entries[0][1]) as Record<string, unknown>;
    expect(Object.keys(rec).sort()).toEqual(['fp', 'key', 'savedAt', 'v']);
    const everything = JSON.stringify(storage.dump());
    for (const p of PII) expect(everything).not.toContain(p);
    expect(everything).not.toContain('secret-A');
  });

  it('the fingerprint is a keyed MAC: deterministic per secret, different under another secret, and never a plain SHA-256 of the content', async () => {
    const create = await createStore();
    const a = create('secret-A', memoryStorage());
    const b = create('secret-B', memoryStorage());
    const fpA = await a.fingerprint(CONTENT);
    expect(await a.fingerprint(CONTENT)).toBe(fpA);
    expect(await b.fingerprint(CONTENT)).not.toBe(fpA);
    expect(await a.fingerprint(CONTENT + ' ')).not.toBe(fpA);
    const plain = createHash('sha256').update(CONTENT).digest();
    for (const enc of [plain.toString('hex'), plain.toString('base64'), plain.toString('base64url')]) expect(fpA).not.toContain(enc);
  });

  it('isolation: a store built from another secret cannot read, overwrite or clear the record', async () => {
    const storage = memoryStorage();
    const create = await createStore();
    const a = create('secret-A', storage);
    const b = create('secret-B', storage);
    await a.write(KEY, CONTENT);
    expect(b.read()).toBeNull();
    b.clear();
    expect(a.read()?.key).toBe(KEY);
    expect(Object.keys(storage.dump()).join(' ')).not.toContain('secret-');
  });

  it('NO EXPIRY: a record written a day (or a year) ago is still returned; age never turns an unresolved attempt into a failure', async () => {
    const storage = memoryStorage();
    const store = (await createStore())('secret-A', storage);
    await store.write(KEY, CONTENT);
    const [name, raw] = Object.entries(storage.dump())[0];
    for (const years of [1 / 365, 1]) {
      storage.setItem(name, JSON.stringify({ ...JSON.parse(raw), savedAt: Date.now() - years * 365 * 86_400_000 }));
      expect(store.read()?.key).toBe(KEY);
    }
  });

  it('a write that fails is reported (the caller must then send nothing); a malformed or foreign-version record reads as absent and is never trusted', async () => {
    const create = await createStore();
    const failing = { ...memoryStorage(), setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); } } as unknown as Storage;
    expect(await create('secret-A', failing).write(KEY, CONTENT)).toEqual({ ok: false });
    const storage = memoryStorage();
    const store = create('secret-A', storage);
    await store.write(KEY, CONTENT);
    const name = Object.keys(storage.dump())[0];
    for (const bad of ['not json', '{}', JSON.stringify({ v: 2, key: KEY, fp: 'x', savedAt: 1 }), JSON.stringify({ v: 1, key: 'nope', fp: 'x', savedAt: 1 })]) {
      storage.setItem(name, bad);
      expect(store.read()).toBeNull();
    }
  });
});

describe('still to be written with the implementation (database and browser)', () => {
  it.todo('PostgreSQL 16/17 and the Neon driver: commit, lost reply, recover by the original key: one reservation, one hold; a replay with the original key returns the original (already covered for the API; add the UI client path with a remount)');
  it.todo('Playwright (390/768/1440, light/dark): a REAL page reload during a held POST: recovering, then Booked; one reservation; the default-OFF network spy is unchanged');
  it.todo('Playwright: sign in as another user in the same tab: the record is not found and the booking form is available');
  it.todo('Playwright: axe on the recovering state; polite announcement; focusable heading');
});
