import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describeReservationRepositoryContract } from './support/reservationRepositoryContract';
import { makeInMemoryHarness } from './support/inMemoryReservationRepository';

describeReservationRepositoryContract('in-memory reference implementation', makeInMemoryHarness);

describe('port signatures make tenant scoping unavoidable', () => {
  const contracts = readFileSync(path.resolve(__dirname, '../src/contracts.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  // Every data-access method declared on a port must take the tenant first.
  const portBlocks = [...contracts.matchAll(/export interface (CustomerProvider|ReservationRepository|ResourceAvailability|PaymentProvider|NotificationProvider)\s*\{([\s\S]*?)\n\}/g)];

  it('finds all five data-access ports', () => {
    expect(portBlocks.map(m => m[1]).sort()).toEqual(
      ['CustomerProvider', 'NotificationProvider', 'PaymentProvider', 'ReservationRepository', 'ResourceAvailability'],
    );
  });

  for (const [, name, body] of portBlocks) {
    it(`${name}: every method takes (tenant: TenantContext, ...) as its first parameter`, () => {
      const methods = [...body.matchAll(/^\s{2}(\w+)\(\s*([^)]*?)\)\s*:/gm)];
      expect(methods.length).toBeGreaterThan(0);
      for (const [, method, params] of methods) {
        expect(params.trim().startsWith('tenant: TenantContext'), `${name}.${method}(${params.trim()})`).toBe(true);
      }
    });
  }

  it('the tenant carries the organisation id as a plain string (organisation_id TEXT, never a uuid type)', () => {
    const types = readFileSync(path.resolve(__dirname, '../src/types.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(types).toMatch(/export type OrganisationId = string;/);
    expect(types).not.toMatch(/uuid/i);
  });
});
