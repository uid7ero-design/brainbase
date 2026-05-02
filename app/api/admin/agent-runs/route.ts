import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || session.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const sp        = new URL(req.url).searchParams;
  const orgId     = sp.get('orgId')     || null;
  const from      = sp.get('from')      || null;
  const to        = sp.get('to')        || null;
  const agentName = sp.get('agentName') || null;
  const routeType = sp.get('routeType') || null;

  // Run all five queries in parallel
  const [statsRows, byAgentRows, byRouteRows, recentRows, orgRows] = await Promise.all([

    // Summary stats
    sql`
      SELECT
        COUNT(*)::integer                                             AS total_runs,
        COUNT(*) FILTER (WHERE route_type = 'chat')::integer         AS fallback_count,
        ROUND(AVG(confidence)::numeric, 3)                           AS avg_confidence
      FROM agent_runs
      WHERE (${orgId}::uuid     IS NULL OR organisation_id = ${orgId}::uuid)
        AND (${from}::date      IS NULL OR created_at >= ${from}::date)
        AND (${to}::date        IS NULL OR created_at <  (${to}::date + INTERVAL '1 day'))
        AND (${agentName}::text IS NULL OR agent_name = ${agentName})
        AND (${routeType}::text IS NULL OR route_type = ${routeType})
    `,

    // Breakdown by agent
    sql`
      SELECT
        agent_name,
        COUNT(*)::integer                  AS count,
        ROUND(AVG(confidence)::numeric, 2) AS avg_conf
      FROM agent_runs
      WHERE (${orgId}::uuid     IS NULL OR organisation_id = ${orgId}::uuid)
        AND (${from}::date      IS NULL OR created_at >= ${from}::date)
        AND (${to}::date        IS NULL OR created_at <  (${to}::date + INTERVAL '1 day'))
        AND (${agentName}::text IS NULL OR agent_name = ${agentName})
        AND (${routeType}::text IS NULL OR route_type = ${routeType})
      GROUP BY agent_name
      ORDER BY count DESC
    `,

    // Breakdown by route type
    sql`
      SELECT
        route_type,
        COUNT(*)::integer AS count
      FROM agent_runs
      WHERE (${orgId}::uuid     IS NULL OR organisation_id = ${orgId}::uuid)
        AND (${from}::date      IS NULL OR created_at >= ${from}::date)
        AND (${to}::date        IS NULL OR created_at <  (${to}::date + INTERVAL '1 day'))
        AND (${agentName}::text IS NULL OR agent_name = ${agentName})
        AND (${routeType}::text IS NULL OR route_type = ${routeType})
      GROUP BY route_type
      ORDER BY count DESC
    `,

    // 50 most recent runs
    sql`
      SELECT
        ar.id,
        ar.agent_name,
        ar.route_type,
        ar.input_query,
        ar.confidence,
        ar.source_rows,
        ar.created_at,
        o.name AS org_name
      FROM agent_runs ar
      LEFT JOIN organisations o ON o.id = ar.organisation_id
      WHERE (${orgId}::uuid     IS NULL OR ar.organisation_id = ${orgId}::uuid)
        AND (${from}::date      IS NULL OR ar.created_at >= ${from}::date)
        AND (${to}::date        IS NULL OR ar.created_at <  (${to}::date + INTERVAL '1 day'))
        AND (${agentName}::text IS NULL OR ar.agent_name = ${agentName})
        AND (${routeType}::text IS NULL OR ar.route_type = ${routeType})
      ORDER BY ar.created_at DESC
      LIMIT 50
    `,

    // Org list for filter dropdown
    sql`SELECT id, name FROM organisations ORDER BY name`,
  ]);

  return NextResponse.json({
    stats:    statsRows[0]   ?? { total_runs: 0, fallback_count: 0, avg_confidence: null },
    byAgent:  byAgentRows,
    byRoute:  byRouteRows,
    recent:   recentRows,
    topRoute: (byRouteRows as { route_type: string }[])[0]?.route_type ?? null,
    orgs:     orgRows,
  });
}
