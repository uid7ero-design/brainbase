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

export const EVE_LEGAL_DOCUMENT_VERSION = '2026-10-24';

export const EVE_TERMS_VERSION = EVE_LEGAL_DOCUMENT_VERSION;
export const EVE_REFUNDS_VERSION = EVE_LEGAL_DOCUMENT_VERSION;

export type LegalAcceptance = {
  termsVersion: string;
  refundsVersion: string;
};

export function currentEveLegalAcceptance(): LegalAcceptance {
  return { termsVersion: EVE_TERMS_VERSION, refundsVersion: EVE_REFUNDS_VERSION };
}

// The version an Eve FREE registration records for its linked notice ("By
// registering you agree to the Terms and acknowledge the Privacy Policy.").
// There is no checkbox, so this is evidence of the version in force for that
// notice flow — not acceptance, and not proof it was read. Terms and Privacy
// share the one document version; Refunds is not part of the free notice.
export function currentEveLegalNoticeVersion(): string {
  return EVE_LEGAL_DOCUMENT_VERSION;
}

export function isDraftLegalVersion(version: string): boolean {
  return /draft/i.test(version);
}
