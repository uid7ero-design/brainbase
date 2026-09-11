import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import sql from '@/lib/db';
import { IS_DEMO_MODE } from '@/lib/social/demo';

export async function GET() {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer read this org's social insights/stats.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  const oid = session.organisationId;

  const insights = await sql`
    SELECT id, insight_type, title, summary, evidence_json, confidence, recommended_action, created_at
    FROM social_insights
    WHERE organisation_id = ${oid}::uuid
    ORDER BY created_at DESC
    LIMIT 20
  `.catch(() => []);

  const [stats] = await sql`
    SELECT
      COUNT(*)::int                                                    AS post_count,
      ROUND(AVG(likes_count)::numeric, 1)::float                      AS avg_likes,
      ROUND(AVG(comments_count)::numeric, 1)::float                   AS avg_comments,
      ROUND(AVG(engagement_score)::numeric, 1)::float                 AS avg_engagement,
      COUNT(*) FILTER (WHERE posted_at >= NOW() - INTERVAL '30 days')::int AS posts_30d
    FROM social_posts
    WHERE organisation_id = ${oid}::uuid
  `.catch(() => [null]);

  const [commentStats] = await sql`
    SELECT
      COUNT(*)::int                                              AS total_comments,
      COUNT(*) FILTER (WHERE urgency = true)::int               AS urgent_count,
      COUNT(*) FILTER (WHERE sentiment = 'negative')::int       AS negative_count,
      COUNT(*) FILTER (WHERE sentiment = 'positive')::int       AS positive_count
    FROM social_comments
    WHERE organisation_id = ${oid}::uuid
  `.catch(() => [null]);

  return NextResponse.json({
    insights,
    stats: stats ?? {},
    commentStats: commentStats ?? {},
    demo: IS_DEMO_MODE,
  });
}
