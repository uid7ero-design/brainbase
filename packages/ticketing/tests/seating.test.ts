import { describe, it, expect } from 'vitest';
import {
  formatSeatLabel, buildSeatSnapshot, isSeatSnapshotV1, seatDisplay, SEAT_SNAPSHOT_KEYS,
  expandLayoutSpec, parseLayoutCsv, parseCsvRows, validateLayoutSeats, needsSectionOnTableLabels,
  rowLetters, rowIndex,
  seatsRequiredPerTicket, checkSeatEligibility, requiredSeatCount, eligibleSectionIds,
  guardPaidAssignedSeating, PAID_ASSIGNED_SEATING_NOT_AVAILABLE,
  initialHoldWindow, renewHoldWindow, holdCapAt, isHoldActive, holdSecondsRemaining,
  SEAT_HOLD_INITIAL_SECONDS, SEAT_HOLD_MAX_SECONDS,
  type LayoutSeatDraft, type LayoutResult, type SeatingTicketType,
} from '../src/seating';

const seatsOf = (r: LayoutResult) => {
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.seats;
};
const issuesOf = (r: LayoutResult) => (r.ok ? [] : r.issues.map(i => i.code));
const draft = (over: Partial<LayoutSeatDraft> = {}): LayoutSeatDraft => ({
  section: 'Stalls', section_sort: 1, group_kind: 'ROW', group: 'A', group_sort: 1,
  seat: '1', seat_sort: 1, features: [], companion_of: null, ...over,
});

describe('seat label formatter', () => {
  it('formats a row seat', () => {
    expect(formatSeatLabel({ section: 'Section A', group_kind: 'ROW', group: 'C', seat: '12' })).toBe('Section A · Row C · Seat 12');
  });
  it('formats a table seat without the section by default', () => {
    expect(formatSeatLabel({ section: 'Ballroom', group_kind: 'TABLE', group: '8', seat: '3' })).toBe('Table 8 · Seat 3');
  });
  it('adds the section to table seats when asked', () => {
    expect(formatSeatLabel({ section: 'Terrace', group_kind: 'TABLE', group: '8', seat: '3' }, { includeSectionForTables: true }))
      .toBe('Terrace · Table 8 · Seat 3');
  });
  it('trims labels', () => {
    expect(formatSeatLabel({ section: ' Stalls ', group_kind: 'ROW', group: ' B ', seat: ' 4 ' })).toBe('Stalls · Row B · Seat 4');
  });
});

describe('seat snapshot', () => {
  const seat = { layout_id: 'L1', section_name: 'Section A', group_kind: 'ROW' as const, group_label: 'C', seat_label: '12' };

  it('builds the exact v1 structure the database accepts', () => {
    const snap = buildSeatSnapshot(seat, 3);
    expect(snap).toEqual({
      v: 1, layout_id: 'L1', layout_version: 3, section: 'Section A', group_kind: 'ROW', group: 'C', seat: '12',
      display: 'Section A · Row C · Seat 12',
    });
    expect(Object.keys(snap).sort()).toEqual([...SEAT_SNAPSHOT_KEYS].sort());
  });

  it('carries no venue, buyer or seat-feature data', () => {
    const snap = buildSeatSnapshot({ ...seat, wheelchair_space: true, venue_name: 'Hall', buyer: 'x' } as typeof seat, 1);
    expect(Object.keys(snap)).not.toContain('wheelchair_space');
    expect(Object.keys(snap)).not.toContain('venue_name');
    expect(Object.keys(snap)).not.toContain('buyer');
  });

  it('is a frozen record: display comes from the stored text, not a fresh format', () => {
    const stored = { ...buildSeatSnapshot(seat, 1), display: 'Section A · Row C · Seat 12 (old wording)' };
    expect(seatDisplay(stored)).toBe('Section A · Row C · Seat 12 (old wording)');
    expect(seatDisplay(JSON.parse(JSON.stringify(stored)))).toBe(stored.display);
  });

  it('recognises only well-formed v1 snapshots', () => {
    const good = buildSeatSnapshot(seat, 1);
    expect(isSeatSnapshotV1(good)).toBe(true);
    expect(isSeatSnapshotV1({ ...good, v: 2 })).toBe(false);
    expect(isSeatSnapshotV1({ ...good, extra: 1 })).toBe(false);
    expect(isSeatSnapshotV1({ ...good, display: ' ' })).toBe(false);
    expect(isSeatSnapshotV1({ ...good, group_kind: 'BOOTH' })).toBe(false);
    expect(isSeatSnapshotV1({ ...good, layout_version: 0 })).toBe(false);
    expect(isSeatSnapshotV1(null)).toBe(false);
    expect(isSeatDisplayNull()).toBe(true);
  });

  function isSeatDisplayNull() { return seatDisplay(undefined) === null && seatDisplay('Row A') === null; }
});

