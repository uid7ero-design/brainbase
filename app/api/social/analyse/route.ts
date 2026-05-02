import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import sql from '@/lib/db';
import * as socialAgent from '@/lib/agents/socialAgent';

export async function POST() {
  const session = await getSession();
  if (!session?.organisationId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const oid = session.organisationId;

  const result = await socialAgent.run({
    organisationId: oid,
    userId:         session.userId,
    query:          'generate social intelligence insights',
  });

  if (result.confidence === 0) {
    return NextResponse.json({ error: result.summary, warnings: result.warnings }, { status: 422 });
  }

  // Parse insights from findings and store to DB
  // findings come as alternating title/evidence lines — we store as individual insight rows
  const insightsToStore: Array<{
    insight_type: string;
    title: string;
    summary: string;
    evidence_json: unknown;
    confidence: string;
    recommended_action: string;
  }> = [];

  for (let i = 0; i < result.findings.length; i++) {
    const f = result.findings[i];
    if (!f.startsWith('  ·')) {
      // Main finding line — collect evidence bullet points that follow
      const evidence: string[] = [];
      let j = i + 1;
      while (j < result.findings.length && result.findings[j].startsWith('  ·')) {
        evidence.push(result.findings[j].replace(/^\s+·\s*/, ''));
        j++;
      }
      const titleMatch = f.match(/^\[(.+?)\]\s*(.*)/);
      insightsToStore.push({
        insight_type:      'analysis',
        title:             titleMatch?.[1] ?? f.slice(0, 80),
        summary:           titleMatch?.[2] ?? f,
        evidence_json:     evidence,
        confidence:        result.confidence >= 0.7 ? 'high' : result.confidence >= 0.5 ? 'medium' : 'low',
        recommended_action: result.recommendedActions[insightsToStore.length] ?? '',
      });
    }
  }

  // Upsert insights — clear old ones for this org first (keep last 20)
  if (insightsToStore.length > 0) {
    await sql`
      DELETE FROM social_insights
      WHERE organisation_id = ${oid}::uuid
        AND id NOT IN (
          SELECT id FROM social_insights
          WHERE organisation_id = ${oid}::uuid
          ORDER BY created_at DESC
          LIMIT 20
        )
    `.catch(() => {});

    for (const ins of insightsToStore) {
      await sql`
        INSERT INTO social_insights
          (organisation_id, insight_type, title, summary, evidence_json, confidence, recommended_action)
        VALUES
          (${oid}::uuid, ${ins.insight_type}, ${ins.title}, ${ins.summary},
           ${JSON.stringify(ins.evidence_json)}::jsonb, ${ins.confidence}, ${ins.recommended_action})
      `.catch(() => {});
    }
  }

  return NextResponse.json({
    summary:    result.summary,
    findings:   result.findings,
    confidence: result.confidence,
    warnings:   result.warnings,
    evidence:   result.evidence,
    stored:     insightsToStore.length,
  });
}
