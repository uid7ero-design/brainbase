// Assigned seating — pure domain rules (S1). No database, no clock reads, no I/O: every function
// takes its inputs (including "now") explicitly so the server, the organiser tools and the tests
// derive seating from ONE set of rules. The database (scripts/create-events-assigned-seating.sql)
// is the final authority for uniqueness, tenant scope, holds and snapshots; these helpers make the
// application produce exactly what those constraints accept, and give it stable error codes.
//
// Contents:
//   1. labels and the seat display formatter (+ the versioned historical snapshot)
//   2. layout generation from a simple spec (rows A–J × seats 1–20, tables 1–20 × seats 1–10)
//   3. CSV parsing for irregular layouts
//   4. one validator both inputs pass through (mirrors the database limits)
//   5. ticket-type / section eligibility and the mixed GA + seated seat count
//   6. the paid-seated refusal guard (v1 sells seated tickets free only)
//   7. hold windows: 10-minute initial hold, one renewal, 20-minute absolute cap

// ─── 1. Labels, display, snapshot ────────────────────────────────────────────

export type SeatGroupKind = 'ROW' | 'TABLE';
export const SEAT_GROUP_KINDS: readonly SeatGroupKind[] = ['ROW', 'TABLE'];

/** Factual seat features. They describe the seat, never a person. */
export type SeatFeature = 'WHEELCHAIR_SPACE' | 'COMPANION_SEAT' | 'STEP_FREE' | 'RESTRICTED_VIEW';
export const SEAT_FEATURES: readonly SeatFeature[] = ['WHEELCHAIR_SPACE', 'COMPANION_SEAT', 'STEP_FREE', 'RESTRICTED_VIEW'];

/** Database column limits (seating_layout_* CHECK constraints). */
export const SEATING_LIMITS = {
  sectionName: 100,
  groupLabel: 40,
  seatLabel: 20,
  displayLabel: 200,
  maxSeatsPerLayout: 20_000,
} as const;

export type SeatLabelParts = {
  section: string;
  group_kind: SeatGroupKind;
  group: string;
  seat: string;
};

export type SeatLabelOptions = {
  /**
   * Prefix table seats with their section name. Off by default ("Table 8 · Seat 3"); turn it on
   * when a layout has more than one section containing tables, so labels stay unambiguous.
   */
  includeSectionForTables?: boolean;
};

const SEP = ' · ';

/** "Section A · Row C · Seat 12" / "Table 8 · Seat 3" (/ "Terrace · Table 8 · Seat 3"). */
export function formatSeatLabel(parts: SeatLabelParts, options: SeatLabelOptions = {}): string {
  const section = parts.section.trim();
  const group = parts.group.trim();
  const seat = parts.seat.trim();
  if (parts.group_kind === 'TABLE') {
    const table = `Table ${group}${SEP}Seat ${seat}`;
    return options.includeSectionForTables ? `${section}${SEP}${table}` : table;
  }
  return `${section}${SEP}Row ${group}${SEP}Seat ${seat}`;
}

/**
 * The historical record of an issued seat, stored on the attendee (event_attendees.seat_snapshot)
 * at assignment time. Every ticket surface renders `display`; nothing re-derives it later, so a
 * renamed section or a new layout version can never change an issued ticket.
 *
 * Deliberately excluded: venue name and other mutable organiser fields, buyer data, and seat
 * features (a ticket must not announce that its holder uses a wheelchair space). The database
 * refuses any other key.
 */
export type SeatSnapshotV1 = {
  v: 1;
  layout_id: string;
  layout_version: number;
  section: string;
  group_kind: SeatGroupKind;
  group: string;
  seat: string;
  display: string;
};

export const SEAT_SNAPSHOT_KEYS: readonly (keyof SeatSnapshotV1)[] =
  ['v', 'layout_id', 'layout_version', 'section', 'group_kind', 'group', 'seat', 'display'];

/** The event_seats columns a snapshot is built from. */
export type EventSeatSnapshotSource = {
  layout_id: string;
  section_name: string;
  group_kind: SeatGroupKind;
  group_label: string;
  seat_label: string;
};

