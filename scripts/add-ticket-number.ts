import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`ALTER TABLE bin_maintenance_jobs ADD COLUMN IF NOT EXISTS ticket_number TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS bin_maintenance_jobs_organisation_id_ticket_number_key ON bin_maintenance_jobs (organisation_id, ticket_number)`;
  console.log('ticket_number column + unique index added');
}

main();
