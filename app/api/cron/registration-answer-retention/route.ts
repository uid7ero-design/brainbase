import { NextResponse } from 'next/server';
import { runAnswerRetention } from '@/lib/events/answerRetention';
import { secureCompare } from '@/lib/secureCompare';

/**
 * GET /api/cron/registration-answer-retention
 *
 * ADR 0013 §4b — removes registration-answer values once their category's
 * retention period has passed (lib/events/answerRetention.ts). Daily, via
 * vercel.json.
 *
 * REPORT-ONLY BY DEFAULT: it only removes answers when
 * EVE_ANSWER_RETENTION_ENFORCE is exactly "true" (same exact-match
 * convention as the other Eve flags). Anything else — unset, "false",
 * "TRUE" — is a dry run that changes nothing and reports what is due. So
 * deploying this route can never delete data by itself; enforcement is a
 * separate, deliberate operator step.
 *
 * Same CRON_SECRET Bearer authorization as the other cron routes; fails
 * closed when the secret is not configured. Logs and responds with counts
 * only — never answer text, labels, ids or organisation names.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[cron/registration-answer-retention] CRON_SECRET is not configured — refusing all requests.');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!secureCompare(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const mode = process.env.EVE_ANSWER_RETENTION_ENFORCE === 'true' ? 'enforce' : 'dry-run';
  try {
    const summary = await runAnswerRetention({ mode });
    console.log(
      `[events cron/registration-answer-retention] mode=${summary.mode} due=${summary.due} redacted=${summary.redacted} ` +
      `held=${summary.held} events=${summary.events} by_category=${JSON.stringify(summary.by_category)} duration_ms=${summary.duration_ms}`,
    );
    return NextResponse.json(summary);
  } catch (err) {
    console.error('[events cron/registration-answer-retention] fatal:', err instanceof Error ? err.name : 'error');
    return NextResponse.json({ error: 'Retention run failed.' }, { status: 500 });
  }
}
