import type { IanaTimezone, InstantWindow, LocalDate, LocalTime } from './types';
import { isIanaTimezone, isLocalDate, isLocalTime } from './validation';

// Wall-clock to instant conversion, DST-aware and pure (Intl only, no I/O, no database).
//
// Why the core does this and not the database: Postgres silently resolves a nonexistent local
// time (spring-forward gap) and an ambiguous one (fall-back overlap), so a database cannot tell
// the caller that the request was odd. The rules here are the design's (see
// docs/architecture/scheduling-phase2-schema-outline.md section 4):
//   * gap       - the local time does not exist. Staff-entered slots must be rejected; generated
//                 recurring occurrences resolve FORWARD by the gap length (02:30 -> 03:30) and
//                 are flagged;
//   * ambiguous - the local time happens twice. Resolve to the EARLIER instant;
//   * ok        - exactly one instant.
// Durations are always computed on instants, so a 60-minute class is 60 real minutes.

export type LocalResolution =
  | { kind: 'ok'; instant: string; offsetMinutes: number }
  | { kind: 'ambiguous'; instant: string; offsetMinutes: number; laterInstant: string }
  /** `instant` is the forward-resolved instant (local time shifted by the gap length). */
  | { kind: 'gap'; instant: string; offsetMinutes: number };

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: IanaTimezone): Intl.DateTimeFormat {
  let f = formatters.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timezone, f);
  }
  return f;
}

/** The zone's UTC offset in minutes at an absolute instant (east of UTC is positive). */
export function offsetMinutesAt(utcMs: number, timezone: IanaTimezone): number {
  const parts: Record<string, number> = {};
  for (const p of formatterFor(timezone).formatToParts(new Date(utcMs))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  // Date.UTC of the wall-clock fields minus the real instant (floored to the second).
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}

/**
 * Resolves a local date and time in a zone to an absolute instant. Throws on a malformed date,
 * time or zone: callers validate user input first.
 */
export function resolveLocalTime(date: LocalDate, time: LocalTime, timezone: IanaTimezone): LocalResolution {
  if (!isLocalDate(date)) throw new Error(`Invalid local date: ${date}`);
  if (!isLocalTime(time)) throw new Error(`Invalid local time: ${time}`);
  if (!isIanaTimezone(timezone)) throw new Error(`Invalid timezone: ${timezone}`);

  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const localAsUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  const DAY = 24 * 60 * 60 * 1000;

  // Offsets a day either side bracket any single transition; try each distinct one.
  const before = offsetMinutesAt(localAsUtc - DAY, timezone);
  const after = offsetMinutesAt(localAsUtc + DAY, timezone);
  const candidates = Array.from(new Set([before, after]))
    .map(off => ({ off, ms: localAsUtc - off * 60000 }))
    .filter(c => offsetMinutesAt(c.ms, timezone) === c.off)
    .sort((a, b) => a.ms - b.ms);

  if (candidates.length === 1) {
    return { kind: 'ok', instant: toIso(candidates[0].ms), offsetMinutes: candidates[0].off };
  }
  if (candidates.length === 2) {
    return {
      kind: 'ambiguous',
      instant: toIso(candidates[0].ms),
      offsetMinutes: candidates[0].off,
      laterInstant: toIso(candidates[1].ms),
    };
  }
  // Gap: no candidate round-trips. Shift forward using the offset in force BEFORE the change.
  return { kind: 'gap', instant: toIso(localAsUtc - before * 60000), offsetMinutes: after };
}

export type WindowResolution =
  | { ok: true; instants: InstantWindow; startKind: LocalResolution['kind']; endKind: LocalResolution['kind'] }
  | { ok: false; problem: string };

/**
 * The UTC window for a booking given in local terms. `strict` (staff-entered slots, hotel
 * stays) rejects a nonexistent start or end; non-strict (generated recurrence) accepts the
 * forward-resolved instant and reports `gap` so the caller can flag it.
 */
export function localWindowToInstants(
  start: { date: LocalDate; time: LocalTime },
  end: { date: LocalDate; time: LocalTime },
  timezone: IanaTimezone,
  options: { strict: boolean } = { strict: true },
): WindowResolution {
  let s: LocalResolution;
  let e: LocalResolution;
  try {
    s = resolveLocalTime(start.date, start.time, timezone);
    e = resolveLocalTime(end.date, end.time, timezone);
  } catch (err) {
    return { ok: false, problem: (err as Error).message };
  }
  if (options.strict && s.kind === 'gap') return { ok: false, problem: `${start.date} ${start.time} does not exist in ${timezone} (clocks go forward)` };
  if (options.strict && e.kind === 'gap') return { ok: false, problem: `${end.date} ${end.time} does not exist in ${timezone} (clocks go forward)` };
  if (Date.parse(e.instant) <= Date.parse(s.instant)) return { ok: false, problem: 'the window must end after it starts' };
  return { ok: true, instants: { startsAt: s.instant, endsAt: e.instant }, startKind: s.kind, endKind: e.kind };
}

// ─── Presenting an instant as local time (the repeated hour) ────────────────

/** 'UTC+10:30', 'UTC-03:00', 'UTC+00:00': an offset in minutes, east of UTC positive. */
export function formatUtcOffset(offsetMinutes: number): string {
  const abs = Math.abs(offsetMinutes);
  return `UTC${offsetMinutes < 0 ? '-' : '+'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export interface LocalInstantLabel {
  date: LocalDate;
  time: LocalTime;
  offsetMinutes: number;
  /** 'UTC+10:30' */
  offset: string;
  /** This wall-clock time happens twice on that date in the zone (the clocks went back), so the time alone does not say which instant. */
  repeated: boolean;
  /**
   * What to show customers and staff: the time alone, or, for a repeated local time ONLY, the time with its UTC offset ('02:30 UTC+10:30'
   * and '02:30 UTC+09:30' in Adelaide on 4 April 2027). Every instant of a day gets a distinct text, because a repeated time is the only
   * ambiguous one and it always carries its offset.
   */
  text: string;
}

/**
 * An absolute instant as the zone's wall clock reads it. The offset is the one in force AT that instant (never assumed from the zone's
 * name), and `repeated` is decided by resolving the local time back to instants: two candidates means the clocks went back over it.
 * A time that does not exist (spring forward) can never be the label of an instant. Pure; no I/O.
 */
export function labelLocalInstant(instant: string, timezone: IanaTimezone): LocalInstantLabel {
  const ms = Date.parse(instant);
  if (!Number.isFinite(ms)) throw new Error(`Invalid instant: ${instant}`);
  if (!isIanaTimezone(timezone)) throw new Error(`Invalid timezone: ${timezone}`);
  const offsetMinutes = offsetMinutesAt(ms, timezone);
  const local = new Date(Math.floor(ms / 60000) * 60000 + offsetMinutes * 60000).toISOString();
  const date = local.slice(0, 10);
  const time = local.slice(11, 16);
  const repeated = resolveLocalTime(date, time, timezone).kind === 'ambiguous';
  const offset = formatUtcOffset(offsetMinutes);
  return { date, time, offsetMinutes, offset, repeated, text: repeated ? `${time} ${offset}` : time };
}
