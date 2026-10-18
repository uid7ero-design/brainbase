// Identifiers of the Eve legal documents a paid purchase is made on.
//
// These are TRUSTED SERVER CONSTANTS: they are stamped on the order by the
// gated Eve paid-checkout path and are never read from a request. They must
// name the text the buyer was actually shown, so the Eve legal pages render
// LEGAL_DOCUMENT_VERSION from here (apps/eve/config/legal.ts re-exports it).
//
// A version ending in "-draft" identifies unpublished text. Preview may stamp
// it; Production must refuse to (see isDraftLegalVersion). Bump the constants
// when the published text changes.

export const EVE_LEGAL_DOCUMENT_VERSION = '0.1-draft';

export const EVE_TERMS_VERSION = EVE_LEGAL_DOCUMENT_VERSION;
export const EVE_REFUNDS_VERSION = EVE_LEGAL_DOCUMENT_VERSION;

export type LegalAcceptance = {
  termsVersion: string;
  refundsVersion: string;
};

export function currentEveLegalAcceptance(): LegalAcceptance {
  return { termsVersion: EVE_TERMS_VERSION, refundsVersion: EVE_REFUNDS_VERSION };
}

export function isDraftLegalVersion(version: string): boolean {
  return /draft/i.test(version);
}
