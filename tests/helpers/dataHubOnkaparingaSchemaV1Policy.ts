// Data Hub 6.2D3B — the deterministic header-label sensitivity policy
// used to RESOLVE (offline, once) the sensitivity_class committed per
// column in config/data-hub/onkaparinga-monthly-operations-v1.json.
//
// TEST-SIDE ONLY. Nothing at runtime classifies columns: the resolved
// values are committed in the manifest and the seed inserts exactly those
// values. This file exists so the containment test can prove every
// committed value is what this policy yields — i.e. no hand-edited
// downgrade and no runtime guessing. No imports; never imported by
// app/lib/modules/components.
//
// Policy (conservative, over-classifies by design):
//   * header tokens = lowercase, split on any non-alphanumeric run;
//   * a single-word trigger matches a WHOLE token, or that token with a
//     trailing plural "s" (so "Drivers" and "Notes" match, but "Contam"
//     never matches "contact" and "Total" never matches "lot");
//   * a multi-word trigger matches the same consecutive token run;
//   * any match -> PERSONALLY_IDENTIFIABLE, otherwise CONFIDENTIAL.
// PUBLIC / INTERNAL / HIGHLY_SENSITIVE are never produced in D3B.

export const PII_TRIGGER_TERMS: readonly string[] = [
  'name', 'driver', 'employee', 'phone', 'contact', 'address', 'street',
  'suburb', 'postcode', 'property', 'account', 'lot', 'unit', 'created by',
  'reported by', 'booked by', 'user', 'username', 'notes', 'note', 'lat',
  'lng', 'location', 'google maps',
]

export type D3bSensitivityClass = 'PERSONALLY_IDENTIFIABLE' | 'CONFIDENTIAL'

export function headerTokens(header: string): string[] {
  return header.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
}

function tokenMatches(token: string, term: string): boolean {
  return token === term || token === `${term}s`
}

export function matchedPiiTerms(header: string): string[] {
  const tokens = headerTokens(header)
  return PII_TRIGGER_TERMS.filter(term => {
    const parts = term.split(' ')
    for (let i = 0; i + parts.length <= tokens.length; i++) {
      if (parts.every((p, j) => (j === parts.length - 1 ? tokenMatches(tokens[i + j], p) : tokens[i + j] === p))) {
        return true
      }
    }
    return false
  })
}

export function classifyHeader(header: string): D3bSensitivityClass {
  return matchedPiiTerms(header).length > 0 ? 'PERSONALLY_IDENTIFIABLE' : 'CONFIDENTIAL'
}
