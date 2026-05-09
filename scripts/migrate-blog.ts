import { neon } from '@neondatabase/serverless';

async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  await sql`
    CREATE TABLE IF NOT EXISTS blog_posts (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      title text NOT NULL,
      slug text NOT NULL,
      excerpt text,
      content text NOT NULL,
      cover_image_url text,
      published boolean DEFAULT false,
      published_at timestamptz,
      author_name text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now(),
      UNIQUE(organisation_id, slug)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS blog_posts_org_idx ON blog_posts(organisation_id)`;
  await sql`
    CREATE TABLE IF NOT EXISTS newsletter_subscribers (
      id text PRIMARY KEY,
      organisation_id text NOT NULL,
      email text NOT NULL,
      created_at timestamptz DEFAULT now(),
      UNIQUE(organisation_id, email)
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS newsletter_org_idx ON newsletter_subscribers(organisation_id)`;
  console.log('Blog tables ready');
}

main();