describe('row letters', () => {
  it('maps spreadsheet-style labels both ways', () => {
    expect([1, 10, 26, 27, 52, 53].map(rowLetters)).toEqual(['A', 'J', 'Z', 'AA', 'AZ', 'BA']);
    expect(['A', 'J', 'Z', 'AA', 'BA'].map(rowIndex)).toEqual([1, 10, 26, 27, 53]);
    expect(rowIndex('a1')).toBeNull();
  });
});

describe('layout generator', () => {
  it('rows A–J × seats 1–20 → 200 seats in row, then seat order', () => {
    const seats = seatsOf(expandLayoutSpec({ sections: [{ name: 'Section A', rows: { from: 'A', to: 'J' }, seats: { from: 1, to: 20 } }] }));
    expect(seats).toHaveLength(200);
    expect(seats[0]).toMatchObject({ section: 'Section A', group_kind: 'ROW', group: 'A', seat: '1', group_sort: 1, seat_sort: 1 });
    expect(seats[19]).toMatchObject({ group: 'A', seat: '20' });
    expect(seats[20]).toMatchObject({ group: 'B', seat: '1', group_sort: 2 });
    expect(seats[199]).toMatchObject({ group: 'J', seat: '20', group_sort: 10, seat_sort: 20 });
  });

  it('tables 1–20 × seats 1–10 → 200 TABLE seats', () => {
    const seats = seatsOf(expandLayoutSpec({ sections: [{ name: 'Ballroom', tables: { from: 1, to: 20 }, seats: { from: 1, to: 10 } }] }));
    expect(seats).toHaveLength(200);
    expect(new Set(seats.map(s => s.group_kind))).toEqual(new Set(['TABLE']));
    expect(seats[10]).toMatchObject({ group: '2', seat: '1' });
    expect(formatSeatLabel({ section: seats[75].section, group_kind: seats[75].group_kind, group: seats[75].group, seat: seats[75].seat }))
      .toBe('Table 8 · Seat 6');
  });

  it('is deterministic and keeps spec section order', () => {
    const spec = {
      sections: [
        { name: 'Balcony', rows: { from: 'AA', to: 'AB' }, seats: { from: 1, to: 2 } },
        { name: 'Stalls', rows: { from: 1, to: 2 }, seats: { from: 5, to: 6 } },
      ],
    };
    const a = seatsOf(expandLayoutSpec(spec));
    const b = seatsOf(expandLayoutSpec(JSON.parse(JSON.stringify(spec))));
    expect(a).toEqual(b);
    expect(a.map(s => `${s.section}:${s.group}${s.seat}`)).toEqual([
      'Balcony:AA1', 'Balcony:AA2', 'Balcony:AB1', 'Balcony:AB2', 'Stalls:15', 'Stalls:16', 'Stalls:25', 'Stalls:26',
    ]);
  });

  it('skips rows and attaches features and companions', () => {
    const seats = seatsOf(expandLayoutSpec({
      sections: [{
        name: 'Stalls', rows: { from: 'H', to: 'J' }, seats: { from: 1, to: 2 }, skip_rows: ['i'],
        features: { 'H/1': ['WHEELCHAIR_SPACE', 'STEP_FREE'], 'J/2': ['RESTRICTED_VIEW'] },
        companions: { 'H/2': 'H/1' },
      }],
    }));
    expect(seats.map(s => s.group)).toEqual(['H', 'H', 'J', 'J']);
    expect(seats[0].features).toEqual(['WHEELCHAIR_SPACE', 'STEP_FREE']);
    expect(seats[1]).toMatchObject({ companion_of: 'H/1', features: ['COMPANION_SEAT'] });
    expect(seats[3].features).toEqual(['RESTRICTED_VIEW']);
  });

  it('rejects bad ranges, unknown seats in features, and malformed features', () => {
    expect(issuesOf(expandLayoutSpec({ sections: [] }))).toEqual(['SPEC_INVALID']);
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'J', to: 'A' }, seats: { from: 1, to: 2 } }] }))).toContain('RANGE_INVALID');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'A', to: 'B' }, seats: { from: 3, to: 1 } }] }))).toContain('RANGE_INVALID');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', tables: { from: 1, to: 5000 }, seats: { from: 1, to: 2 } }] }))).toContain('RANGE_INVALID');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: ' ', rows: { from: 'A', to: 'B' }, seats: { from: 1, to: 2 } }] }))).toContain('SECTION_MISSING');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'A', to: 'B' }, seats: { from: 1, to: 2 }, features: { 'Z/9': ['STEP_FREE'] } }] }))).toContain('SEAT_MISSING');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'A', to: 'B' }, seats: { from: 1, to: 2 }, features: { 'A/1': ['MEDICAL'] } }] }))).toContain('FEATURE_INVALID');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'A', to: 'B' }, seats: { from: 1, to: 2 }, companions: { 'A/1': 'A/1' } }] }))).toContain('COMPANION_INVALID');
    expect(issuesOf(expandLayoutSpec({ sections: [{ name: 'S', rows: { from: 'A', to: 'B' }, seats: { from: 1, to: 2 } }, { name: 's', rows: { from: 'A', to: 'A' }, seats: { from: 1, to: 1 } }] }))).toContain('DUPLICATE_SECTION');
  });

  it('rejects layouts larger than the cap', () => {
    const spec = { sections: Array.from({ length: 21 }, (_, i) => ({ name: `S${i}`, tables: { from: 1, to: 100 }, seats: { from: 1, to: 10 } })) };
    expect(issuesOf(expandLayoutSpec(spec))).toEqual(['LAYOUT_TOO_LARGE']);
  });
});

