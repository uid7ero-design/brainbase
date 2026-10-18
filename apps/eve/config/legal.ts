import { EVE_LEGAL_DOCUMENT_VERSION } from '@ticketing/core';
import { product } from '@/config/product';

// Server-side legal configuration for the public legal pages (/terms,
// /privacy, /refunds). It holds NO invented facts: every operator fact comes
// from the environment and is "unresolved" until set. Nothing here is secret
// (these are published details), and nothing is read in the browser.
//
// Production behaviour (Vercel production only) is FAIL-CLOSED: unless every
// required fact is set AND counsel/the operator has explicitly published the
// text (EVE_LEGAL_PUBLISHED=true), the legal pages render a "not yet
// published" state instead of incomplete legal text. Preview and local builds
// render the draft with every unresolved fact visibly marked, for review.

// Bump when the wording of any legal document changes.
// Single source of truth is @ticketing/core: the same constant is stamped on
// paid orders server-side, so the text shown and the version recorded agree.
export const LEGAL_DOCUMENT_VERSION = EVE_LEGAL_DOCUMENT_VERSION;
export const LEGAL_LAST_UPDATED = '2026-10-18';

// Flip to true only when automatic material-event-change notices are live, so
// the Refunds & cancellations policy never promises a notice Eve does not send.
export const EVENT_CHANGE_NOTICES_ENABLED = true;

export const LEGAL_FACT_KEYS = [
  'operatorLegalName',
  'entityType',
  'entityIdentifier',
  'registeredAddress',
  'governingState',
  'privacyContact',
  'supportResponseTime',
  'retentionPeriods',
] as const;
export type LegalFactKey = (typeof LEGAL_FACT_KEYS)[number];

const ENV_NAMES: Record<LegalFactKey, string> = {
  operatorLegalName: 'EVE_LEGAL_OPERATOR_NAME',
  entityType: 'EVE_LEGAL_ENTITY_TYPE',
  entityIdentifier: 'EVE_LEGAL_ENTITY_IDENTIFIER', // ABN/ACN
  registeredAddress: 'EVE_LEGAL_ADDRESS',
  governingState: 'EVE_LEGAL_STATE',
  privacyContact: 'EVE_PRIVACY_CONTACT',
  supportResponseTime: 'EVE_SUPPORT_RESPONSE_TIME',
  retentionPeriods: 'EVE_LEGAL_RETENTION_SUMMARY',
};

export const PLACEHOLDERS: Record<LegalFactKey, string> = {
  operatorLegalName: '[OPERATOR LEGAL NAME]',
  entityType: '[ENTITY TYPE]',
  entityIdentifier: '[ABN/ACN]',
  registeredAddress: '[REGISTERED/BUSINESS ADDRESS]',
  governingState: '[STATE/TERRITORY]',
  privacyContact: '[PRIVACY CONTACT]',
  supportResponseTime: '[SUPPORT RESPONSE TIME]',
  retentionPeriods: '[RETENTION PERIODS]',
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

function clean(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  return t ? t : null;
}

export function getLegalConfig(env: Record<string, string | undefined> = process.env): LegalConfig {
  const facts = {} as Record<LegalFactKey, string | null>;
  for (const k of LEGAL_FACT_KEYS) facts[k] = clean(env[ENV_NAMES[k]]);
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
