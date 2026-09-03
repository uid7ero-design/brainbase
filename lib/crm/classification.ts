// Canonical CRM contact classification vocabulary. Single source of
// truth for the six values, their human-readable labels, and validation
// — every consumer (Events sync, Events historical backfill, the CRM
// contacts API, ContactForm.tsx, the contact list/detail pages, and
// ClassificationBadge.tsx) imports from here rather than re-declaring
// the list, so the six values can never drift out of sync with the
// database CHECK constraint (scripts/add-crm-contact-classification.sql)
// or with each other.
//
// Classification is NOT identity — one crm_contacts row remains one
// person/contact regardless of its classification. It is also NOT
// source (where the contact originated from); source stays exactly
// where it already lives, the informal `notes` marker Events sync
// already writes ('Events / Event Booking' / 'Events / Historical
// Backfill') — this module has nothing to do with that and does not
// reference it.
//
// Colour/tone presentation is deliberately NOT here — see
// ClassificationBadge.tsx's own comment for why that stays a UI-layer
// concern, separate from this data-layer vocabulary.

export const CRM_CONTACT_CLASSIFICATIONS = [
  'CLIENT',
  'LEAD',
  'EVENT_CONTACT',
  'SUPPLIER',
  'PARTNER',
  'OTHER',
] as const;

export type CrmContactClassification = typeof CRM_CONTACT_CLASSIFICATIONS[number];

export const CRM_CONTACT_CLASSIFICATION_LABELS: Record<CrmContactClassification, string> = {
  CLIENT: 'Client',
  LEAD: 'Lead',
  EVENT_CONTACT: 'Event Contact',
  SUPPLIER: 'Supplier',
  PARTNER: 'Partner',
  OTHER: 'Other',
};

// The classification Events sets on a brand-new contact it creates
// (never on a matched-existing one — see lib/crm/eventSync.ts and
// lib/crm/eventBackfill.ts's own comments on that non-overwrite rule).
export const EVENT_CONTACT_CLASSIFICATION: CrmContactClassification = 'EVENT_CONTACT';

// True only for one of the six canonical values — never true for null,
// undefined, empty string, or any other value. Callers treat
// null/undefined/'' as "unclassified" (a valid, accepted state) via
// their own explicit check BEFORE calling this, so this function never
// has to make that judgment call itself; it exists solely to answer
// "is this specific non-empty string one of the six real values", which
// both the API routes (reject anything else with a 400 — never let an
// invalid string reach a SQL statement) and any UI validation need.
export function isValidCrmContactClassification(value: unknown): value is CrmContactClassification {
  return typeof value === 'string' && (CRM_CONTACT_CLASSIFICATIONS as readonly string[]).includes(value);
}