describe('CSV', () => {
  it('reads quoted fields, doubled quotes and CRLF', () => {
    expect(parseCsvRows('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([['a', 'b,c', 'd "e"'], ['1', '2', '3']]);
    expect(parseCsvRows('a,"b\n')).toBeNull();
    expect(parseCsvRows('a,b"c"\n')).toBeNull();
  });

  it('parses an irregular layout in file order', () => {
    const csv = [
      'section,group_kind,group,seat,features,companion_of',
      'Balcony,ROW,AA,5,RESTRICTED_VIEW,',
      'Balcony,ROW,AA,7,,',
      'Stalls,ROW,C,12,WHEELCHAIR_SPACE|STEP_FREE,',
      'Stalls,ROW,C,13,,C/12',
      'Ballroom,TABLE,8,3,,',
    ].join('\n');
    const seats = seatsOf(parseLayoutCsv(csv));
    expect(seats.map(s => `${s.section}/${s.group_kind}/${s.group}/${s.seat}/${s.section_sort}.${s.group_sort}.${s.seat_sort}`)).toEqual([
      'Balcony/ROW/AA/5/1.1.1', 'Balcony/ROW/AA/7/1.1.2', 'Stalls/ROW/C/12/2.1.1', 'Stalls/ROW/C/13/2.1.2', 'Ballroom/TABLE/8/3/3.1.1',
    ]);
    expect(seats[2].features).toEqual(['WHEELCHAIR_SPACE', 'STEP_FREE']);
    expect(seats[3]).toMatchObject({ companion_of: 'C/12', features: ['COMPANION_SEAT'] });
  });

  it('honours an explicit seat_sort and rejects a repeated one', () => {
    const ok = seatsOf(parseLayoutCsv('section,group_kind,group,seat,seat_sort\nS,ROW,A,2,2\nS,ROW,A,1,1\n'));
    expect(ok.map(s => s.seat)).toEqual(['1', '2']);
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat,seat_sort\nS,ROW,A,2,1\nS,ROW,A,1,1\n'))).toContain('DUPLICATE_SORT');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat,seat_sort\nS,ROW,A,2,x\n'))).toContain('CSV_INVALID');
  });

  it('rejects duplicate seats, missing parts, invalid kinds, unknown features and bad headers', () => {
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,ROW,A,1\nS,ROW,A,1\n'))).toContain('DUPLICATE_SEAT');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\n,ROW,A,1\n'))).toContain('SECTION_MISSING');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,ROW,,1\n'))).toContain('GROUP_MISSING');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,ROW,A,\n'))).toContain('SEAT_MISSING');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,BOOTH,A,1\n'))).toContain('GROUP_KIND_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat,features\nS,ROW,A,1,WHEELCHAIR\n'))).toContain('FEATURE_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group\nS,ROW,A\n'))).toContain('CSV_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat,notes\nS,ROW,A,1,x\n'))).toContain('CSV_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,ROW,A\n'))).toContain('CSV_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\n'))).toContain('LAYOUT_EMPTY');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat,companion_of\nS,ROW,A,1,B/9\n'))).toContain('COMPANION_INVALID');
    expect(issuesOf(parseLayoutCsv('section,group_kind,group,seat\nS,ROW,A,1\nS,TABLE,A,2\n'))).toContain('DUPLICATE_GROUP');
  });
});

