import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import sql from '@/lib/db';
import { requireSession, unauthorized } from '@/lib/org';

const anthropic = new Anthropic();

const REPORT_TYPES = [
  'waste_summary',
  'contamination',
  'cost_analysis',
  'diversion_rate',
  'custom',
] as const;

type ReportType = typeof REPORT_TYPES[number];

function buildReportPrompt(
  reportType: ReportType,
  customPrompt: string | undefined,
  orgName: string,
  records: Record<string, unknown>[],
): string {
  const today = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const dataStr = JSON.stringify(records.slice(0, 200), null, 2);

  const typeInstructions: Record<ReportType, string> = {
    waste_summary:   'Provide a comprehensive waste operations summary covering tonnage by service type, collection performance, and key trends.',
    contamination:   'Analyse contamination rates by suburb and service type. Highlight problem areas, root causes, and recommended interventions.',
    cost_analysis:   'Break down costs per tonne, per collection, and per suburb. Identify the highest-cost areas and efficiency improvement opportunities.',
    diversion_rate:  'Calculate and analyse the diversion rate (recycling + organics / total waste). Compare against typical council targets of 60%+ and recommend improvements.',
    custom:          customPrompt ?? 'Provide a general analysis of the waste data.',
  };

  return `You are HLNA, a waste operations analyst for ${orgName}. Today is ${today}.

Generate a detailed ${reportType.replace(/_/g, ' ')} report in Markdown format.

Instructions: ${typeInstructions[reportType]}

Requirements:
- Start with a concise Executive Summary (2–3 sentences)
- Include specific numbers and percentages from the data
- Organise with clear headings (##, ###)
- End with 3–5 prioritised Recommendations
- Write for a council manager audience — professional, direct, no fluff

Waste data (up to 200 records):
\`\`\`json
${dataStr}
\`\`\``;
}

/**
 * GET /api/reports
 * Lists reports for the caller's organisation.
 */
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const { searchParams } = req.nextUrl;
  const reportType = searchParams.get('reportType');

  const reports = await sql`
    SELECT
      r.id,
      r.report_type,
      r.report_title,
      r.created_at,
      r.source_file_id,
      u.name AS created_by_name,
      uf.file_name AS source_file_name
    FROM reports r
    JOIN users u ON u.id = r.created_by
    LEFT JOIN uploaded_files uf ON uf.id = r.source_file_id
    WHERE r.organisation_id = ${session.organisationId}
      ${reportType ? sql`AND r.report_type = ${reportType}` : sql``}
    ORDER BY r.created_at DESC
  `;

  return NextResponse.json({ reports });
}

/**
 * POST /api/reports
 * Generates a new HLNA report from the organisation's waste data.
 *
 * Body: {
 *   reportType: ReportType,
 *   reportTitle?: string,
 *   sourceFileId?: string,   // scope to a specific uploaded file
 *   customPrompt?: string,   // used when reportType = 'custom'
 * }
 */
export async function POST(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }

  const body = await req.json() as {
    reportType?: string;
    reportTitle?: string;
    sourceFileId?: string;
    customPrompt?: string;
  };

  const reportType = (body.reportType ?? 'waste_summary') as ReportType;
  if (!REPORT_TYPES.includes(reportType)) {
    return NextResponse.json(
      { error: `Invalid reportType. Must be one of: ${REPORT_TYPES.join(', ')}` },
      { status: 400 },
    );
  }

  // Verify sourceFile belongs to org (if provided)
  if (body.sourceFileId) {
    const check = await sql`
      SELECT id FROM uploaded_files
      WHERE id = ${body.sourceFileId} AND organisation_id = ${session.organisationId}
      LIMIT 1
    `;
    if (check.length === 0) {
      return NextResponse.json({ error: 'Source file not found.' }, { status: 404 });
    }
  }

  // Fetch organisation name for the report
  const orgRows = await sql`
    SELECT name FROM organisations WHERE id = ${session.organisationId} LIMIT 1
  `;
  const orgName: string = orgRows[0]?.name ?? 'Unknown Organisation';

  // Fetch waste records scoped to this org (and optionally this file)
  const records = await sql`
    SELECT * FROM waste_records
    WHERE organisation_id = ${session.organisationId}
      ${body.sourceFileId ? sql`AND uploaded_file_id = ${body.sourceFileId}` : sql``}
    ORDER BY created_at DESC
    LIMIT 500
  `;

  if (records.length === 0) {
    return NextResponse.json(
      { error: 'No waste records found. Upload a spreadsheet first.' },
      { status: 422 },
    );
  }

  const prompt = buildReportPrompt(reportType, body.customPrompt, orgName, records as Record<string, unknown>[]);

  let content: string;
  try {
    const msg = await anthropic.messages.create({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      system:     'You are HLNA, a professional waste operations analyst. Always respond in well-structured Markdown.',
      messages:   [{ role: 'user', content: prompt }],
    });
    content = msg.content[0].type === 'text' ? msg.content[0].text : '';
  } catch (err) {
    console.error('[reports] Claude error:', err);
    return NextResponse.json({ error: 'Report generation failed.' }, { status: 500 });
  }

  const title = body.reportTitle
    ?? `${reportType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())} — ${orgName} — ${new Date().toLocaleDateString('en-AU')}`;

  const reportRows = await sql`
    INSERT INTO reports (organisation_id, created_by, report_type, report_title, report_content, source_file_id)
    VALUES (
      ${session.organisationId},
      ${session.userId},
      ${reportType},
      ${title},
      ${content},
      ${body.sourceFileId ?? null}
    )
    RETURNING id, report_type, report_title, created_at
  `;

  return NextResponse.json({ success: true, report: reportRows[0] }, { status: 201 });
}
