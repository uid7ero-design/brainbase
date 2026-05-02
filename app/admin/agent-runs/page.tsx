import sql from '@/lib/db';
import AgentRunsDashboard from './AgentRunsDashboard';

export default async function AgentRunsPage() {
  // Pre-fetch org list for the filter dropdown — everything else is client-driven
  const orgs = await sql`SELECT id, name FROM organisations ORDER BY name`.catch(() => []) as {
    id: string;
    name: string;
  }[];

  return <AgentRunsDashboard orgs={orgs} />;
}
