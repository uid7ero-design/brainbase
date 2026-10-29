import type { TenantContext } from '@scheduling/core';

// The package compiles with no DOM or Node typings (it must run on any runtime), so the one
// global it needs is declared here. Web Crypto is present in Node 19+, browsers and edge runtimes.
declare const crypto: { randomUUID(): string };

export function newId(): string {
  return crypto.randomUUID();
}

/** Public and customer actors act on their own behalf and only on published schedules. */
export function isSelfService(tenant: TenantContext): boolean {
  return tenant.actor.kind === 'public' || tenant.actor.kind === 'customer';
}
