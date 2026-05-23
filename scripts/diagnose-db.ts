/**
 * diagnose-db.ts
 * Run: DATABASE_URL="..." npx ts-node --skipProject --compilerOptions '{"module":"commonjs","esModuleInterop":true}' scripts/diagnose-db.ts
 */

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('❌ DATABASE_URL not set'); process.exit(1); }

const sql = neon(DATABASE_URL);
const ORG_ID = process.env.LD_TENNIS_ORG_ID ?? process.env.DEFAULT_ORG_ID ?? null;

function line(char = '═', len = 55) { return char.repeat(len); }

// ── per-table queries (hardcoded — Neon tags don't support dynamic table names) ──

async function counts() {
  const [il, mc, mt, sa, bm, da] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM illegal_dumping`,
    sql`SELECT COUNT(*)::int AS n FROM missed_collections`,
    sql`SELECT COUNT(*)::int AS n FROM metrics`,
    sql`SELECT COUNT(*)::int AS n FROM sporting_activities`,
    sql`SELECT COUNT(*)::int AS n FROM bin_maintenance_jobs`,
    sql`SELECT COUNT(*)::int AS n FROM debtor_accounts`,
  ]);
  return {
    illegal_dumping:     (il[0]  as { n: number }).n,
    missed_collections:  (mc[0]  as { n: number }).n,
    metrics:             (mt[0]  as { n: number }).n,
    sporting_activities: (sa[0]  as { n: number }).n,
    bin_maintenance_jobs: (bm[0] as { n: number }).n,
    debtor_accounts:     (da[0]  as { n: number }).n,
  };
}

async function samples() {
  const [il, mc, mt, sa, bm, da] = await Promise.all([
    sql`SELECT * FROM illegal_dumping     LIMIT 1`,
    sql`SELECT * FROM missed_collections  LIMIT 1`,
    sql`SELECT * FROM metrics             LIMIT 1`,
    sql`SELECT * FROM sporting_activities LIMIT 1`,
    sql`SELECT * FROM bin_maintenance_jobs LIMIT 1`,
    sql`SELECT * FROM debtor_accounts     LIMIT 1`,
  ]);
  return {
    illegal_dumping:     il[0]  ?? null,
    missed_collections:  mc[0]  ?? null,
    metrics:             mt[0]  ?? null,
    sporting_activities: sa[0]  ?? null,
    bin_maintenance_jobs: bm[0] ?? null,
    debtor_accounts:     da[0]  ?? null,
  };
}

async function dateRanges() {
  const [il, mc, mt, da] = await Promise.all([
    sql`SELECT MIN(report_date)::text AS oldest, MAX(report_date)::text AS newest FROM illegal_dumping`,
    sql`SELECT MIN(scheduled_date)::text AS oldest, MAX(scheduled_date)::text AS newest FROM missed_collections`,
    sql`SELECT MIN(period_start)::text AS oldest, MAX(period_start)::text AS newest FROM metrics`,
    sql`SELECT MIN(created_at)::text AS oldest, MAX(created_at)::text AS newest FROM debtor_accounts`,
  ]);
  return {
    illegal_dumping:    il[0]  as { oldest: string | null; newest: string | null },
    missed_collections: mc[0]  as { oldest: string | null; newest: string | null },
    metrics:            mt[0]  as { oldest: string | null; newest: string | null },
    debtor_accounts:    da[0]  as { oldest: string | null; newest: string | null },
  };
}

async function orgBreakdowns() {
  const [il, mc, mt, sa, bm, da] = await Promise.all([
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM illegal_dumping     GROUP BY organisation_id`,
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM missed_collections  GROUP BY organisation_id`,
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM metrics             GROUP BY organisation_id`,
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM sporting_activities GROUP BY organisation_id`,
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM bin_maintenance_jobs GROUP BY organisation_id`,
    sql`SELECT organisation_id, COUNT(*)::int AS n FROM debtor_accounts     GROUP BY organisation_id`,
  ]);
  return {
    illegal_dumping:     il  as { organisation_id: string; n: number }[],
    missed_collections:  mc  as { organisation_id: string; n: number }[],
    metrics:             mt  as { organisation_id: string; n: number }[],
    sporting_activities: sa  as { organisation_id: string; n: number }[],
    bin_maintenance_jobs: bm as { organisation_id: string; n: number }[],
    debtor_accounts:     da  as { organisation_id: string; n: number }[],
  };
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${line()}`);
  console.log('DATABASE INVENTORY');
  console.log(`${line()}\n`);

  try {
    await sql`SELECT 1`;
    console.log('✅ Connected to Neon PostgreSQL\n');
  } catch (e) {
    console.error('❌ Connection failed:', e);
    process.exit(1);
  }

  const [rowCounts, sampleRows, ranges, orgs] = await Promise.all([
    counts(),
    samples(),
    dateRanges(),
    orgBreakdowns(),
  ]);

  const TABLES: { key: keyof typeof rowCounts; label: string }[] = [
    { key: 'illegal_dumping',     label: 'IllegalDumping'     },
    { key: 'missed_collections',  label: 'MissedCollection'   },
    { key: 'metrics',             label: 'Metric'             },
    { key: 'sporting_activities', label: 'SportingActivity'   },
    { key: 'bin_maintenance_jobs', label: 'BinMaintenanceJob'  },
    { key: 'debtor_accounts',     label: 'DebtorAccount'      },
  ];

  for (const { key, label } of TABLES) {
    const n = rowCounts[key];
    const icon = n === 0 ? '❌' : '✅';
    console.log(`${icon}  ${label.padEnd(22)} ${n.toLocaleString()} rows`);

    if (n > 0) {
      // Date range
      const r = (ranges as Record<string, { oldest: string | null; newest: string | null }>)[key];
      if (r?.oldest) {
        console.log(`    Date range : ${r.oldest.slice(0, 10)} → ${r.newest?.slice(0, 10)}`);
      }

      // Org breakdown
      const orgRows = (orgs as Record<string, { organisation_id: string; n: number }[]>)[key] ?? [];
      if (orgRows.length) {
        console.log(`    Orgs       : ${orgRows.map(o => `${o.organisation_id.slice(0,8)}… (${o.n})`).join(', ')}`);
      }

      // Sample row (first 8 fields)
      const sample = sampleRows[key] as Record<string, unknown> | null;
      if (sample) {
        const preview = Object.fromEntries(Object.entries(sample).slice(0, 8));
        console.log(`    Sample     : ${JSON.stringify(preview)}`);
      }
    }
  }

  // ── Org-level check ────────────────────────────────────────────────────────

  console.log(`\n${line()}`);
  console.log('ORG-LEVEL FILTER CHECK');
  console.log(`${line()}\n`);

  if (!ORG_ID) {
    console.log('ℹ️  LD_TENNIS_ORG_ID not in env — cannot check per-org row counts.');
    console.log('   Add it to .env, then re-run to see which rows your session will see.\n');
  } else {
    console.log(`Checking for organisation_id = ${ORG_ID}\n`);
    for (const { key, label } of TABLES) {
      if (rowCounts[key] === 0) continue;
      const orgRows = (orgs as Record<string, { organisation_id: string; n: number }[]>)[key] ?? [];
      const match   = orgRows.find(r => r.organisation_id === ORG_ID);
      if (!match) {
        console.log(`⚠️   ${label}: ${rowCounts[key]} total rows, 0 match your org`);
        if (orgRows.length) console.log(`     Other orgs present: ${orgRows.slice(0, 3).map(o => o.organisation_id).join(', ')}`);
      } else {
        console.log(`✅  ${label}: ${match.n}/${rowCounts[key]} rows match your org`);
      }
    }
  }

  // ── Diagnosis ──────────────────────────────────────────────────────────────

  console.log(`\n${line()}`);
  console.log('DIAGNOSIS SUMMARY');
  console.log(`${line()}\n`);

  const emptyTables = TABLES.filter(t => rowCounts[t.key] === 0).map(t => t.label);
  const hasTables   = TABLES.filter(t => rowCounts[t.key] > 0).map(t => t.label);

  if (emptyTables.length) {
    console.log('❌  EMPTY TABLES (no data imported yet):');
    emptyTables.forEach(t => console.log(`     • ${t}`));
    console.log('\n   Fix: import data via the Uploads page, or seed test data.');
  }

  if (hasTables.length) {
    console.log('\n✅  TABLES WITH DATA:');
    hasTables.forEach(t => console.log(`     • ${t}`));
  }

  if (ORG_ID) {
    const orgMismatches = TABLES.filter(t => {
      if (rowCounts[t.key] === 0) return false;
      const orgRows = (orgs as Record<string, { organisation_id: string; n: number }[]>)[t.key] ?? [];
      return !orgRows.find(r => r.organisation_id === ORG_ID);
    }).map(t => t.label);

    if (orgMismatches.length) {
      console.log('\n⚠️   ORG MISMATCH — data exists but belongs to a different org:');
      orgMismatches.forEach(t => console.log(`     • ${t}`));
      console.log(`\n   Your org: ${ORG_ID}`);
      console.log('   Fix: check which org you are logged in as (GET /api/me)');
      console.log('        or re-import data while logged into the correct org.');
    }
  }

  console.log(`\n${line()}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
