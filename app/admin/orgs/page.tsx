import sql from '@/lib/db';
import OrgsClient from './OrgsClient';

export default async function AdminOrgsPage() {
  const orgs = await sql`
    SELECT o.id, o.name, o.slug, o.created_at,
      COUNT(u.id)::int AS user_count
    FROM organisations o
    LEFT JOIN users u ON u.organisation_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at ASC
  `;

  return <OrgsClient orgs={orgs as { id: string; name: string; slug: string; created_at: string; user_count: number }[]} />;
}
