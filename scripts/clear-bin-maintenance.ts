import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`TRUNCATE TABLE bin_maintenance_jobs CASCADE`;
  console.log('bin_maintenance_jobs cleared');
}

main();