describe('layout validator', () => {
  it('sorts deterministically whatever the input order', () => {
    const input = [draft({ group: 'B', group_sort: 2, seat: '1' }), draft({ seat: '2', seat_sort: 2 }), draft()];
    expect(seatsOf(validateLayoutSeats(input)).map(s => s.group + s.seat)).toEqual(['A1', 'A2', 'B1']);
  });
  it('enforces the database label limits', () => {
    expect(issuesOf(validateLayoutSeats([draft({ seat: 'x'.repeat(21) })]))).toContain('LABEL_TOO_LONG');
    expect(issuesOf(validateLayoutSeats([draft({ group: 'x'.repeat(41) })]))).toContain('LABEL_TOO_LONG');
    expect(issuesOf(validateLayoutSeats([draft({ section: 'x'.repeat(101) })]))).toContain('LABEL_TOO_LONG');
    expect(issuesOf(validateLayoutSeats([]))).toEqual(['LAYOUT_EMPTY']);
  });
  it('rejects two sections or groups sharing a position', () => {
    expect(issuesOf(validateLayoutSeats([draft(), draft({ section: 'Balcony' })]))).toContain('DUPLICATE_SORT');
    expect(issuesOf(validateLayoutSeats([draft(), draft({ group: 'B' })]))).toContain('DUPLICATE_SORT');
  });
  it('accessibility data stays factual and fixed-vocabulary', () => {
    const seats = seatsOf(validateLayoutSeats([draft({ features: ['step_free' as never, 'WHEELCHAIR_SPACE', 'WHEELCHAIR_SPACE'] })]));
    expect(seats[0].features).toEqual(['WHEELCHAIR_SPACE', 'STEP_FREE']);
    expect(issuesOf(validateLayoutSeats([draft({ features: ['MOBILITY_IMPAIRED' as never] })]))).toContain('FEATURE_INVALID');
  });
  it('knows when table labels need their section', () => {
    expect(needsSectionOnTableLabels([{ section: 'Ballroom', group_kind: 'TABLE' }, { section: 'Stalls', group_kind: 'ROW' }])).toBe(false);
    expect(needsSectionOnTableLabels([{ section: 'Ballroom', group_kind: 'TABLE' }, { section: 'Terrace', group_kind: 'TABLE' }])).toBe(true);
  });
});

describe('ticket type / section eligibility', () => {
  const ga: SeatingTicketType = { id: 'ga', seating_mode: 'GENERAL_ADMISSION', price_cents: 0 };
  const res: SeatingTicketType = { id: 'res', seating_mode: 'ASSIGNED', price_cents: 0 };
  const mappings = [{ ticket_type_id: 'res', layout_section_id: 'stalls' }, { ticket_type_id: 'res', layout_section_id: 'balcony' }];

  it('GA never requires a seat; ASSIGNED requires one per ticket', () => {
    expect(seatsRequiredPerTicket(ga)).toBe(0);
    expect(seatsRequiredPerTicket(res)).toBe(1);
  });
  it('a seated type may use only its mapped sections', () => {
    expect(checkSeatEligibility(res, 'stalls', mappings)).toEqual({ ok: true });
    expect(checkSeatEligibility(res, 'vip', mappings)).toEqual({ ok: false, code: 'SECTION_NOT_ELIGIBLE' });
    expect(checkSeatEligibility({ id: 'other', seating_mode: 'ASSIGNED' }, 'stalls', mappings)).toEqual({ ok: false, code: 'SECTION_NOT_ELIGIBLE' });
    expect(eligibleSectionIds('res', mappings)).toEqual(new Set(['stalls', 'balcony']));
  });
  it('a GA type can never take a seat', () => {
    expect(checkSeatEligibility(ga, 'stalls', [{ ticket_type_id: 'ga', layout_section_id: 'stalls' }])).toEqual({ ok: false, code: 'SEAT_NOT_ALLOWED' });
  });
  it('mixed GA + seated cart needs seats for the seated quantity only', () => {
    expect(requiredSeatCount([{ ticket_type: ga, quantity: 3 }, { ticket_type: res, quantity: 2 }])).toBe(2);
    expect(requiredSeatCount([{ ticket_type: ga, quantity: 5 }])).toBe(0);
  });
});

