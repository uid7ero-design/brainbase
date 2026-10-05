// Data Hub 6.2D4D1A — exact, timezone-blind comparison of already-canonical
// DATE/TIME/DATETIME strings.
//
// This performs NO calendar arithmetic, NO timezone resolution, and NO
// re-parsing of the normalization layer's own grammar — D4C-B2A has
// already done that work (see lib/data-hub/normalization/dateTime.ts). The
// canonical shapes it produces are fixed-width in every field except the
// optional fractional-second suffix, which is PRESERVED VERBATIM from the
// source (1-9 digits, never padded/rounded by the normalizer):
//   DATE:     YYYY-MM-DD
//   TIME:     HH:mm:ss[.fff...]
//   DATETIME: YYYY-MM-DDTHH:mm:ss[.fff...][Z]   ("Z" present iff the
//             column's governed timeZonePolicy resolves to a real UTC
//             instant; UNSPECIFIED_LOCAL columns never carry it — but a
//             single column is always internally consistent, since its
//             timeZonePolicy is one fixed governed rule for every cell)
//
// Because the fraction is variable-length, naive plain string comparison
// has one latent bug: "10:00:00.1" and "10:00:00.10" represent the exact
// same instant (0.1s == 0.10s) but are different strings, and plain
// string comparison would (incorrectly) treat the shorter one as "less"
// rather than equal. canonicalTemporalKey() neutralizes exactly this one
// case — by stripping the fractional suffix's own trailing zeros, exactly
// analogous to how lib/data-hub/normalization/decimal.ts's own
// normalizeExactDecimal() strips trailing fractional zeros from a decimal
// value — without touching the fixed-width date/time/zone fields at all.
// Every other ordering case (different, non-equal fractions) is already
// correct under plain string comparison once the matching fixed-width
// prefix is accounted for, because a decimal fraction's digit string,
// once trailing zeros are removed, compares lexicographically in exactly
// the same direction as its numeric value.

const TRAILING_FRACTION_RE = /^(.*?)\.([0-9]+)(Z?)$/;

export function canonicalTemporalKey(value: string): string {
  const m = TRAILING_FRACTION_RE.exec(value);
  if (!m) return value;
  const [, base, fraction, zoneSuffix] = m;
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length === 0 ? `${base}${zoneSuffix}` : `${base}.${trimmed}${zoneSuffix}`;
}

export function compareCanonicalTemporal(a: string, b: string): -1 | 0 | 1 {
  const ka = canonicalTemporalKey(a);
  const kb = canonicalTemporalKey(b);
  if (ka === kb) return 0;
  return ka < kb ? -1 : 1;
}
