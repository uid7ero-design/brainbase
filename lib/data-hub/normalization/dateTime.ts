// Data Hub 6.2D4C-B2A — strict, deterministic date/time/datetime grammars
// and IANA timezone instant resolution.
//
// Nothing here ever calls `new Date(someArbitraryString)` (locale-dependent,
// implementation-defined parsing) or reads the host process's local
// timezone. Calendar-field arithmetic uses plain integers; the only place
// `Date`/`Intl` are used at all is as an exact, deterministic calendar
// calculator (`Date.UTC`) and IANA-tzdata offset lookup — both driven
// entirely by explicit UTC millisecond instants and an explicit zone
// argument, never by `Date.now()` or the ambient environment.

export type DatePolicy = "AU_DD_MM_YYYY" | "ISO_8601";

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export interface ClockTime {
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  fraction: string | null; // e.g. "123" for ".123" — preserved verbatim, never rounded
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1];
}

export function isValidCalendarDate(d: CalendarDate): boolean {
  if (d.year < 1 || d.year > 9999) return false;
  if (d.month < 1 || d.month > 12) return false;
  if (d.day < 1 || d.day > daysInMonth(d.year, d.month)) return false;
  return true;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

export function calendarDateToIsoString(d: CalendarDate): string {
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}

const AU_DATE_RE = /^([0-9]{2})\/([0-9]{2})\/([0-9]{4})$/;
const ISO_DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

// A narrow, explicit accommodation for D4B's own raw-evidence shape: SheetJS
// (via `cellDates: true`) surfaces an Excel date-only cell as a JS `Date`
// object at UTC midnight, which lib/data-hub/workbookParser.ts's
// `normalizeCellValue` then converts to a plain ISO string via
// `.toISOString()` before it is ever staged as raw evidence — i.e. a raw
// STRING cell like "2026-03-15T00:00:00.000Z". A governed DATE rule with
// datePolicy ISO_8601 must be able to consume that exact, narrow shape
// (calendar date + literal UTC-midnight time-of-day) without this module
// generally treating arbitrary datetimes as dates: only the EXACT literal
// "T00:00:00.000Z" suffix is accepted, appended to an otherwise-valid ISO
// calendar date; any other time-of-day is rejected as a datetime, not a
// date.
const ISO_MIDNIGHT_TIMESTAMP_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T00:00:00\.000Z$/;

export type DateParseResult = { ok: true; date: CalendarDate } | { ok: false; reason: "MALFORMED" | "INVALID_CALENDAR" };

export function parseStrictDate(raw: string, policy: DatePolicy): DateParseResult {
  if (policy === "AU_DD_MM_YYYY") {
    const m = AU_DATE_RE.exec(raw);
    if (!m) return { ok: false, reason: "MALFORMED" };
    const [, dd, mm, yyyy] = m;
    const d: CalendarDate = { day: Number(dd), month: Number(mm), year: Number(yyyy) };
    return isValidCalendarDate(d) ? { ok: true, date: d } : { ok: false, reason: "INVALID_CALENDAR" };
  }
  // ISO_8601
  const plain = ISO_DATE_RE.exec(raw);
  if (plain) {
    const [, yyyy, mm, dd] = plain;
    const d: CalendarDate = { year: Number(yyyy), month: Number(mm), day: Number(dd) };
    return isValidCalendarDate(d) ? { ok: true, date: d } : { ok: false, reason: "INVALID_CALENDAR" };
  }
  const midnight = ISO_MIDNIGHT_TIMESTAMP_RE.exec(raw);
  if (midnight) {
    const [, yyyy, mm, dd] = midnight;
    const d: CalendarDate = { year: Number(yyyy), month: Number(mm), day: Number(dd) };
    return isValidCalendarDate(d) ? { ok: true, date: d } : { ok: false, reason: "INVALID_CALENDAR" };
  }
  return { ok: false, reason: "MALFORMED" };
}

// HH:mm, HH:mm:ss, or HH:mm:ss.fff (1-9 fractional digits, preserved
// verbatim — never rounded/truncated).
const TIME_RE = /^([0-9]{2}):([0-9]{2})(?::([0-9]{2})(?:\.([0-9]{1,9}))?)?$/;

export type TimeParseResult = { ok: true; time: ClockTime } | { ok: false; reason: "MALFORMED" | "INVALID_CLOCK" };

export function parseStrictTime(raw: string): TimeParseResult {
  const m = TIME_RE.exec(raw);
  if (!m) return { ok: false, reason: "MALFORMED" };
  const [, hh, mm, ss, frac] = m;
  const t: ClockTime = { hour: Number(hh), minute: Number(mm), second: ss === undefined ? 0 : Number(ss), fraction: frac ?? null };
  if (t.hour < 0 || t.hour > 23) return { ok: false, reason: "INVALID_CLOCK" };
  if (t.minute < 0 || t.minute > 59) return { ok: false, reason: "INVALID_CLOCK" };
  if (t.second < 0 || t.second > 59) return { ok: false, reason: "INVALID_CLOCK" };
  return { ok: true, time: t };
}

export function clockTimeToCanonicalString(t: ClockTime): string {
  const base = `${pad(t.hour, 2)}:${pad(t.minute, 2)}:${pad(t.second, 2)}`;
  return t.fraction ? `${base}.${t.fraction}` : base;
}

// ---------------------------------------------------------------------------
// DATETIME grammar
// ---------------------------------------------------------------------------

export interface ParsedDateTime {
  date: CalendarDate;
  time: ClockTime;
  /** null = no offset present in the source string; "Z" = UTC; otherwise "+HH:mm"/"-HH:mm". */
  offset: string | null;
}

const OFFSET_RE = /(Z|[+-][0-9]{2}:[0-9]{2})$/;

export type DateTimeParseResult = { ok: true; value: ParsedDateTime } | { ok: false; reason: "MALFORMED" | "INVALID_CALENDAR_OR_CLOCK" };

/**
 * Governed datetime grammar (this system's own explicit convention, not a
 * literal transcription of any external date/time standard): a date
 * component per `datePolicy` (AU "DD/MM/YYYY" or ISO "YYYY-MM-DD"),
 * literal "T", a time component, and an optional trailing offset
 * ("Z" or "+HH:mm"/"-HH:mm"). Whether an offset is required/forbidden is
 * governed by timeZonePolicy, checked by the caller — this function only
 * parses the grammar and reports whichever offset (if any) was present.
 */
export function parseStrictDateTime(raw: string, datePolicy: DatePolicy): DateTimeParseResult {
  const tIndex = raw.indexOf("T");
  if (tIndex < 0) return { ok: false, reason: "MALFORMED" };
  const datePart = raw.slice(0, tIndex);
  let rest = raw.slice(tIndex + 1);

  let offset: string | null = null;
  const offsetMatch = OFFSET_RE.exec(rest);
  if (offsetMatch) {
    offset = offsetMatch[1];
    rest = rest.slice(0, rest.length - offset.length);
  }

  // The DATE midnight-timestamp accommodation is deliberately NOT reused
  // here — a DATETIME's date component is always exactly the plain
  // AU/ISO calendar-date grammar, never the ISO-midnight-timestamp shape
  // (that shape IS a datetime, so it belongs to parseStrictDate's own
  // narrow DATE accommodation only, not to this function).
  const dateGrammarMatch = datePolicy === "AU_DD_MM_YYYY" ? AU_DATE_RE.exec(datePart) : ISO_DATE_RE.exec(datePart);
  const timeGrammarMatch = TIME_RE.test(rest);
  if (!dateGrammarMatch || !timeGrammarMatch) return { ok: false, reason: "MALFORMED" };

  const [, p1, p2, p3] = dateGrammarMatch;
  const date: CalendarDate = datePolicy === "AU_DD_MM_YYYY" ? { day: Number(p1), month: Number(p2), year: Number(p3) } : { year: Number(p1), month: Number(p2), day: Number(p3) };
  if (!isValidCalendarDate(date)) return { ok: false, reason: "INVALID_CALENDAR_OR_CLOCK" };

  const timeResult = parseStrictTime(rest);
  if (!timeResult.ok) return { ok: false, reason: "INVALID_CALENDAR_OR_CLOCK" };

  return { ok: true, value: { date, time: timeResult.time, offset } };
}

// ---------------------------------------------------------------------------
// IANA timezone instant resolution (native Intl only; no dependency added)
// ---------------------------------------------------------------------------

export function isValidIanaTimeZone(zone: string): boolean {
  try {
    // Intl.DateTimeFormat throws RangeError for an unrecognized zone
    // identifier; construction is the authoritative validity check (more
    // reliable across Node/ICU builds than Intl.supportedValuesOf, which is
    // an optional API).
    void new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

interface WallClockParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function offsetFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "longOffset",
  });
}

