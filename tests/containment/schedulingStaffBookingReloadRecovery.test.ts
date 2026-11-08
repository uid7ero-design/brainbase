import { describe, it } from 'vitest';

// Phase 2C.3c reload-recovery: TEST SPECIFICATION ONLY (design PR). Each entry is a pending test that the implementation PR must turn into a real one.
// See docs/architecture/scheduling-phase2c3c-reload-recovery-design.md, section 8. Nothing here imports product code; there is no implementation yet.

describe('reload-recovery: record and scope (machine/storage, pure)', () => {
  it.todo('1. the record has exactly {v, key, fp, savedAt} and contains no name, email, phone, notes, resource, org or user id (property test)');
  it.todo('2. fp is a keyed MAC: the same content under two keys differs, and it is not a plain SHA-256 of the content');
  it.todo('3. scope token: different (user, org) pairs differ, the same pair is stable, it contains neither id, a record under another scope is invisible');
  it.todo('4. write-ahead: a failing storage write sends nothing; a working one has written the record before fetch is called');
  it.todo('5. removed on created and on every stable refusal code; kept on uncertain, unsure, retry and conflict');
  it.todo('6. expiry: a record older than 15 minutes, or malformed, or the wrong version, is deleted and ignored');
  it.todo('7. recovering is inert: every action except the lookup result returns the identical state object; keyFor, adopt and discard are never called');
  it.todo('8. adopt only with a matching fingerprint; a different one refuses and mints nothing; one key per episode in the random-sequence test');
});

describe('reload-recovery: dialog (jsdom + axe)', () => {
  it.todo('9. close from "could not confirm" then reopen: "Checking a booking you started earlier", a lookup by the original key, no POST, no form');
  it.todo('10. remount with a record and the lookup returning the reservation: Booked (saved earlier), record deleted, calendar refreshed');
  it.todo('11. missing before the quiet period keeps checking with no form and no new key; after it the record clears and the form is available');
  it.todo('12. the same content re-entered during the quiet period posts the ORIGINAL key; different content is refused with no POST');
  it.todo('13. fail closed: no scope prop, throwing storage, no crypto.subtle, no IndexedDB each give no Book button and no writes');
});

describe('reload-recovery: database (PostgreSQL 16/17 and the Neon driver, real routes)', () => {
  it.todo('14. commit, lost reply, remount: the original key resolves to the original reservation; one reservation, one hold');
  it.todo('15. close/reopen/rebook after a lost reply uses the original key and is replayed:true with one hold');
  it.todo('16. the false "just taken. Nothing was booked." for the staff member’s own booking can no longer occur');
});

describe('reload-recovery: browser (Playwright, 390/768/1440, light and dark)', () => {
  it.todo('17. a real reload during a held POST: checking, then Booked; one reservation; the gate-off network spy is unchanged');
  it.todo('18. signing in as another user in the same tab: the record is not found and the form is available');
  it.todo('19. the recovering state is announced politely, has a focusable heading and no axe violations');
});
