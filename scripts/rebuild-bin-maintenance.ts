/**
 * rebuild-bin-maintenance.ts
 *
 * One-time rebuild of Bin Maintenance data for a single organisation from the
 * real source CSV exports, using the same fixed date parser / column mapping
 * as the live upload route (modules/bin-maintenance/csvImport.ts) — so this
 * script and future re-uploads stay byte-identical in behaviour.
 *
 * Why: the CSV date parser used to mis-parse Australian D/M/YYYY dates (via
 * JS's US-style Date constructor), silently corrupting or dropping
 * created_at/scheduled_date/completed_date for every already-imported row.
 * That bug is now fixed, but fixing it doesn't repair data already in the
 * database — this script clears this org's existing CSV-derived rows and
 * re-imports cleanly from the original files, deduped by ticket number.
 *
 * Run:  npx tsx scripts/rebuild-bin-maintenance.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { PrismaClient } from '@prisma/client';
import { mapBinMaintenanceRow, mapRow, BIN_MAINTENANCE_COLUMN_MAP, type BinMaintenanceRecordInput } from '../modules/bin-maintenance/csvImport';

// Minimal .env loader — .env first, .env.local overrides (matches Next.js precedence)
(function loadEnv() {
  for (const file of ['.env', '.env.local']) {
    const p = path.resolve(__dirname, '..', file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf-8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.*?)["']?\s*$/);
      if (m) process.env[m[1]] = m[2];
    }
  }
})();

const ORG_ID = '1732569e-6350-495e-aa6a-7218ce7bf749'; // "Brainbase" org — confirmed via suburb match + live user accounts

const SOURCE_FILES = [
  { path: path.resolve(__dirname, '..', 'data-import/bin-maintenance/Bin Maintenance.csv'), priority: 0 },
  { path: path.resolve(__dirname, '..', 'data-import/bin-maintenance/1 April-16 July.csv'), priority: 1 },
  { path: path.resolve(__dirname, '..', 'data-import/kerbside/missed collections.csv'), priority: 2 },
];

const prisma = new PrismaClient();

function parseCsv(filePath: string): Record<string, unknown>[] {
  const buf = fs.readFileSync(filePath);
  // cellDates:false — with it on, the xlsx library itself pre-converts ambiguous
  // date-like CSV strings (day <= 12) to Date objects using US M/D/Y order,
  // silently bypassing our own D/M/Y-aware normDate before it ever runs. Keep
  // everything as raw strings so normDate is the single source of date parsing.
  const workbook = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: true });
}

function hasTimeComponent(v: unknown): boolean {
  return typeof v === 'string' && /\d{1,2}:\d{2}/.test(v);
}

type Candidate = { record: BinMaintenanceRecordInput; score: number; priority: number };

function scoreOf(record: BinMaintenanceRecordInput, rawMapped: Record<string, unknown>): number {
  let score = 0;
  if (record.completed_date) score += 2;
  if (hasTimeComponent(rawMapped.closed_date) || hasTimeComponent(rawMapped.opened_date)) score += 1;
  return score;
}

async function main() {
  const byTicket = new Map<string, Candidate>();
  const noTicket: BinMaintenanceRecordInput[] = [];
  const rejected = { no_suburb: 0, no_address: 0, no_issue_type: 0 };
  let dateParseFailures = 0;
  const perFile: Record<string, { rows: number; valid: number }> = {};

  for (const { path: filePath, priority } of SOURCE_FILES) {
    const name = path.basename(filePath);
    const rows = parseCsv(filePath);
    let valid = 0;

    for (const raw of rows) {
      const result = mapBinMaintenanceRow(raw);
      if (!result.ok) { rejected[result.reason]++; continue; }
      valid++;

      const rawMapped = mapRow(raw, BIN_MAINTENANCE_COLUMN_MAP);
      if (rawMapped.opened_date && !result.record.created_at) dateParseFailures++;

      if (!result.record.ticket_number) {
        noTicket.push(result.record);
        continue;
      }

      const candidate: Candidate = { record: result.record, score: scoreOf(result.record, rawMapped), priority };
      const existing = byTicket.get(result.record.ticket_number);
      if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.priority > existing.priority)) {
        byTicket.set(result.record.ticket_number, candidate);
      }
    }

    perFile[name] = { rows: rows.length, valid };
    console.log(`[rebuild] ${name}: ${rows.length} rows, ${valid} valid`);
  }

  const deduped: BinMaintenanceRecordInput[] = [...byTicket.values()].map(c => c.record).concat(noTicket);

  console.log('\n[rebuild] summary');
  console.log('  per-file:', perFile);
  console.log('  rejected:', rejected);
  console.log('  date-parse failures (opened_date present but unparseable):', dateParseFailures);
  console.log('  unique ticketed records:', byTicket.size);
  console.log('  records with no ticket number:', noTicket.length);
  console.log('  total records to insert:', deduped.length);

  const byIssueType: Record<string, number> = {};
  const byStream: Record<string, number> = {};
  let withCompletedDate = 0;
  for (const r of deduped) {
    byIssueType[r.issue_type] = (byIssueType[r.issue_type] ?? 0) + 1;
    byStream[r.bin_type] = (byStream[r.bin_type] ?? 0) + 1;
    if (r.completed_date) withCompletedDate++;
  }
  console.log('  by issue_type:', byIssueType);
  console.log('  by bin_type:', byStream);
  console.log('  with completed_date set:', withCompletedDate, `(${Math.round((withCompletedDate / deduped.length) * 100)}%)`);

  if (process.env.DRY_RUN === '1') {
    console.log('\n[rebuild] DRY_RUN=1 — stopping before delete/insert. Sample records:');
    console.log(JSON.stringify(deduped.slice(0, 3), null, 2));
    return;
  }

  console.log(`\n[rebuild] clearing existing rows for org ${ORG_ID} and inserting ${deduped.length} records...`);

  await prisma.$transaction(async tx => {
    const del = await tx.binMaintenanceJob.deleteMany({ where: { organisation_id: ORG_ID } });
    console.log(`[rebuild] deleted ${del.count} existing rows`);
    const created = await tx.binMaintenanceJob.createMany({
      data: deduped.map(r => ({ organisation_id: ORG_ID, ...r })),
    });
    console.log(`[rebuild] inserted ${created.count} rows`);
  }, { timeout: 120_000 });

  console.log('\n[rebuild] done.');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
