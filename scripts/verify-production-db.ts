import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function tableExists(name: string): Promise<boolean> {
  const rows = await sql`
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = ${name}
    LIMIT 1
  `;
  return rows.length > 0;
}

async function getColumns(table: string): Promise<string[]> {
  const rows = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
    ORDER BY ordinal_position
  `;
  return rows.map(r => r.column_name as string);
}

async function main() {
  // ── Env check ──────────────────────────────────────────────────────────────
  console.log('\n=== ENV VARIABLES ===');
  console.log('DATABASE_URL      :', process.env.DATABASE_URL      ? '✓ set' : '✗ MISSING');
  console.log('ANTHROPIC_API_KEY :', process.env.ANTHROPIC_API_KEY ? '✓ set' : '✗ MISSING');
  console.log('OPENAI_API_KEY    :', process.env.OPENAI_API_KEY    ? '✓ set' : '— not set (HLNA briefing will fallback)');
  console.log('LD_TENNIS_ORG_ID  :', process.env.LD_TENNIS_ORG_ID  ? `✓ ${process.env.LD_TENNIS_ORG_ID}` : '✗ MISSING');

  // ── tennis_leads ────────────────────────────────────────────────────────────
  console.log('\n=== tennis_leads ===');
  const leadsExists = await tableExists('tennis_leads');
  if (!leadsExists) {
    console.error('✗ TABLE MISSING — tennis_leads does not exist');
    process.exit(1);
  }
  console.log('✓ table exists');

  const leadsColumns = await getColumns('tennis_leads');
  console.log('  columns:', leadsColumns.join(', '));

  const REQUIRED = ['id', 'organisation_id', 'status', 'name', 'email', 'notes', 'client_token'];
  const missing  = REQUIRED.filter(c => !leadsColumns.includes(c));

  if (missing.length === 0) {
    console.log('✓ all required columns present');
  } else {
    console.warn('⚠ missing columns:', missing.join(', '));
    if (missing.includes('notes')) {
      await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS notes TEXT`;
      console.log('  → added: notes TEXT');
    }
    if (missing.includes('client_token')) {
      await sql`ALTER TABLE tennis_leads ADD COLUMN IF NOT EXISTS client_token UUID DEFAULT gen_random_uuid()`;
      await sql`UPDATE tennis_leads SET client_token = gen_random_uuid() WHERE client_token IS NULL`;
      console.log('  → added: client_token UUID (backfilled existing rows)');
    }
  }

  const sample = await sql`SELECT id, name, status, notes, client_token FROM tennis_leads LIMIT 1`.catch(() => []);
  if (sample.length > 0) {
    console.log('✓ sample row:', JSON.stringify(sample[0]));
  } else {
    console.log('— table is empty (no leads yet)');
  }

  // ── contacts ────────────────────────────────────────────────────────────────
  console.log('\n=== contacts ===');
  const contactsExists = await tableExists('contacts');
  console.log(contactsExists ? '✓ table exists' : '✗ TABLE MISSING');
  if (contactsExists) {
    const cols = await getColumns('contacts');
    console.log('  columns:', cols.join(', '));
  }

  // ── organisations ───────────────────────────────────────────────────────────
  console.log('\n=== organisations ===');
  const orgsExists = await tableExists('organisations');
  console.log(orgsExists ? '✓ table exists' : '✗ TABLE MISSING');
  if (orgsExists) {
    const rows = await sql`SELECT COUNT(*)::int AS n FROM organisations`;
    console.log(`  rows: ${(rows[0] as { n: number }).n}`);
  }

  // ── users ───────────────────────────────────────────────────────────────────
  console.log('\n=== users ===');
  console.log(await tableExists('users') ? '✓ table exists' : '✗ TABLE MISSING');

  // ── alerts ──────────────────────────────────────────────────────────────────
  console.log('\n=== alerts ===');
  console.log(await tableExists('alerts')
    ? '✓ table exists'
    : '— not present (run: npx prisma migrate deploy)');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n=== SUMMARY ===');
  const missingAfter = REQUIRED.filter(c => !leadsColumns.includes(c) && c !== 'notes' && c !== 'client_token');
  if (leadsExists && missingAfter.length === 0) {
    console.log('✓ Production DB looks healthy — tennis_leads fully migrated');
  } else {
    console.warn('⚠ Issues remain — see above');
  }
  console.log('');
}

main().catch(err => { console.error(err); process.exit(1); });
