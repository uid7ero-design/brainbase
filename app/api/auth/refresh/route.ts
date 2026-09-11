import { NextResponse } from 'next/server';
import sql from '@/lib/db';
import { refreshSession } from '@/lib/session';
import { requireSession } from '@/lib/org';

export async function POST() {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. refreshSession() (lib/session.ts, unchanged below)
  // re-signs the cookie's OWN existing payload verbatim with a fresh 12h
  // expiry — it does not itself re-check the DB. Before this fix, that
  // meant a since-deactivated, since-deleted, or since-reassigned user
  // could keep sliding their session forward indefinitely, forever, just
  // by calling refresh before each 12h expiry — the one place in the app
  // that could grant an EXTENDED valid session never re-validated at all.
  // requireSession() (lib/org.ts) now gates this: a user who no longer
  // validates against the DB gets a 401 here instead of a renewed
  // session, and their existing (still-valid-until-expiry) JWT simply
  // expires naturally 12h after their last successful refresh, with no
  // way to extend it further. refreshSession()'s own internals (still
  // copying the JWT's existing role/organisationId claims into the
  // reissued token) are intentionally untouched — nothing in this
  // codebase trusts those claims for authorization once requireSession()/
  // requireRole() is available (every fixed route re-reads the DB
  // directly), so a possibly-stale role/org claim surviving inside an
  // otherwise-legitimate refresh is not a live security exposure, and
  // changing refreshSession()'s own claim-construction is a separate,
  // broader lib/session.ts change this phase does not need.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }

  await sql`UPDATE users SET last_seen_at = NOW() WHERE id = ${session.userId}`.catch(() => {});
  const ok = await refreshSession();

  return NextResponse.json({ ok, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString() });
}
