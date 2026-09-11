import { NextRequest, NextResponse } from 'next/server';
import { requireRole } from '@/lib/org';
import { getClientIp } from '@/lib/clientIp';
import { logAdminCrossOrgReadAccessed } from '@/lib/admin/auditLog';
import sql from '@/lib/db';

function forbidden() { return NextResponse.json({ error: 'Forbidden' }, { status: 403 }); }
function requestMeta(req: NextRequest): { ipAddress: string | null; userAgent: string | null } {
  const ip = getClientIp(req);
  return { ipAddress: ip === 'unknown' ? null : ip, userAgent: req.headers.get('user-agent') };
}

export async function GET(req: NextRequest) {
  // SEC-1B2: was raw getSession() + `session.role !== 'super_admin'` — the
  // JWT-only role claim, never revalidated against the DB. requireRole()
  // (lib/org.ts) re-reads the caller's current role/organisation/status
  // from the database on every call, so a since-demoted, since-deactivated,
  // or deleted super_admin's still-valid JWT can no longer read this
  // cross-organisation agent-run report.
  let session;
  try { session = await requireRole('super_admin'); } catch { return forbidden(); }

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

  const stats = statsRows[0] ?? { total_runs: 0, fallback_count: 0, avg_confidence: null };

  // SEC-1B2: audit — this is a cross-organisation admin data read (the
  // whole point of the route), previously entirely unaudited. Logs the
  // filters applied and result counts only — never the actual rows (which
  // include ar.input_query, a free-text user prompt that can carry
  // protected/tenant data), per ADR-0003's no-sensitive-payload rule.
  {
    const { ipAddress, userAgent } = requestMeta(req);
    await logAdminCrossOrgReadAccessed({
      actorUserId: session.userId,
      actorOrganisationId: session.organisationId,
      filters: { orgId, from, to, agentName, routeType },
      resultCounts: { totalRuns: Number(stats.total_runs ?? 0), byAgent: byAgentRows.length, byRoute: byRouteRows.length, recent: recentRows.length },
      ipAddress,
      userAgent,
    });
  }

  return NextResponse.json({
    stats,
    byAgent:  byAgentRows,
    byRoute:  byRouteRows,
    recent:   recentRows,
    topRoute: (byRouteRows as { route_type: string }[])[0]?.route_type ?? null,
    orgs:     orgRows,
  });
}