export function buildSeatSnapshot(
  seat: EventSeatSnapshotSource,
  layoutVersion: number,
  options: SeatLabelOptions = {},
): SeatSnapshotV1 {
  const parts: SeatLabelParts = {
    section: seat.section_name, group_kind: seat.group_kind, group: seat.group_label, seat: seat.seat_label,
  };
  // Labels are copied verbatim (the database compares them to the seat row exactly).
  return {
    v: 1,
    layout_id: seat.layout_id,
    layout_version: layoutVersion,
    section: seat.section_name,
    group_kind: seat.group_kind,
    group: seat.group_label,
    seat: seat.seat_label,
    display: formatSeatLabel(parts, options).slice(0, SEATING_LIMITS.displayLabel),
  };
}

/** Narrowing check for a stored snapshot (e.g. before rendering a ticket). */
export function isSeatSnapshotV1(value: unknown): value is SeatSnapshotV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o);
  if (keys.length !== SEAT_SNAPSHOT_KEYS.length || !keys.every(k => (SEAT_SNAPSHOT_KEYS as readonly string[]).includes(k))) return false;
  return o.v === 1
    && typeof o.layout_id === 'string'
    && typeof o.layout_version === 'number' && Number.isInteger(o.layout_version) && o.layout_version >= 1
    && typeof o.section === 'string' && typeof o.group === 'string' && typeof o.seat === 'string'
    && (o.group_kind === 'ROW' || o.group_kind === 'TABLE')
    && typeof o.display === 'string' && o.display.trim().length > 0 && o.display.length <= SEATING_LIMITS.displayLabel;
}

/** What a ticket shows for its seat: the stored text, never a fresh format. */
export function seatDisplay(snapshot: unknown): string | null {
  return isSeatSnapshotV1(snapshot) ? snapshot.display : null;
}

// ─── Intermediate layout form (output of the generator and the CSV parser) ───

export type LayoutSeatDraft = {
  section: string;
  section_sort: number;
  group_kind: SeatGroupKind;
  group: string;
  group_sort: number;
  seat: string;
  seat_sort: number;
  features: SeatFeature[];
  /** Another seat in the same section and group kind, written "group/seat" (e.g. "A/1"). */
  companion_of: string | null;
};

export type LayoutIssue = { code: LayoutIssueCode; message: string; where?: string };
export type LayoutIssueCode =
  | 'SPEC_INVALID'
  | 'RANGE_INVALID'
  | 'SECTION_MISSING'
  | 'GROUP_MISSING'
  | 'SEAT_MISSING'
  | 'GROUP_KIND_INVALID'
  | 'LABEL_TOO_LONG'
  | 'DUPLICATE_SECTION'
  | 'DUPLICATE_GROUP'
  | 'DUPLICATE_SEAT'
  | 'DUPLICATE_SORT'
  | 'FEATURE_INVALID'
  | 'COMPANION_INVALID'
  | 'CSV_INVALID'
  | 'LAYOUT_EMPTY'
  | 'LAYOUT_TOO_LARGE';

export type LayoutResult = { ok: true; seats: LayoutSeatDraft[] } | { ok: false; issues: LayoutIssue[] };

// ─── 2. Generator ────────────────────────────────────────────────────────────

/** Rows are a letter range ("A"–"J", spreadsheet style past "Z": "AA", "AB"…) or a number range. */
export type RowRange = { from: string; to: string } | { from: number; to: number };
export type NumberRange = { from: number; to: number };

export type LayoutSpecSection =
  | {
      name: string;
      rows: RowRange;
      seats: NumberRange;
      /** Row labels to leave out (e.g. no row "I"). */
      skip_rows?: string[];
      /** "group/seat" → features, e.g. { "A/1": ["WHEELCHAIR_SPACE"] }. */
      features?: Record<string, SeatFeature[] | string[]>;
      /** "group/seat" → "group/seat" of the seat it accompanies. */
      companions?: Record<string, string>;
    }
  | {
      name: string;
      tables: NumberRange;
      seats: NumberRange;
      features?: Record<string, SeatFeature[] | string[]>;
      companions?: Record<string, string>;
    };

export type LayoutSpec = { sections: LayoutSpecSection[] };

const MAX_RANGE = 1000;

