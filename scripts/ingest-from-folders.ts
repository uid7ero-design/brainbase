/**
 * ingest-from-folders.ts
 *
 * Populates all 6 operational tables from data-import/ folder files.
 * Deletes existing rows for the target org before inserting (idempotent).
 *
 * Run:
 *   LD_TENNIS_ORG_ID="<uuid>" DATABASE_URL="postgresql://..." \
 *   npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' \
 *   scripts/ingest-from-folders.ts
 *
 * To discover your org ID first, run scripts/diagnose-db.ts then check the
 * Organisation table: SELECT id, name FROM organisations;
 */

import * as fs   from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  PrismaClient,
  Severity,
  IncidentStatus,
  MissedStatus,
  MaintenanceStatus,
  AgingBucket,
  Module,
  SportSeason,
} from '@prisma/client';

// Minimal .env loader (dotenv not in deps)
(function loadEnv() {
  const envFile = path.resolve(__dirname, '../.env');
  if (!fs.existsSync(envFile)) return;
  const lines = fs.readFileSync(envFile, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=["']?(.+?)["']?\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
})();

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL not set'); process.exit(1);
}
const ORG_ID = process.env.LD_TENNIS_ORG_ID;
if (!ORG_ID) {
  console.error('❌ LD_TENNIS_ORG_ID not set.');
  console.error('   Query your DB: SELECT id, name FROM organisations;');
  console.error('   Then pass: LD_TENNIS_ORG_ID="<uuid>" DATABASE_URL="..." npx ts-node ...');
  process.exit(1);
}

const prisma = new PrismaClient();
const DATA   = path.resolve(__dirname, '../data-import');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fromSerial(v: unknown): Date | null {
  if (typeof v !== 'number' || v < 1) return null;
  const d = new Date((v - 25569) * 86400 * 1000);
  return isNaN(d.getTime()) ? null : d;
}

function parseNum(v: unknown): number {
  if (typeof v === 'number' && isFinite(v)) return Math.round(v);
  if (!v) return 0;
  const m = String(v).replace(/[~≈<>×x+]/g, '').match(/^(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

function mapMaintenanceStatus(s: string): MaintenanceStatus {
  const u = s.toUpperCase();
  if (u.includes('CLOSE') || u.includes('COMPLET')) return 'CLOSED' as MaintenanceStatus;
  if (u.includes('IN PROG'))  return 'IN_PROGRESS' as MaintenanceStatus;
  if (u.includes('ASSIGN'))   return 'ASSIGNED'    as MaintenanceStatus;
  if (u.includes('SCHEDUL'))  return 'SCHEDULED'   as MaintenanceStatus;
  if (u.includes('ESCALAT'))  return 'ESCALATED'   as MaintenanceStatus;
  return 'OPEN' as MaintenanceStatus;
}

function mapIncidentStatus(s: string): IncidentStatus {
  const u = s.toUpperCase();
  if (u.includes('CLOSE'))  return 'CLOSED'      as IncidentStatus;
  if (u.includes('RESOLV')) return 'RESOLVED'    as IncidentStatus;
  if (u.includes('PROG'))   return 'IN_PROGRESS' as IncidentStatus;
  return 'OPEN' as IncidentStatus;
}

function mapMissedStatus(s: string): MissedStatus {
  const u = s.toUpperCase();
  if (u.includes('COMPLET') || u.includes('CLOSE')) return 'COMPLETED'  as MissedStatus;
  if (u.includes('RESCHEDUL'))                       return 'RESCHEDULED' as MissedStatus;
  if (u.includes('CANCEL'))                          return 'CANCELLED'  as MissedStatus;
  return 'OPEN' as MissedStatus;
}

function mapSeason(v: unknown): SportSeason {
  if (!v) return 'YEAR_ROUND' as SportSeason;
  const u = String(v).toUpperCase();
  if (u.includes('SUMMER') && !u.includes('WINTER')) return 'SUMMER' as SportSeason;
  if (u.includes('WINTER') && !u.includes('SUMMER')) return 'WINTER' as SportSeason;
  return 'YEAR_ROUND' as SportSeason;
}

function mapAgingBucket(days: number): AgingBucket {
  if (days <= 0)   return 'CURRENT'     as AgingBucket;
  if (days <= 30)  return 'DAYS_30'     as AgingBucket;
  if (days <= 60)  return 'DAYS_60'     as AgingBucket;
  if (days <= 90)  return 'DAYS_90'     as AgingBucket;
  return 'DAYS_90_PLUS' as AgingBucket;
}

function readRows(filePath: string, sheetName?: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName ?? wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
}

function readRaw(filePath: string, sheetName?: string): unknown[][] {
  const wb = XLSX.readFile(filePath);
  const ws = wb.Sheets[sheetName ?? wb.SheetNames[0]];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
}

async function batchInsert<T>(
  label:     string,
  items:     T[],
  fn:        (batch: T[]) => Promise<{ count: number }>,
  batchSize = 500,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < items.length; i += batchSize) {
    const r = await fn(items.slice(i, i + batchSize));
    total += r.count;
    process.stdout.write(`\r   ${label}: ${total.toLocaleString()} / ${items.length.toLocaleString()}`);
  }
  console.log();
  return total;
}

// ── Report accumulator ────────────────────────────────────────────────────────

type Report = { table: string; deleted: number; inserted: number; errors: string[] };
const REPORT: Report[] = [];

function report(table: string, deleted: number, inserted: number, errors: string[] = []) {
  REPORT.push({ table, deleted, inserted, errors });
}

// ── 1. Bin Maintenance ────────────────────────────────────────────────────────

async function ingestBinMaintenance() {
  console.log('\n📂  Bin Maintenance  →  bin_maintenance_jobs');

  const rows = readRows(path.join(DATA, 'bin-maintenance/Bin Maintenance.csv'));

  const deleted = await prisma.binMaintenanceJob.deleteMany({ where: { organisation_id: ORG_ID } });

  const data = rows
    .map(r => {
      const suburb  = str(r['Site Suburb']);
      const address = str(r['Site Address']);
      if (!suburb && !address) return null;
      const category = str(r['Category']);
      const type     = str(r['Type']);
      const statusRaw = str(r['Status'] || 'Open');
      return {
        organisation_id: ORG_ID!,
        suburb:          suburb  || 'Unknown',
        address:         address || 'Unknown',
        bin_type:        'GENERAL_WASTE' as const,
        issue_type:      category || type || 'General',
        severity:        'LOW'  as Severity,
        status:          mapMaintenanceStatus(statusRaw),
        assigned_to:     null as string | null,
        scheduled_date:  fromSerial(r['Scheduled date']) ?? fromSerial(r['Call time']),
        completed_date:  fromSerial(r['Closed timestamp']),
        notes:           str(r['Notes']) || null,
        metadata:        {
          ticket:       str(r['Ticket #']),
          reference:    str(r['Reference']),
          type,
          account_name: str(r['Account Name']),
          account_num:  str(r['Account #']),
          property_id:  str(r['Property ID/Acct #']),
          run_name:     str(r['Run name']),
        } as object,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const inserted = await batchInsert(
    'BinMaintenanceJob',
    data,
    batch => prisma.binMaintenanceJob.createMany({ data: batch, skipDuplicates: true }),
  );

  report('bin_maintenance_jobs', deleted.count, inserted);
}

// ── 2. Illegal Dumping ────────────────────────────────────────────────────────

async function ingestIllegalDumping() {
  console.log('\n📂  Illegal Dumping  →  illegal_dumping');

  const rows = readRows(path.join(DATA, 'illegal-dumping/illegal dumping.csv'));

  const deleted = await prisma.illegalDumping.deleteMany({ where: { organisation_id: ORG_ID } });

  const data = rows.map(r => ({
    organisation_id: ORG_ID!,
    report_date:     fromSerial(r['Call time']) ?? new Date(),
    location:        str(r['Site Address']) || 'Unknown',
    suburb:          str(r['Site Suburb'])  || null,
    zone:            str(r['Run name'])     || null,
    waste_type:      str(r['Category'])     || str(r['Type']) || 'General Waste',
    volume_estimate: null as string | null,
    severity:        'LOW' as Severity,
    status:          mapIncidentStatus(str(r['Status'] || 'Open')),
    crew_assigned:   null as string | null,
    resolution_date: fromSerial(r['Closed timestamp']),
    cost_estimate:   null as number | null,
    notes:           str(r['Notes']) || null,
    metadata:        {
      ticket:       str(r['Ticket #']),
      reference:    str(r['Reference']),
      type:         str(r['Type']),
      account_name: str(r['Account Name']),
      run_name:     str(r['Run name']),
    } as object,
  }));

  const inserted = await batchInsert(
    'IllegalDumping',
    data,
    batch => prisma.illegalDumping.createMany({ data: batch, skipDuplicates: true }),
  );

  report('illegal_dumping', deleted.count, inserted);
}

// ── 3. Missed Collections ─────────────────────────────────────────────────────

async function ingestMissedCollections() {
  console.log('\n📂  Kerbside  →  missed_collections');

  const rows = readRows(path.join(DATA, 'kerbside/missed collections.csv'));

  const deleted = await prisma.missedCollection.deleteMany({ where: { organisation_id: ORG_ID } });

  const data = rows.map(r => ({
    organisation_id:  ORG_ID!,
    scheduled_date:   fromSerial(r['Scheduled date']) ?? fromSerial(r['Call time']) ?? new Date(),
    service_type:     str(r['Category']) || str(r['Type']) || 'Kerbside Collection',
    route:            str(r['Run name']) || null,
    zone:             null as string | null,
    suburb:           str(r['Site Suburb']) || null,
    address:          str(r['Site Address']) || 'Unknown',
    property_id:      str(r['Property ID/Acct #']) || str(r['Account #']) || null,
    driver_id:        null as string | null,
    reason:           null as string | null,
    status:           mapMissedStatus(str(r['Status'] || 'Open')),
    rescheduled_date: null as Date | null,
    completed_date:   fromSerial(r['Closed timestamp']),
    complaint_raised: false,
    notes:            str(r['Notes']) || null,
    metadata:         {
      ticket:    str(r['Ticket #']),
      reference: str(r['Reference']),
      type:      str(r['Type']),
      run_name:  str(r['Run name']),
    } as object,
  }));

  const inserted = await batchInsert(
    'MissedCollection',
    data,
    batch => prisma.missedCollection.createMany({ data: batch, skipDuplicates: true }),
  );

  report('missed_collections', deleted.count, inserted);
}

// ── 4. Debtor Accounts ────────────────────────────────────────────────────────

// Phase C1-DBF note: this function never used, and does not need
// correcting for, the account-level `.upsert()` Phase C1.1 added to (and
// C1-DBF removed from) the SEPARATE normal importer in
// modules/debtors/index.ts — it has always used its own,
// unrelated deleteMany-then-createMany pattern (see below), never an
// upsert, and does not reference the now-removed
// `organisation_id_account_number` compound key anywhere.
//
// Re-running this script for the same organisation is a full REPLACE (the
// deleteMany below wipes that org's debtor_accounts rows first), not an
// accumulate — unlike the normal in-app upload path's historical bug,
// re-running this script twice with the same source file does not grow
// the row count unboundedly.
//
// It does NOT eliminate duplicate rows WITHIN a single run, though: real
// rehearsal-data investigation (Phase C1-DBD/C1-DBS) found 786 residual
// duplicate groups even under the richest available compound key, coming
// from the source file itself — `skipDuplicates: true` below has nothing
// to skip against (there is no unique constraint on this table, by design
// — see prisma/schema.prisma's DebtorAccount model), so it does not
// address this. Solving within-file duplicate detection is explicitly out
// of scope for this phase (see Phase C1-DBF's own report, section F).
//
// This script also does not populate the six charge-line typed columns
// added in Phase C1-DBS2 (financial_year/financial_quarter/charge_type/
// invoice_date/source_book/source_charge_code) — only `metadata`. It
// bypasses the Upload/uploads table entirely (upload_id is always left
// NULL on every row it writes), so it has no access to the
// Upload.original_name-based repeated-import warning
// modules/debtors/index.ts's importDebtors() now performs either — not
// needed here regardless, since the deleteMany-based replace semantics
// make repeated-file-risk a different, non-accumulating question for this
// specific script.
async function ingestDebtors() {
  console.log('\n📂  Debtors  →  debtor_accounts');

  // Row 0: Excel column labels ("Data", "", …) — skip
  // Row 1: All empty — skip
  // Row 2: Code field names (ACCOUNT, ACCOUNTNAME, …) — use as headers
  // Row 3: Human-readable labels — skip
  // Row 4+: Actual data
  const all      = readRaw(path.join(DATA, 'debtors/Debtors.xlsx'));
  const headers  = (all[2] as string[]).map(h => str(h));
  const dataRows = all.slice(4) as unknown[][];

  function col(name: string) { return headers.indexOf(name); }

  const today = new Date();

  const deleted = await prisma.debtorAccount.deleteMany({ where: { organisation_id: ORG_ID } });

  const data = dataRows
    .filter(row => str(row[col('ACCOUNT')]) && str(row[col('ACCOUNTNAME')]))
    .map(row => {
      const account     = str(row[col('ACCOUNT')]);
      const accountName = str(row[col('ACCOUNTNAME')]);
      const invoiceDate = fromSerial(row[col('INVOICEDATE')]);
      const amount      = parseFloat(str(row[col('AMOUNT')]  || '0'))      || 0;
      const outstanding = parseFloat(str(row[col('OUTSTANDING')] || '0')) || 0;

      const daysOverdue = invoiceDate
        ? Math.max(0, Math.floor((today.getTime() - invoiceDate.getTime()) / 86_400_000))
        : 365;

      return {
        organisation_id:     ORG_ID!,
        account_number:      account,
        account_name:        accountName,
        outstanding_amount:  outstanding,
        original_amount:     amount || null,
        days_overdue:        daysOverdue,
        aging_bucket:        mapAgingBucket(daysOverdue),
        last_payment_date:   null as Date | null,
        last_payment_amount: null as number | null,
        status:              outstanding <= 0 ? ('RESOLVED' as const) : ('OPEN' as const),
        collection_stage:    null as string | null,
        notes:               null as string | null,
        metadata:            {
          suburb:       str(row[col('SUBURBDESCRIPTION')]),
          chargecode:   str(row[col('CHARGECODE')]),
          bookname:     str(row[col('BOOKNAME')]),
          quarter:      str(row[col('INVOICEQUARTER')]),
          invoice_date: invoiceDate?.toISOString() ?? null,
          address:      str(row[col('FORMATTEDADDRESS')]),
        } as object,
      };
    });

  const inserted = await batchInsert(
    'DebtorAccount',
    data,
    batch => prisma.debtorAccount.createMany({ data: batch, skipDuplicates: true }),
  );

  report('debtor_accounts', deleted.count, inserted);
}

// ── 5. Sporting Activities ────────────────────────────────────────────────────

async function ingestSports() {
  console.log('\n📂  Sports  →  sporting_activities');

  const wb = XLSX.readFile(path.join(DATA, 'sports/sporting clubs.xlsx'));

  const deleted = await prisma.sportingActivity.deleteMany({ where: { organisation_id: ORG_ID } });

  const SKIP_SHEETS = new Set(['Facilities', 'Sheet1']);
  const collected: object[] = [];
  const errors: string[] = [];

  for (const sheetName of wb.SheetNames) {
    if (SKIP_SHEETS.has(sheetName)) continue;

    const ws      = wb.Sheets[sheetName];
    const rawRows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
    if (!rawRows.length) continue;

    // Find header row — first row with a cell matching "activity", "sport", or "program"
    // (some sheets have a typo "ctivity" — covered by "ctivit" match)
    let headerIdx = -1;
    for (let i = 0; i < Math.min(4, rawRows.length); i++) {
      const row = rawRows[i] as string[];
      if (row.some(c => /ctivit|sport|program/i.test(String(c)))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx < 0) { errors.push(`${sheetName}: no header row found`); continue; }

    const headers = (rawRows[headerIdx] as string[]).map(h => String(h).toLowerCase().trim());

    // Locate columns by keyword — first matching column past index 0
    function findCol(...keywords: string[]) {
      return headers.findIndex((h, i) => i > 0 && keywords.some(k => h.includes(k)));
    }
    const cActivity      = 0;
    const cSessions      = findCol('session', 'game', '/week');
    const cPlayersTeam   = findCol('player');
    const cParticipants  = findCol('participant');
    const cSpectators    = findCol('spectator');
    const cTotalVisitors = findCol('total visitor', 'total vis');
    const cSeason        = findCol('season');

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      const activity = str(row[cActivity]);
      if (!activity || /^(total|note|footnote|\*|\d+$)/.test(activity.toLowerCase())) continue;

      collected.push({
        organisation_id:       ORG_ID!,
        name:                  activity,
        season:                mapSeason(cSeason >= 0 ? row[cSeason] : null),
        games_per_week:        Math.max(1, parseNum(cSessions      >= 0 ? row[cSessions]      : 1)),
        players_per_team:      parseNum(cPlayersTeam   >= 0 ? row[cPlayersTeam]   : 0),
        total_participants:    parseNum(cParticipants  >= 0 ? row[cParticipants]  : 0),
        spectators_per_week:   parseNum(cSpectators    >= 0 ? row[cSpectators]    : 0),
        total_visitors_per_week: parseNum(cTotalVisitors >= 0 ? row[cTotalVisitors] : 0),
        notes: sheetName,
      });
    }
  }

  const inserted = await batchInsert(
    'SportingActivity',
    collected,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch => prisma.sportingActivity.createMany({ data: batch as any, skipDuplicates: true }),
  );

  report('sporting_activities', deleted.count, inserted, errors);
}

// ── 6. Metrics — Financial (expenses + revenue + staff) ───────────────────────

async function ingestFinancialMetrics() {
  console.log('\n📂  Financial  →  metrics (module=OPERATIONS)');

  const FY_START = new Date('2025-07-01T00:00:00.000Z');
  const FY_END   = new Date('2026-06-30T23:59:59.999Z');

  const FILES = [
    { path: path.join(DATA, 'financial/expenses.xlsx'), label: 'Expenses' },
    { path: path.join(DATA, 'financial/revenue.xlsx'),  label: 'Revenue'  },
    { path: path.join(DATA, 'financial/staff.xlsx'),    label: 'Staff'    },
  ];

  const deleted = await prisma.metric.deleteMany({
    where: { organisation_id: ORG_ID, module: 'OPERATIONS' as Module },
  });

  const allMetrics: object[] = [];

  for (const { path: fp, label } of FILES) {
    const raw = readRaw(fp);

    // Code headers at row 12, label headers at row 13, data from row 14
    const codeRow   = (raw[12] ?? []) as string[];
    const dataStart = 14;

    function codeCol(name: string) { return codeRow.indexOf(name); }

    const iCYACT       = codeCol('CYACT');       // YTD Actual
    const iCYBUD       = codeCol('CYBUD');        // Current Budget
    const iFYBUD       = codeCol('FYBUD_0');      // EOFY Forecast (next budget)
    const iProjDescr   = codeCol('PJ_PROJDESCR'); // Project Description → category
    const iNatDescr    = codeCol('PJ_NADESCR');   // Natural Account Description
    const iNatAcct     = codeCol('PJ_NATACCT');   // Natural Account Code

    let totalBudget = 0, totalSpend = 0, totalForecast = 0;

    for (let i = dataStart; i < raw.length; i++) {
      const row = raw[i] as unknown[];
      const lock = str(row[0]);
      if (lock === '*' || lock === 'Lock') continue; // skip locked / header rows

      const projDescr = str(row[iProjDescr]);
      const natDescr  = str(row[iNatDescr]);
      const natAcct   = str(row[iNatAcct]);
      const cyact     = typeof row[iCYACT]  === 'number' ? row[iCYACT]  as number : 0;
      const cybud     = typeof row[iCYBUD]  === 'number' ? row[iCYBUD]  as number : 0;
      const fybud     = typeof row[iFYBUD]  === 'number' ? row[iFYBUD]  as number : 0;

      if (!projDescr && !natDescr) continue;

      totalBudget   += cybud;
      totalSpend    += cyact;
      totalForecast += fybud;

      const baseFields = {
        organisation_id: ORG_ID!,
        module:          'OPERATIONS' as Module,
        period_start:    FY_START,
        period_end:      FY_END,
        unit:            'AUD',
        metadata:        { label, nat_acct: natAcct, proj_descr: projDescr } as object,
      };

      // Per-line SPEND_YTD record (dimension = category for breakdown)
      if (cyact !== 0) {
        allMetrics.push({
          ...baseFields,
          metric_key:      'SPEND_YTD',
          metric_value:    cyact,
          dimension:       'category',
          dimension_value: projDescr || label,
        });
      }
      // Per-line budget record
      if (cybud !== 0) {
        allMetrics.push({
          ...baseFields,
          metric_key:      'BUDGET_LINE',
          metric_value:    cybud,
          dimension:       'category',
          dimension_value: projDescr || label,
        });
      }
    }

    // Summary records (no dimension — these are what the KPI route totals)
    const summaryBase = {
      organisation_id: ORG_ID!,
      module:          'OPERATIONS' as Module,
      period_start:    FY_START,
      period_end:      FY_END,
      unit:            'AUD',
      dimension:       null as string | null,
      dimension_value: null as string | null,
      metadata:        { label } as object,
    };

    allMetrics.push({ ...summaryBase, metric_key: 'BUDGET_TOTAL',   metric_value: totalBudget   });
    allMetrics.push({ ...summaryBase, metric_key: 'SPEND_YTD',      metric_value: totalSpend    });
    allMetrics.push({ ...summaryBase, metric_key: 'EOFY_FORECAST',  metric_value: totalForecast });
  }

  const inserted = await batchInsert(
    'Metric (Financial)',
    allMetrics,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch => prisma.metric.createMany({ data: batch as any, skipDuplicates: true }),
  );

  report('metrics (OPERATIONS)', deleted.count, inserted);
}

// ── 7. Metrics — Waste Statistics ─────────────────────────────────────────────

async function ingestWasteMetrics() {
  console.log('\n📂  Waste Stats  →  metrics (module=WASTE)');

  const raw = readRaw(path.join(DATA, 'waste/Statistics.xlsx'), 'Summary');

  // Row 0 = category headers; Row 1 = sub-category headers; data from row 2 (some may be empty rows)
  // Column layout (0-indexed, from manual inspection):
  //   0  = Month (Excel serial date)
  //   1  = Waste disposal (tonnes)
  //   2  = GO / Organics disposal (tonnes)
  //   3  = Recycling disposal (tonnes)
  //   4  = Hard Waste (tonnes)
  //   5  = Dumped Rubbish (tonnes)

  const deleted = await prisma.metric.deleteMany({
    where: { organisation_id: ORG_ID, module: 'WASTE' as Module },
  });

  const metrics: object[] = [];

  for (let i = 2; i < raw.length; i++) {
    const row = raw[i] as unknown[];
    if (!row.length) continue;

    const monthDate = fromSerial(row[0]);
    if (!monthDate) continue;

    const waste     = typeof row[1] === 'number' ? row[1] : 0;
    const organics  = typeof row[2] === 'number' ? row[2] : 0;
    const recycling = typeof row[3] === 'number' ? row[3] : 0;
    const hardWaste = typeof row[4] === 'number' ? row[4] : 0;
    const dumped    = typeof row[5] === 'number' ? row[5] : 0;

    if (waste + organics + recycling + hardWaste + dumped === 0) continue;

    // Period = that calendar month
    const periodStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
    const periodEnd   = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() + 1, 0, 23, 59, 59));

    const base = {
      organisation_id: ORG_ID!,
      module:          'WASTE' as Module,
      period_start:    periodStart,
      period_end:      periodEnd,
      unit:            'tonnes',
      dimension:       null as string | null,
      dimension_value: null as string | null,
      metadata:        {} as object,
    };

    if (waste     > 0) metrics.push({ ...base, metric_key: 'WASTE_TONNES',     metric_value: waste     });
    if (organics  > 0) metrics.push({ ...base, metric_key: 'ORGANICS_TONNES',  metric_value: organics  });
    if (recycling > 0) metrics.push({ ...base, metric_key: 'RECYCLING_TONNES', metric_value: recycling });
    if (hardWaste > 0) metrics.push({ ...base, metric_key: 'HARD_WASTE_TONNES',metric_value: hardWaste });
    if (dumped    > 0) metrics.push({ ...base, metric_key: 'ILLEGAL_DUMP_TONNES', metric_value: dumped });
  }

  const inserted = await batchInsert(
    'Metric (Waste)',
    metrics,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    batch => prisma.metric.createMany({ data: batch as any, skipDuplicates: true }),
  );

  report('metrics (WASTE)', deleted.count, inserted);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const LINE = '═'.repeat(58);
  console.log(`\n${LINE}`);
  console.log('DATA INGEST — Brainbase');
  console.log(`${LINE}`);
  console.log(`  Org ID : ${ORG_ID}`);
  console.log(`  Data   : ${DATA}`);
  console.log(`${LINE}\n`);

  try {
    await ingestBinMaintenance();
    await ingestIllegalDumping();
    await ingestMissedCollections();
    await ingestDebtors();
    await ingestSports();
    await ingestFinancialMetrics();
    await ingestWasteMetrics();
  } catch (e) {
    console.error('\n❌ Fatal error:', e);
    await prisma.$disconnect();
    process.exit(1);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${LINE}`);
  console.log('INGEST SUMMARY');
  console.log(`${LINE}\n`);

  let allOk = true;
  for (const r of REPORT) {
    const icon = r.errors.length ? '⚠️ ' : '✅';
    console.log(`${icon}  ${r.table.padEnd(26)} deleted ${String(r.deleted).padStart(6)}, inserted ${String(r.inserted).padStart(7)}`);
    for (const e of r.errors) console.log(`      ⚠  ${e}`);
    if (r.errors.length) allOk = false;
  }

  console.log(`\n${LINE}`);
  console.log(allOk ? '✅  All tables populated.' : '⚠️   Completed with warnings above.');
  console.log(`${LINE}\n`);

  await prisma.$disconnect();
}

main().catch(async e => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