function wallClockFormatter(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function partsToWallClock(parts: Intl.DateTimeFormatPart[]): WallClockParts {
  const get = (type: string): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Intl.DateTimeFormat did not produce a "${type}" part`);
    // Defensive: some ICU builds have historically emitted "24" for
    // midnight under hourCycle "h23"; normalize that back to 0 rather than
    // silently accepting an out-of-range hour. Not observed on this
    // engine/Node version during development, but guarded regardless.
    const n = Number(part.value);
    return type === "hour" && n === 24 ? 0 : n;
  };
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

/** Exact UTC offset (in minutes, east-positive) in effect for `zone` at the given UTC instant. */
export function offsetMinutesAt(zone: string, utcMs: number): number {
  const parts = offsetFormatter(zone).formatToParts(new Date(utcMs));
  const tzPart = parts.find((p) => p.type === "timeZoneName");
  if (!tzPart) throw new Error("Intl.DateTimeFormat did not produce a timeZoneName part");
  if (tzPart.value === "GMT") return 0;
  const m = /^GMT([+-])(\d{2}):(\d{2})$/.exec(tzPart.value);
  if (!m) throw new Error(`unexpected longOffset value: ${tzPart.value}`);
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

function wallClockPartsAt(zone: string, utcMs: number): WallClockParts {
  return partsToWallClock(wallClockFormatter(zone).formatToParts(new Date(utcMs)));
}

function wallClockEquals(a: WallClockParts, b: WallClockParts): boolean {
  return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && a.second === b.second;
}

export type LocalToInstantResult = { ok: true; utcMs: number } | { ok: false; kind: "NONEXISTENT" | "AMBIGUOUS" };

// Comfortably larger than any real-world DST jump (the vast majority are 1
// hour; a small number of zones, e.g. Lord Howe Island, use 30 minutes) —
// wide enough to reliably observe the offset actually in effect on both
// sides of a nearby transition, without needing tzdata's own transition
// table directly.
const TRANSITION_PROBE_WINDOW_MS = 3 * 60 * 60 * 1000;

/**
 * Resolves a local wall-clock date+time in `zone` to a UTC instant, with
 * explicit, fail-closed handling of the two DST edge cases: a "spring
 * forward" gap (the local time never occurs) and a "fall back" overlap (the
 * local time occurs twice, at two different UTC instants/offsets). Never
 * silently picks the earlier or later candidate for an ambiguous time.
 *
 * A naive "two-guess" technique (guess an instant from the offset at the
 * naive UTC-as-if-local reading, then re-derive a second guess from the
 * offset AT that first candidate) is NOT sufficient here: for a fall-back
 * overlap, the naive guess and its own candidate can both land solidly
 * inside the SAME offset regime (since the true ambiguous instants are
 * offset from the naive guess by several hours, not adjacent to it), so
 * that approach can silently collapse two valid candidates into one and
 * miss the ambiguity entirely — exactly the "silently pick one side of DST
 * overlap" failure mode this contract must never exhibit. Verified by hand
 * against a real fall-back case during development before trusting this
 * implementation.
 *
 * Instead: take one approximate candidate instant (naive guess adjusted by
 * the offset at the naive guess), then read the zone's offset a fixed
 * window on either side of THAT candidate — collecting every distinct
 * offset that could plausibly be in effect near the true instant — and
 * test every resulting candidate instant by formatting it back into the
 * zone and checking it reproduces the input wall-clock exactly. Zero
 * matches means the local time doesn't exist; two matches means it's
 * genuinely ambiguous; anything else is a real, unique instant.
 */
export function localWallClockToUtcInstant(zone: string, wall: WallClockParts): LocalToInstantResult {
  const naiveUtcMs = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);

  const offsetAtNaiveGuess = offsetMinutesAt(zone, naiveUtcMs);
  const approxCandidateMs = naiveUtcMs - offsetAtNaiveGuess * 60_000;

  const offsetJustBefore = offsetMinutesAt(zone, approxCandidateMs - TRANSITION_PROBE_WINDOW_MS);
  const offsetJustAfter = offsetMinutesAt(zone, approxCandidateMs + TRANSITION_PROBE_WINDOW_MS);

  const candidateOffsets = Array.from(new Set([offsetAtNaiveGuess, offsetJustBefore, offsetJustAfter]));
  const candidateMsSet = Array.from(new Set(candidateOffsets.map((offset) => naiveUtcMs - offset * 60_000)));
  const validCandidates = candidateMsSet.filter((ms) => wallClockEquals(wallClockPartsAt(zone, ms), wall));

  if (validCandidates.length === 0) return { ok: false, kind: "NONEXISTENT" };
  if (validCandidates.length > 1) return { ok: false, kind: "AMBIGUOUS" };
  return { ok: true, utcMs: validCandidates[0] };
}

/** Canonical UTC instant string: "YYYY-MM-DDTHH:mm:ss[.fff]Z". Fraction (if any) is preserved verbatim from the source, never invented/rounded. */
export function utcInstantToCanonicalString(utcMs: number, fraction: string | null): string {
  const d = new Date(utcMs);
  const iso = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${pad(d.getUTCDate(), 2)}T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${pad(d.getUTCSeconds(), 2)}`;
  return fraction ? `${iso}.${fraction}Z` : `${iso}Z`;
}
