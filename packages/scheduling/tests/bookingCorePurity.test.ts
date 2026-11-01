import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// The Phase 2C.1 booking core plans and evaluates; it never writes. Besides the package boundary test (no host, framework or database imports), these checks pin that
// the booking modules reference no repository or write port, take no clock, and are asynchronous nowhere: they cannot create a reservation, an occurrence, a series or a
// hold, because nothing in them can reach one.
const SRC = path.resolve(__dirname, '../src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const FILES = ['bookingErrors.ts', 'occurrencePlanning.ts', 'bookingEvaluation.ts', 'seriesPlanning.ts'];
const sources = FILES.map(f => [f, strip(readFileSync(path.join(SRC, f), 'utf8'))] as const);

describe('booking core modules are pure by construction', () => {
  for (const [file, src] of sources) {
    it(`${file} references no repository, write port or persistence call`, () => {
      expect(src).not.toMatch(/ReservationRepository|SchedulingConfigRepository|CustomerProvider|PaymentProvider|NotificationProvider|SchedulingPlatform/);
      expect(src).not.toMatch(/createReservation|createOccurrence|createSeries|createHold|insert|upsert|\bsave\w*\(|\bwrite\w*\(|\bdelete\w*\(/i);
      expect(src).not.toMatch(/\basync\b|\bawait\b|Promise|fetch\(/);
    });
    it(`${file} takes no clock and no randomness: "now" and "today" only arrive as arguments`, () => {
      expect(src).not.toMatch(/\bDate\.now\(|new Date\(\)|performance\.now|Math\.random|crypto\./);
    });
    it(`${file} imports only types from the persistence module`, () => {
      for (const m of src.matchAll(/import\s+(type\s+)?\{[^}]*\}\s+from\s+'\.\/persistence'/g)) expect(m[0]).toMatch(/import type \{/);
    });
  }
  it('is exported from the package entry point', () => {
    const index = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
    for (const m of ['bookingErrors', 'occurrencePlanning', 'bookingEvaluation', 'seriesPlanning']) expect(index).toContain(`export * from './${m}'`);
  });
});