describe('paid seated refusal', () => {
  it('refuses ASSIGNED ticket types with a price, with a stable code', () => {
    expect(guardPaidAssignedSeating([{ id: 'vip', seating_mode: 'ASSIGNED', price_cents: 2500 }]))
      .toEqual({ ok: false, code: PAID_ASSIGNED_SEATING_NOT_AVAILABLE, ticket_type_ids: ['vip'] });
    expect(PAID_ASSIGNED_SEATING_NOT_AVAILABLE).toBe('PAID_ASSIGNED_SEATING_NOT_AVAILABLE');
  });
  it('leaves paid GA and free seated alone', () => {
    expect(guardPaidAssignedSeating([
      { id: 'ga-paid', seating_mode: 'GENERAL_ADMISSION', price_cents: 5000 },
      { id: 'seat-free', seating_mode: 'ASSIGNED', price_cents: 0 },
    ])).toEqual({ ok: true });
  });
});

describe('hold windows', () => {
  const t0 = new Date('2026-12-05T09:00:00Z');
  const at = (sec: number) => new Date(t0.getTime() + sec * 1000);

  it('initial hold is 10 minutes, cap is 20 minutes from the start', () => {
    const h = initialHoldWindow(t0);
    expect(h.expires_at.toISOString()).toBe('2026-12-05T09:10:00.000Z');
    expect(h.renewal_count).toBe(0);
    expect(holdCapAt(t0).toISOString()).toBe('2026-12-05T09:20:00.000Z');
    expect(SEAT_HOLD_INITIAL_SECONDS).toBe(600);
    expect(SEAT_HOLD_MAX_SECONDS).toBe(1200);
  });
  it('one renewal: 10 fresh minutes, clipped to the 20-minute cap', () => {
    const r = renewHoldWindow(initialHoldWindow(t0), at(4 * 60));
    expect(r.ok && r.window.expires_at.toISOString()).toBe('2026-12-05T09:14:00.000Z');
    const late = renewHoldWindow(initialHoldWindow(t0), at(9 * 60 + 30));
    expect(late.ok && late.window.expires_at.toISOString()).toBe('2026-12-05T09:19:30.000Z');
    const capped = renewHoldWindow({ started_at: t0, expires_at: at(600), renewal_count: 0 }, at(599));
    expect(capped.ok && capped.window.expires_at.getTime()).toBeLessThanOrEqual(holdCapAt(t0).getTime());
  });
  it('refuses a second renewal', () => {
    const once = renewHoldWindow(initialHoldWindow(t0), at(60));
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    expect(renewHoldWindow(once.window, at(120))).toEqual({ ok: false, code: 'HOLD_RENEWAL_LIMIT' });
  });
  it('refuses renewal after expiry and when the cap leaves no time', () => {
    expect(renewHoldWindow(initialHoldWindow(t0), at(600))).toEqual({ ok: false, code: 'HOLD_EXPIRED' });
    expect(renewHoldWindow({ started_at: t0, expires_at: at(1200), renewal_count: 0 }, at(1100))).toEqual({ ok: false, code: 'HOLD_AT_CAP' });
  });
  it('never produces a window past 20 minutes', () => {
    for (let s = 0; s < 600; s += 37) {
      const r = renewHoldWindow(initialHoldWindow(t0), at(s));
      if (r.ok) expect(r.window.expires_at.getTime() - t0.getTime()).toBeLessThanOrEqual(1200 * 1000);
    }
  });
  it('expiry is half-open and countdown never negative', () => {
    const h = initialHoldWindow(t0);
    expect(isHoldActive(h, at(599))).toBe(true);
    expect(isHoldActive(h, at(600))).toBe(false);
    expect(holdSecondsRemaining(h, at(570))).toBe(30);
    expect(holdSecondsRemaining(h, at(700))).toBe(0);
  });
});
