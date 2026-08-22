import 'server-only';
import { NextResponse } from 'next/server';
import { getAuthSession } from '@/lib/authSession';
import {
  getApplicationIdentity,
  checkDatabase,
  getGmailState,
  getGoogleCalendarState,
  getInstagramState,
} from '@/lib/founder/systemSignals';

// Founder OS Phase E.1 — real system-health aggregate. super_admin only,
// matching every other founder/* route (requireFounderSession() pattern
// copied verbatim from app/api/founder/tasks/route.ts).
//
// Deliberately narrow: application identity (Vercel runtime env vars),
// one live DB check, and BrainBase's own Gmail/Google Calendar/Instagram
// connection state. Per the Phase E.0 audit and a read-only Production
// check James ran directly against Neon: integrations, sync_jobs, and
// agent_runs do not exist in Production, and users.last_login_at is
// populated for 0 of 5 users — none of those are queried anywhere in this
// route or in lib/founder/systemSignals.ts. No secrets, tokens, or
// integration config are ever included in the response.

async function requireFounderSession() {
  const session = await getAuthSession();
  if (session.role !== 'super_admin') throw new Error('Forbidden');
  return session;
}

export async function GET() {
  try {
    await requireFounderSession();
  } catch (err) {
    const status = (err as Error).message === 'Forbidden' ? 403 : 401;
    return NextResponse.json({ error: (err as Error).message || 'Unauthorized' }, { status });
  }

  const [database, instagram] = await Promise.all([
    checkDatabase(),
    getInstagramState(),
  ]);

  return NextResponse.json({
    application: getApplicationIdentity(),
    database,
    services: {
      gmail: { state: getGmailState() },
      googleCalendar: { state: getGoogleCalendarState() },
      instagram: { state: instagram },
    },
  });
}
