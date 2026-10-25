import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// Availability is advisory and read-only. Besides the package boundary test (no host, framework or database imports, no clock),
// these checks pin that the availability modules reference no write port, no repository and no persistence type: they cannot create
// a reservation, an occurrence or a resource hold because nothing in them can reach one.
const SRC = path.resolve(__dirname, '../src');
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const sources = ['availability.ts', 'availabilityRules.ts'].map(f => [f, strip(readFileSync(path.join(SRC, f), 'utf8'))] as const);

describe('availability modules are read-only by construction', () => {
  for (const [file, src] of sources) {
    it(`${file} references no repository, write port or reservation creation`, () => {
      expect(src).not.toMatch(/ReservationRepository|SchedulingConfigRepository|CustomerProvider|PaymentProvider|NotificationProvider|SchedulingPlatform/);
      expect(src).not.toMatch(/createReservation|createOccurrence|createHold|insert|upsert|\bsave\w*\(|\bwrite\w*\(|\bdelete\w*\(/i);
      expect(src).not.toMatch(/\basync\b|\bawait\b|Promise|fetch\(/);
    });
    it(`${file} takes no clock: "now" can only arrive as an argument`, () => {
      expect(src).not.toMatch(/\bDate\.now\(|new Date\(\)|performance\.now|Intl\.DateTimeFormat\(\)\.resolvedOptions/);
    });
  }
  it('the only persistence import is the read-only ResourceHold type', () => {
    const imports = [...sources[0][1].matchAll(/import type \{([^}]*)\} from '\.\/persistence'/g)].map(m => m[1].trim());
    expect(imports).toEqual(['ResourceHold']);
  });
  it('is exported from the package entry point', () => {
    const index = readFileSync(path.join(SRC, 'index.ts'), 'utf8');
    expect(index).toMatch(/export \* from '\.\/availabilityRules'/);
    expect(index).toMatch(/export \* from '\.\/availability'/);
  });
});
