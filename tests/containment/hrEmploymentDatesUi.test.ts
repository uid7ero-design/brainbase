import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

// HR-2 Step 1D2 — static proof of the employment Start/End Date UI
// exposure: (1) PersonForm.tsx renders native type="date" inputs wired
// to start_date/end_date, with End Date rendered ONLY in edit mode
// (POST /api/hr/people does not accept end_date, so create mode must
// never expose or submit it); (2) clearing a date input produces
// `null`, never an empty-string submission that would incorrectly
// trip the server's invalid_start_date/invalid_end_date validation;
// (3) no client-side date parsing, ordering validation, or
// employment-status/date automation exists — the server remains the
// sole authority; (4) PersonDrawer.tsx shows both dates read-only,
// using the existing plain-string/em-dash convention, with no
// timezone-sensitive Date construction.

function read(relPath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relPath), 'utf8').replace(/\r\n/g, '\n');
}
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('app/people/_components/PersonForm.tsx — employment date fields', () => {
  const src = stripComments(read('app/people/_components/PersonForm.tsx'));

  it('a Start Date type="date" input exists, wired to start_date', () => {
    expect(src).toMatch(/label="Start Date"\s+type="date"\s+value=\{form\.start_date \?\? ''\}\s+onChange=\{setDate\('start_date'\)\}/);
  });

  it('an End Date type="date" input exists, wired to end_date', () => {
    expect(src).toMatch(/label="End Date"\s+type="date"\s+value=\{form\.end_date \?\? ''\}\s+onChange=\{setDate\('end_date'\)\}/);
  });

  it('End Date is rendered only when editing an existing person (initial?.id), never in create mode', () => {
    const startIdx = src.indexOf('label="Start Date"');
    const before = src.slice(Math.max(0, startIdx - 400), startIdx);
    expect(before).toMatch(/initial\?\.id \?/);
    // The End Date field itself must appear on the truthy (edit) branch
    // of that ternary, before the falsy (create) branch's own
    // Start-Date-only fallback.
    const endIdx = src.indexOf('label="End Date"');
    const falsyBranchIdx = src.indexOf(') : (', startIdx);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(endIdx).toBeLessThan(falsyBranchIdx);
  });

  it('setDate() translates an empty date-input value to null, never submitting an empty string', () => {
    const start = src.indexOf('const setDate');
    const end = src.indexOf('\n\n', start);
    const block = src.slice(start, end);
    expect(block).toMatch(/e\.target\.value \|\| null/);
  });

  it('setDate() performs no date-format parsing or validation of its own — only null-coalescing', () => {
    const start = src.indexOf('const setDate');
    const end = src.indexOf('\n\n', start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/new Date\(/);
    expect(block).not.toMatch(/isValidHrDate/);
    expect(block).not.toMatch(/Date\.UTC/);
  });

  it('no client-side end>=start ordering check exists anywhere in this component', () => {
    expect(src).not.toMatch(/end_date\s*[<>]=?\s*.*start_date/);
    expect(src).not.toMatch(/start_date\s*[<>]=?\s*.*end_date/);
  });

  it('no automatic coupling between employment_status and start_date/end_date exists', () => {
    // No code path reads employment_status while also touching
    // start_date/end_date (e.g. auto-clearing or auto-setting a date
    // when status changes) — the only place these three field names
    // legitimately co-occur is the static EDITABLE_FIELDS allowlist
    // and the Field/JSX declarations already asserted above.
    const statusHandlerIdx = src.indexOf("set('employment_status')");
    expect(statusHandlerIdx).toBeGreaterThan(-1);
    const nearby = src.slice(Math.max(0, statusHandlerIdx - 200), statusHandlerIdx + 200);
    expect(nearby).not.toMatch(/start_date|end_date/);
  });

  it('start_date and end_date are part of the EDITABLE_FIELDS allowlist (edit-mode submission)', () => {
    const start = src.indexOf('const EDITABLE_FIELDS');
    const end = src.indexOf('];', start);
    const block = src.slice(start, end);
    expect(block).toContain("'start_date'");
    expect(block).toContain("'end_date'");
  });

  it('no new role-based check was introduced anywhere in this file', () => {
    expect(src).not.toMatch(/role\s*===\s*'super_admin'/);
    expect(src).not.toMatch(/session\.role/);
  });
});

describe('app/api/hr/people/route.ts — create-time API surface is not expanded for end_date', () => {
  const src = stripComments(read('app/api/hr/people/route.ts'));

  it('POST does not parse end_date from the request body', () => {
    expect(src).not.toMatch(/body\.end_date/);
  });

  it('the INSERT column list does not include end_date', () => {
    const start = src.indexOf('INSERT INTO hr_people');
    const end = src.indexOf('RETURNING', start);
    const block = src.slice(start, end);
    expect(block).not.toMatch(/end_date/);
  });

  it('POST still accepts start_date, unchanged', () => {
    expect(src).toMatch(/body\.start_date/);
  });
});

describe('app/people/_components/PersonDrawer.tsx — read-only employment date rows', () => {
  const src = stripComments(read('app/people/_components/PersonDrawer.tsx'));

  it('a Start Date row exists, using the existing em-dash empty-value convention', () => {
    expect(src).toMatch(/<Row label="Start Date" value=\{person\.start_date \?\? '—'\} \/>/);
  });

  it('an End Date row exists, using the existing em-dash empty-value convention', () => {
    expect(src).toMatch(/<Row label="End Date" value=\{person\.end_date \?\? '—'\} \/>/);
  });

  it('these rows are rendered unconditionally (internal field tier), not gated behind canManage like the Linked Account row', () => {
    const startIdx = src.indexOf('label="Start Date"');
    const before = src.slice(Math.max(0, startIdx - 150), startIdx);
    expect(before).not.toMatch(/canManage &&/);
  });

  it('no timezone-sensitive Date construction is applied to the date-only string values', () => {
    expect(src).not.toMatch(/new Date\(\s*person\.(start_date|end_date)/);
    expect(src).not.toMatch(/(start_date|end_date).*toLocaleDateString/);
    expect(src).not.toMatch(/(start_date|end_date).*toISOString/);
  });
});