/** 1 → "A", 26 → "Z", 27 → "AA". */
export function rowLetters(n: number): string {
  let s = '';
  let x = n;
  while (x > 0) {
    const r = (x - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    x = Math.floor((x - 1) / 26);
  }
  return s;
}

/** "A" → 1, "Z" → 26, "AA" → 27; null if not letters. */
export function rowIndex(label: string): number | null {
  if (!/^[A-Z]+$/.test(label)) return null;
  let n = 0;
  for (const ch of label) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function intRange(r: NumberRange | undefined, what: string, where: string, issues: LayoutIssue[]): number[] | null {
  if (!r || !Number.isInteger(r.from) || !Number.isInteger(r.to) || r.from < 0 || r.to < r.from || r.to - r.from >= MAX_RANGE) {
    issues.push({ code: 'RANGE_INVALID', message: `${what} must be whole numbers from ≤ to, at most ${MAX_RANGE}`, where });
    return null;
  }
  const out: number[] = [];
  for (let i = r.from; i <= r.to; i++) out.push(i);
  return out;
}

function rowLabels(r: RowRange | undefined, where: string, issues: LayoutIssue[]): string[] | null {
  if (r && typeof r.from === 'number' && typeof r.to === 'number') {
    const nums = intRange({ from: r.from, to: r.to }, 'rows', where, issues);
    return nums ? nums.map(String) : null;
  }
  if (r && typeof r.from === 'string' && typeof r.to === 'string') {
    const a = rowIndex(r.from.trim().toUpperCase());
    const b = rowIndex(r.to.trim().toUpperCase());
    if (a === null || b === null || b < a || b - a >= MAX_RANGE) {
      issues.push({ code: 'RANGE_INVALID', message: 'rows must be a letter range such as A–J', where });
      return null;
    }
    const out: string[] = [];
    for (let i = a; i <= b; i++) out.push(rowLetters(i));
    return out;
  }
  issues.push({ code: 'RANGE_INVALID', message: 'rows must be { from, to } letters or numbers', where });
  return null;
}

/** Expand a spec into seats in deterministic order (spec order → row/table order → seat order). */
export function expandLayoutSpec(spec: LayoutSpec): LayoutResult {
  const issues: LayoutIssue[] = [];
  if (!spec || !Array.isArray(spec.sections) || spec.sections.length === 0) {
    return { ok: false, issues: [{ code: 'SPEC_INVALID', message: 'a layout needs at least one section' }] };
  }
  const seats: LayoutSeatDraft[] = [];
  spec.sections.forEach((section, si) => {
    const where = `section ${si + 1}`;
    if (!section || typeof section.name !== 'string' || section.name.trim() === '') {
      issues.push({ code: 'SECTION_MISSING', message: 'every section needs a name', where });
      return;
    }
    const name = section.name.trim();
    const isTables = 'tables' in section;
    const kind: SeatGroupKind = isTables ? 'TABLE' : 'ROW';
    let groups: string[] | null;
    if (isTables) {
      const nums = intRange(section.tables, 'tables', where, issues);
      groups = nums ? nums.map(String) : null;
    } else {
      groups = rowLabels(section.rows, where, issues);
      const skip = new Set((section.skip_rows ?? []).map(s => String(s).trim().toUpperCase()));
      if (groups) groups = groups.filter(g => !skip.has(g.toUpperCase()));
    }
    const seatNums = intRange(section.seats, 'seats', where, issues);
    if (!groups || !seatNums) return;
    const features = section.features ?? {};
    const companions = section.companions ?? {};
    const known = new Set<string>();
    groups.forEach((group, gi) => {
      seatNums.forEach((n, ni) => {
        const key = `${group}/${n}`;
        known.add(key);
        const rawFeatures = features[key] ?? [];
        seats.push({
          section: name, section_sort: si + 1,
          group_kind: kind, group, group_sort: gi + 1,
          seat: String(n), seat_sort: ni + 1,
          features: rawFeatures as SeatFeature[],
          companion_of: companions[key] ?? null,
        });
      });
    });
    for (const k of [...Object.keys(features), ...Object.keys(companions)]) {
      if (!known.has(k)) issues.push({ code: 'SEAT_MISSING', message: `"${k}" is not a seat in ${name}`, where });
    }
  });
  if (issues.length > 0) return { ok: false, issues };
  return validateLayoutSeats(seats);
}

// ─── 3. CSV ──────────────────────────────────────────────────────────────────

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. */
export function parseCsvRows(text: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') {
      if (field !== '') return null;  // quote in the middle of an unquoted field
      quoted = true; i++; continue;
    }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      if (row.some(f => f !== '')) rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (quoted) return null;
  row.push(field);
  if (row.some(f => f !== '')) rows.push(row);
  return rows;
}

export const LAYOUT_CSV_COLUMNS = ['section', 'group_kind', 'group', 'seat', 'features', 'companion_of', 'seat_sort'] as const;
const REQUIRED_CSV_COLUMNS = ['section', 'group_kind', 'group', 'seat'];

/**
 * Columns: section, group_kind (ROW|TABLE), group, seat — required; features ("WHEELCHAIR_SPACE|STEP_FREE"),
 * companion_of ("A/1"), seat_sort (integer) — optional. Section, group and seat order follow the file
 * unless seat_sort is given (then it orders seats inside their group and must not repeat there).
 */
export function parseLayoutCsv(text: string): LayoutResult {
  const rows = parseCsvRows(text);
  if (!rows) return { ok: false, issues: [{ code: 'CSV_INVALID', message: 'the file has an unterminated or misplaced quote' }] };
  if (rows.length < 2) return { ok: false, issues: [{ code: 'LAYOUT_EMPTY', message: 'the file needs a header row and at least one seat' }] };
  const header = rows[0].map(h => h.trim().toLowerCase());
  const issues: LayoutIssue[] = [];
  for (const c of REQUIRED_CSV_COLUMNS) {
    if (!header.includes(c)) issues.push({ code: 'CSV_INVALID', message: `missing column "${c}"` });
  }
  for (const h of header) {
    if (!(LAYOUT_CSV_COLUMNS as readonly string[]).includes(h)) issues.push({ code: 'CSV_INVALID', message: `unknown column "${h}"` });
  }
  if (new Set(header).size !== header.length) issues.push({ code: 'CSV_INVALID', message: 'a column appears twice' });
  if (issues.length) return { ok: false, issues };
  const col = (name: string) => header.indexOf(name);

  const sectionSort = new Map<string, number>();
  const groupSort = new Map<string, number>();
  const seatCount = new Map<string, number>();
  const seats: LayoutSeatDraft[] = [];
  rows.slice(1).forEach((r, idx) => {
    const where = `line ${idx + 2}`;
    if (r.length !== header.length) { issues.push({ code: 'CSV_INVALID', message: `expected ${header.length} fields, got ${r.length}`, where }); return; }
    const get = (name: string) => (col(name) >= 0 ? r[col(name)].trim() : '');
    const section = get('section');
    const kindRaw = get('group_kind').toUpperCase();
    const group = get('group');
    const seat = get('seat');
    if (!section) { issues.push({ code: 'SECTION_MISSING', message: 'section is empty', where }); return; }
    if (!group) { issues.push({ code: 'GROUP_MISSING', message: 'group is empty', where }); return; }
    if (!seat) { issues.push({ code: 'SEAT_MISSING', message: 'seat is empty', where }); return; }
    if (kindRaw !== 'ROW' && kindRaw !== 'TABLE') { issues.push({ code: 'GROUP_KIND_INVALID', message: `group_kind must be ROW or TABLE, got "${get('group_kind')}"`, where }); return; }
    const kind = kindRaw as SeatGroupKind;
    const sKey = section.toLowerCase();
    if (!sectionSort.has(sKey)) sectionSort.set(sKey, sectionSort.size + 1);
    const gKey = `${sKey}\u0000${kind}\u0000${group}`;
    if (!groupSort.has(gKey)) {
      const inSection = [...groupSort.keys()].filter(k => k.startsWith(`${sKey}\u0000`)).length;
      groupSort.set(gKey, inSection + 1);
    }
    const n = (seatCount.get(gKey) ?? 0) + 1;
    seatCount.set(gKey, n);
    let seatSort = n;
    const sortRaw = get('seat_sort');
    if (sortRaw !== '') {
      if (!/^-?\d+$/.test(sortRaw)) { issues.push({ code: 'CSV_INVALID', message: `seat_sort must be a whole number, got "${sortRaw}"`, where }); return; }
      seatSort = Number(sortRaw);
    }
    const featuresRaw = get('features');
    const features = featuresRaw === '' ? [] : featuresRaw.split(/[|;]/).map(f => f.trim().toUpperCase()).filter(Boolean);
    const companion = get('companion_of');
    seats.push({
      section, section_sort: sectionSort.get(sKey)!,
      group_kind: kind, group, group_sort: groupSort.get(gKey)!,
      seat, seat_sort: seatSort,
      features: features as SeatFeature[],
      companion_of: companion === '' ? null : companion,
    });
  });
  if (issues.length) return { ok: false, issues };
  return validateLayoutSeats(seats);
}

// ─── 4. Validator ────────────────────────────────────────────────────────────

/**
 * The one gate both inputs pass. Mirrors the database: label lengths, unique section names
 * (case-insensitive), one kind per group label in a section, unique seat labels and sort positions
 * per group, a known feature vocabulary, and companions that point at another existing seat in the
 * same section (a companion is always flagged COMPANION_SEAT). Returns seats sorted
 * section → group → seat, so the order is deterministic whatever the input order.
 */
export function validateLayoutSeats(input: LayoutSeatDraft[]): LayoutResult {
  const issues: LayoutIssue[] = [];
  if (input.length === 0) return { ok: false, issues: [{ code: 'LAYOUT_EMPTY', message: 'the layout has no seats' }] };
  if (input.length > SEATING_LIMITS.maxSeatsPerLayout) {
    return { ok: false, issues: [{ code: 'LAYOUT_TOO_LARGE', message: `at most ${SEATING_LIMITS.maxSeatsPerLayout} seats per layout` }] };
  }
  const sectionByName = new Map<string, { name: string; sort: number }>();
  const sectionSorts = new Map<number, string>();
  const groupKinds = new Map<string, SeatGroupKind>();
  const groupSorts = new Map<string, string>();
  const seatLabels = new Set<string>();
  const seatSorts = new Set<string>();
  const seatsByRef = new Set<string>();
  const out: LayoutSeatDraft[] = [];

  for (const raw of input) {
    const s: LayoutSeatDraft = {
      ...raw,
      section: raw.section.trim(), group: raw.group.trim(), seat: raw.seat.trim(),
      features: [...new Set(raw.features.map(f => String(f).trim().toUpperCase()))] as SeatFeature[],
      companion_of: raw.companion_of === null ? null : raw.companion_of.trim(),
    };
    const where = `${s.section} ${s.group_kind} ${s.group} seat ${s.seat}`;
    if (!s.section) { issues.push({ code: 'SECTION_MISSING', message: 'section is empty', where }); continue; }
    if (!s.group) { issues.push({ code: 'GROUP_MISSING', message: 'group is empty', where }); continue; }
    if (!s.seat) { issues.push({ code: 'SEAT_MISSING', message: 'seat is empty', where }); continue; }
    if (!SEAT_GROUP_KINDS.includes(s.group_kind)) { issues.push({ code: 'GROUP_KIND_INVALID', message: 'group kind must be ROW or TABLE', where }); continue; }
    if (s.section.length > SEATING_LIMITS.sectionName) issues.push({ code: 'LABEL_TOO_LONG', message: `section names are at most ${SEATING_LIMITS.sectionName} characters`, where });
    if (s.group.length > SEATING_LIMITS.groupLabel) issues.push({ code: 'LABEL_TOO_LONG', message: `row/table labels are at most ${SEATING_LIMITS.groupLabel} characters`, where });
    if (s.seat.length > SEATING_LIMITS.seatLabel) issues.push({ code: 'LABEL_TOO_LONG', message: `seat labels are at most ${SEATING_LIMITS.seatLabel} characters`, where });
    for (const n of [s.section_sort, s.group_sort, s.seat_sort]) {
      if (!Number.isInteger(n)) issues.push({ code: 'SPEC_INVALID', message: 'sort positions must be whole numbers', where });
    }
    for (const f of s.features) {
      if (!(SEAT_FEATURES as readonly string[]).includes(f)) issues.push({ code: 'FEATURE_INVALID', message: `unknown seat feature "${f}"`, where });
    }

    const sKey = s.section.toLowerCase();
    const sec = sectionByName.get(sKey);
    if (!sec) {
      const clash = sectionSorts.get(s.section_sort);
      if (clash !== undefined) issues.push({ code: 'DUPLICATE_SORT', message: `sections "${clash}" and "${s.section}" share a position`, where });
      sectionByName.set(sKey, { name: s.section, sort: s.section_sort });
      sectionSorts.set(s.section_sort, s.section);
    } else if (sec.sort !== s.section_sort || sec.name !== s.section) {
      issues.push({ code: 'DUPLICATE_SECTION', message: `section "${s.section}" is written two different ways or positions`, where });
    }

    const gLabelKey = `${sKey}\u0000${s.group}`;
    const gKey = `${gLabelKey}\u0000${s.group_kind}`;
    const kind = groupKinds.get(gLabelKey);
    if (kind === undefined) {
      groupKinds.set(gLabelKey, s.group_kind);
      const sortKey = `${sKey}\u0000${s.group_sort}`;
      const clash = groupSorts.get(sortKey);
      if (clash !== undefined && clash !== gKey) issues.push({ code: 'DUPLICATE_SORT', message: `two rows/tables share position ${s.group_sort} in ${s.section}`, where });
      groupSorts.set(sortKey, gKey);
    } else if (kind !== s.group_kind) {
      issues.push({ code: 'DUPLICATE_GROUP', message: `"${s.group}" is both a row and a table in ${s.section}`, where });
    }

    const seatKey = `${gKey}\u0000${s.seat}`;
    if (seatLabels.has(seatKey)) issues.push({ code: 'DUPLICATE_SEAT', message: `seat ${s.seat} appears twice in ${s.group_kind === 'ROW' ? 'row' : 'table'} ${s.group}`, where });
    seatLabels.add(seatKey);
    const sortKey = `${gKey}\u0000#${s.seat_sort}`;
    if (seatSorts.has(sortKey)) issues.push({ code: 'DUPLICATE_SORT', message: `two seats share position ${s.seat_sort} in ${s.group}`, where });
    seatSorts.add(sortKey);
    seatsByRef.add(`${sKey}\u0000${s.group}/${s.seat}`);

    if (s.companion_of !== null && !s.features.includes('COMPANION_SEAT')) s.features.push('COMPANION_SEAT');
    out.push(s);
  }

  for (const s of out) {
    if (s.companion_of === null) continue;
    const where = `${s.section} ${s.group}/${s.seat}`;
    if (!/^[^/]+\/[^/]+$/.test(s.companion_of)) {
      issues.push({ code: 'COMPANION_INVALID', message: `companion must be written "row/seat", got "${s.companion_of}"`, where });
    } else if (s.companion_of === `${s.group}/${s.seat}`) {
      issues.push({ code: 'COMPANION_INVALID', message: 'a seat cannot accompany itself', where });
    } else if (!seatsByRef.has(`${s.section.toLowerCase()}\u0000${s.companion_of}`)) {
      issues.push({ code: 'COMPANION_INVALID', message: `companion "${s.companion_of}" is not a seat in ${s.section}`, where });
    }
  }

  if (issues.length) return { ok: false, issues };
  out.sort((a, b) => a.section_sort - b.section_sort || a.group_sort - b.group_sort || a.seat_sort - b.seat_sort);
  for (const s of out) s.features.sort((a, b) => SEAT_FEATURES.indexOf(a) - SEAT_FEATURES.indexOf(b));
  return { ok: true, seats: out };
}

/** True when more than one section contains tables (labels then need the section name). */
export function needsSectionOnTableLabels(seats: Pick<LayoutSeatDraft, 'section' | 'group_kind'>[]): boolean {
  return new Set(seats.filter(s => s.group_kind === 'TABLE').map(s => s.section.toLowerCase())).size > 1;
}

// ─── 5. Eligibility and the mixed GA + seated seat count ─────────────────────

export type SeatingMode = 'GENERAL_ADMISSION' | 'ASSIGNED';
export type SeatingTicketType = { id: string; seating_mode: SeatingMode; price_cents: number };
export type TicketTypeSectionMapping = { ticket_type_id: string; layout_section_id: string };

export type SeatEligibilityCode = 'SEAT_NOT_ALLOWED' | 'SECTION_NOT_ELIGIBLE';

/** GA ticket types never take a seat; an ASSIGNED ticket needs exactly one. */
export function seatsRequiredPerTicket(ticketType: Pick<SeatingTicketType, 'seating_mode'>): 0 | 1 {
  return ticketType.seating_mode === 'ASSIGNED' ? 1 : 0;
}

export function eligibleSectionIds(ticketTypeId: string, mappings: TicketTypeSectionMapping[]): Set<string> {
  return new Set(mappings.filter(m => m.ticket_type_id === ticketTypeId).map(m => m.layout_section_id));
}

/** Can a ticket of this type sit in a seat of this section? (Same rule the database trigger applies.) */
export function checkSeatEligibility(
  ticketType: Pick<SeatingTicketType, 'id' | 'seating_mode'>,
  seatSectionId: string,
  mappings: TicketTypeSectionMapping[],
): { ok: true } | { ok: false; code: SeatEligibilityCode } {
  if (ticketType.seating_mode !== 'ASSIGNED') return { ok: false, code: 'SEAT_NOT_ALLOWED' };
  if (!eligibleSectionIds(ticketType.id, mappings).has(seatSectionId)) return { ok: false, code: 'SECTION_NOT_ELIGIBLE' };
  return { ok: true };
}

export type SeatingCartLine = { ticket_type: SeatingTicketType; quantity: number };

/** Seats a cart must hold: the ASSIGNED quantity only (GA lines need none). */
export function requiredSeatCount(lines: SeatingCartLine[]): number {
  return lines.reduce((n, l) => n + seatsRequiredPerTicket(l.ticket_type) * l.quantity, 0);
}

// ─── 6. Paid-seated refusal ──────────────────────────────────────────────────

export const PAID_ASSIGNED_SEATING_NOT_AVAILABLE = 'PAID_ASSIGNED_SEATING_NOT_AVAILABLE' as const;

/**
 * v1 sells seated tickets only when they are free. Paid GA is untouched: this guard only looks at
 * ASSIGNED ticket types with a price. Public checkout / registration routes (S3) call it before
 * any reservation work and return this code as a stable, intentional refusal.
 */
export function guardPaidAssignedSeating(
  ticketTypes: Pick<SeatingTicketType, 'id' | 'seating_mode' | 'price_cents'>[],
): { ok: true } | { ok: false; code: typeof PAID_ASSIGNED_SEATING_NOT_AVAILABLE; ticket_type_ids: string[] } {
  const paidSeated = ticketTypes.filter(t => t.seating_mode === 'ASSIGNED' && t.price_cents > 0).map(t => t.id);
  return paidSeated.length === 0 ? { ok: true } : { ok: false, code: PAID_ASSIGNED_SEATING_NOT_AVAILABLE, ticket_type_ids: paidSeated };
}

// ─── 7. Hold windows ─────────────────────────────────────────────────────────

/** Initial hold: 10 minutes. One renewal. Never more than 20 minutes after the hold began. */
export const SEAT_HOLD_INITIAL_SECONDS = 10 * 60;
export const SEAT_HOLD_MAX_SECONDS = 20 * 60;
export const SEAT_HOLD_MAX_RENEWALS = 1;

export type SeatHoldWindow = { started_at: Date; expires_at: Date; renewal_count: number };

export function initialHoldWindow(startedAt: Date): SeatHoldWindow {
  return { started_at: startedAt, expires_at: new Date(startedAt.getTime() + SEAT_HOLD_INITIAL_SECONDS * 1000), renewal_count: 0 };
}

export function holdCapAt(startedAt: Date): Date {
  return new Date(startedAt.getTime() + SEAT_HOLD_MAX_SECONDS * 1000);
}

export function isHoldActive(hold: Pick<SeatHoldWindow, 'expires_at'>, now: Date): boolean {
  return now.getTime() < hold.expires_at.getTime();
}

export type HoldRenewalCode = 'HOLD_EXPIRED' | 'HOLD_RENEWAL_LIMIT' | 'HOLD_AT_CAP';

/**
 * The single renewal: a fresh 10 minutes from `now`, clipped to the 20-minute cap from the start.
 * Refused once used, after expiry, or when the cap leaves no extra time.
 */
export function renewHoldWindow(hold: SeatHoldWindow, now: Date): { ok: true; window: SeatHoldWindow } | { ok: false; code: HoldRenewalCode } {
  if (!isHoldActive(hold, now)) return { ok: false, code: 'HOLD_EXPIRED' };
  if (hold.renewal_count >= SEAT_HOLD_MAX_RENEWALS) return { ok: false, code: 'HOLD_RENEWAL_LIMIT' };
  const cap = holdCapAt(hold.started_at).getTime();
  const next = Math.min(now.getTime() + SEAT_HOLD_INITIAL_SECONDS * 1000, cap);
  if (next <= hold.expires_at.getTime()) return { ok: false, code: 'HOLD_AT_CAP' };
  return { ok: true, window: { started_at: hold.started_at, expires_at: new Date(next), renewal_count: hold.renewal_count + 1 } };
}

/** Seconds left on a hold (0 once expired) — for a countdown. */
export function holdSecondsRemaining(hold: Pick<SeatHoldWindow, 'expires_at'>, now: Date): number {
  return Math.max(0, Math.floor((hold.expires_at.getTime() - now.getTime()) / 1000));
}
