import { neon } from '@neondatabase/serverless';

const sql = neon('postgresql://neondb_owner:REDACTED@ep-bitter-field-a7t5kwxy.ap-southeast-2.aws.neon.tech/neondb?sslmode=require');

await sql.query(`CREATE TABLE IF NOT EXISTS organisations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`);
console.log('organisations table ready');

await sql.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS organisation_id UUID REFERENCES organisations(id)`);
await sql.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
console.log('users columns ready');

const orgs = await sql.query(`SELECT id FROM organisations LIMIT 1`);
let orgId;
if (orgs.length === 0) {
  const res = await sql.query(`INSERT INTO organisations (name, slug) VALUES ('Brainbase', 'brainbase') RETURNING id`);
  orgId = res[0].id;
  console.log('org created:', orgId);
} else {
  orgId = orgs[0].id;
  console.log('org exists:', orgId);
}

await sql.query(`UPDATE users SET organisation_id = $1 WHERE organisation_id IS NULL`, [orgId]);
console.log('all users linked to org');

const users = await sql.query(`SELECT username, name, role, organisation_id FROM users`);
console.log(JSON.stringify(users, null, 2));
