import { NextRequest, NextResponse } from 'next/server';

const BACKEND = process.env.NEXT_PUBLIC_API_URL ?? '';

type AnyObj = Record<string, unknown>;

function countArray(v: unknown): number {
  return Array.isArray(v) ? v.length : 0;
}

function logPipelineShape(label: string, obj: AnyObj) {
  const result = (obj.result && typeof obj.result === 'object' ? obj.result : obj) as AnyObj;
  console.log(`[HLNA /run] ${label} pipeline shape:`, {
    type:                obj.type,
    risks:               countArray(result.risks),
    recommended_actions: countArray(result.recommended_actions),
    key_insights:        countArray(result.key_insights),
    insights:            countArray(result.insights),
    trends:              countArray(result.trends),
    opportunities:       countArray(result.opportunities),
    data_quality:        result.data_quality ? (typeof result.data_quality === 'object' ? 'object' : result.data_quality) : null,
    data_issues:         countArray(result.data_issues),
    findings:            countArray(result.findings),
    warnings:            countArray(result.warnings),
    has_executive_summary: !!result.executive_summary,
    executive_summary_keys: result.executive_summary && typeof result.executive_summary === 'object'
      ? Object.keys(result.executive_summary as object)
      : [],
    executive_summary_headline: (result.executive_summary as AnyObj | undefined)?.headline,
    overall_status:     result.overall_status,
    confidence_score:   result.confidence_score,
    summary:            typeof result.summary === 'string' ? result.summary?.slice(0, 120) : null,
  });
}

export async function POST(req: NextRequest) {
  let body: AnyObj;
  try {
    body = await req.json() as AnyObj;
  } catch (e) {
    console.error('[HLNA /run] failed to parse request body:', e);
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  console.log('[HLNA /run] request — query:', body.query, '| file_path:', body.file_path ?? '(none)');

  let backendRes: Response;
  try {
    backendRes = await fetch(`${BACKEND}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    console.error('[HLNA /run] network error reaching backend:', e);
    return NextResponse.json({ error: 'Backend unreachable' }, { status: 502 });
  }

  let data: unknown;
  try {
    data = await backendRes.json();
  } catch {
    const text = await backendRes.text().catch(() => '');
    console.error('[HLNA /run] backend returned non-JSON (status', backendRes.status, '):', text.slice(0, 1000));
    return NextResponse.json({ error: 'Backend returned non-JSON', status: backendRes.status, raw: text.slice(0, 500) }, { status: 502 });
  }

  console.log('[HLNA /run] backend status:', backendRes.status);
  console.log('[HLNA /run] raw response (truncated):', JSON.stringify(data).slice(0, 2000));

  if (data && typeof data === 'object') {
    logPipelineShape('response', data as AnyObj);
  }

  return NextResponse.json(data, { status: backendRes.status });
}
