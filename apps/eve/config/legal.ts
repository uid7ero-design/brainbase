import { EVE_LEGAL_DOCUMENT_VERSION } from '@ticketing/core';
import { product } from '@/config/product';

// Server-side legal configuration for the public legal pages (/terms,
// /privacy, /refunds). Nothing here is secret (these are published details),
// and nothing is read in the browser.
//
// The operator facts below were supplied and approved by the operator and are
// reviewed as code. They are still DRAFT until the accountant and counsel have
// confirmed them (see docs/architecture/decisions/0013-eve-launch-compliance.md).
// A fact set to null is "unresolved": it renders as a visibly marked
// placeholder and keeps the pages from ever being treated as final.
//
// Production behaviour (Vercel production only) is FAIL-CLOSED: unless every
// fact is set, a real support address exists AND the operator has explicitly
// published the text (EVE_LEGAL_PUBLISHED=true), the legal pages render a "not
// yet published" state instead of legal text. Preview and local builds render
// the draft, with a DRAFT banner, for review.

// Bump when the wording of any legal document changes. A version containing
// "draft" is refused for paid-purchase acceptance on Production.
// Single source of truth is @ticketing/core: the same constant is stamped on
// paid orders server-side, so the text shown and the version recorded agree.
export const LEGAL_DOCUMENT_VERSION = EVE_LEGAL_DOCUMENT_VERSION;
export const LEGAL_LAST_UPDATED = '21 October 2026';

// Flip to true only when automatic material-event-change notices are live, so
// the Refunds & cancellations policy never promises a notice Eve does not send.
export const EVENT_CHANGE_NOTICES_ENABLED = true;

export const LEGAL_FACT_KEYS = [
  'operatorLegalName',
  'entityType',
  'entityIdentifier',
  'operatorLocation',
  'governingState',
] as const;
export type LegalFactKey = (typeof LEGAL_FACT_KEYS)[number];

// Public operator facts. "operatorLocation" is deliberately town/state level:
// no residential street address is published.
export const OPERATOR_FACTS: Record<LegalFactKey, string | null> = {
  operatorLegalName: 'James Ronald Palmer',
  entityType: 'sole trader',
  entityIdentifier: 'ABN 32 207 559 504',
  operatorLocation: 'Adelaide, South Australia',
  governingState: 'South Australia',
};

export const PLACEHOLDERS: Record<LegalFactKey, string> = {
  operatorLegalName: '[OPERATOR LEGAL NAME]',
  entityType: '[ENTITY TYPE]',
  entityIdentifier: '[ABN/ACN]',
  operatorLocation: '[OPERATOR LOCATION]',
  governingState: '[STATE/TERRITORY]',
};

export type LegalConfig = {
  facts: Record<LegalFactKey, string | null>;
  supportEmail: string | null;
  unresolved: LegalFactKey[];
  supportEmailResolved: boolean;
  published: boolean;
  // Production fail-closed switch: true only on Vercel production.
  strict: boolean;
  // True when the pages may present themselves as final launch terms.
  isFinal: boolean;
  // Whether the documents may be shown at all in this environment.
  showDocuments: boolean;
};

function clean(v: string | null | undefined): string | null {
  const t = (v ?? '').trim();
  return t ? t : null;
}

export function getLegalConfig(
  env: Record<string, string | undefined> = process.env,
  operatorFacts: Record<LegalFactKey, string | null> = OPERATOR_FACTS,
): LegalConfig {
  const facts = {} as Record<LegalFactKey, string | null>;
  for (const k of LEGAL_FACT_KEYS) facts[k] = clean(operatorFacts[k]);
  const unresolved = LEGAL_FACT_KEYS.filter(k => facts[k] === null);

  // The placeholder default (support@eve.invalid) is not a real address.
  const support = clean(env.EVE_SUPPORT_EMAIL) ?? (product.supportEmail.endsWith('.invalid') ? null : product.supportEmail);
  const supportEmailResolved = !!support && !support.endsWith('.invalid');

  const published = env.EVE_LEGAL_PUBLISHED === 'true';
  const strict = env.VERCEL_ENV === 'production';
  const isFinal = unresolved.length === 0 && supportEmailResolved && published;
  return {
    facts,
    supportEmail: supportEmailResolved ? support : null,
    unresolved,
    supportEmailResolved,
    published,
    strict,
    isFinal,
    showDocuments: !strict || isFinal,
  };
}

export const LEGAL_LINKS = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refunds', label: 'Refunds & cancellations' },
] as const;
