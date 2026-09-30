import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession } from '@/lib/org';
import { createSession } from '@/lib/session';
import {
  validateFirstName, validateLastName, validateDisplayName, validateAboutMe,
  validateJobTitle, validateDepartment, validatePhone, validateTimezone, validatePreferences,
} from '@/lib/account/profileValidation';

export async function GET() {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never revalidated
  // against the DB. requireSession() (lib/org.ts) re-reads the caller's
  // current role/organisation/status from the database on every call, so
  // a since-deactivated, since-reassigned, or deleted user's still-valid
  // JWT can no longer read this profile/org projection.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }

  const [user] = await sql`
    SELECT
      u.id, u.username, u.name, u.email, u.role,
      u.first_name, u.last_name, u.display_name, u.avatar_url, u.bio,
      u.job_title, u.department, u.phone, u.timezone, u.preferences,
      u.created_at, u.last_seen_at,
      o.name  AS org_name,
      o.slug  AS org_slug,
      o.industry AS org_industry,
      o.logo_url AS org_logo_url,
      o.website  AS org_website
    FROM users u
    JOIN organisations o ON o.id = u.organisation_id
    WHERE u.id = ${session.userId}
  `;

  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  // Phase C1.3: previously unwrapped and joined on m.id = om.module_id —
  // modules has no `id`/`industry` column under the current schema, so this
  // threw unconditionally and crashed the whole GET response (this method
  // has no live caller today, see the C1 report — but a route that 500s on
  // every call is still worth fixing rather than leaving broken). Corrected
  // join, `industry` dropped (never a real column), and wrapped so a failure
  // here can never take down the rest of the response. Fails closed to an
  // empty list.
  let modules: { key: string; name: string; description: string | null }[] = [];
  try {
    const modRows = await sql`
      SELECT m.key, m.name, m.description
      FROM organisation_modules om
      JOIN modules m ON m.key = om.module_key
      WHERE om.organisation_id = ${session.organisationId}
        AND om.enabled = true
      ORDER BY m.name
    `;
    modules = modRows as typeof modules;
  } catch {
    // Fail closed to an empty list.
  }

  return NextResponse.json({ user, modules });
}

// avatar_url is deliberately NOT in this allow-list. It is written only
// by the validated avatar upload endpoint (POST /api/account/avatar),
// which sniffs real image bytes before ever touching Blob storage — if
// this generic PUT accepted avatar_url too, a caller could bypass every
// one of those checks by simply supplying an arbitrary string
// (including a URL that never resolves to an image at all, or one this
// app does not own and so can never safely clean up later). id,
// organisation_id, role, status, password/hash, and username/auth
// identifiers are likewise never in this list, and never will be —
// this route only ever updates the CALLER'S OWN row (WHERE id =
// session.userId, from requireSession(), never request input), so even
// an attempted role/org field here would only ever "escalate" the
// caller's own row — it is excluded anyway as defense in depth, not as
// the only thing preventing cross-account writes.
const ALLOWED_FIELDS = [
  'first_name', 'last_name', 'display_name', 'bio',
  'job_title', 'department', 'phone', 'timezone', 'preferences',
] as const;

// Fields whose effective value feeds the display name shown in the
// authenticated chrome (TopNav, via /api/me's `name`, which reads
// session.name — the JWT claim, not a fresh DB read). Changing any of
// these without reissuing the session cookie would leave that name
// stale until the user's next login — see the reissue step below.
const NAME_AFFECTING_FIELDS = new Set(['first_name', 'last_name', 'display_name']);

const VALIDATORS: Record<(typeof ALLOWED_FIELDS)[number], (value: unknown) => { ok: true; value: unknown } | { ok: false; error: string }> = {
  first_name: validateFirstName,
  last_name: validateLastName,
  display_name: validateDisplayName,
  bio: validateAboutMe,
  job_title: validateJobTitle,
  department: validateDepartment,
  phone: validatePhone,
  timezone: validateTimezone,
  preferences: validatePreferences,
};

export async function PUT(req: NextRequest) {
  // SEC-1B3: was raw getSession() — see GET's own comment above for the
  // full rationale.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorised' }, { status: 401 }); }

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  // Only allow safe profile fields — never role, organisation_id,
  // avatar_url, etc. Every field is independently validated (type +
  // length, or shape for preferences) server-side — never trusted on
  // the strength of client-side validation alone.
  const updates: Record<string, unknown> = {};
  const touchedFields: string[] = [];
  for (const field of ALLOWED_FIELDS) {
    if (!(field in body)) continue;
    const result = VALIDATORS[field](body[field]);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    updates[field] = result.value;
    touchedFields.push(field);
  }

  if (touchedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 });
  }

  const {
    first_name, last_name, display_name, bio,
    job_title, department, phone, timezone, preferences,
  } = updates as Partial<Record<(typeof ALLOWED_FIELDS)[number], unknown>>;

  try {
    const [row] = await sql`
      UPDATE users SET
        first_name   = COALESCE(${(first_name as string) ?? null}, first_name),
        last_name    = COALESCE(${(last_name as string) ?? null}, last_name),
        display_name = COALESCE(${(display_name as string) ?? null}, display_name),
        bio          = COALESCE(${(bio as string) ?? null}, bio),
        job_title    = COALESCE(${(job_title as string) ?? null}, job_title),
        department   = COALESCE(${(department as string) ?? null}, department),
        phone        = COALESCE(${(phone as string) ?? null}, phone),
        timezone     = COALESCE(${(timezone as string) ?? null}, timezone),
        preferences  = COALESCE(${preferences != null ? JSON.stringify(preferences) : null}::jsonb, preferences),
        updated_at   = NOW()
      WHERE id = ${session.userId}
      RETURNING name, first_name, last_name, display_name
    `;

    // Keep the JWT-carried display name (what TopNav/`/api/me` actually
    // render — see app/layout.tsx and app/api/me/route.ts) in sync with
    // the DB the instant a name-affecting field changes, exactly the
    // same mechanism app/actions/profile.ts's own updateProfile() action
    // already uses for the legacy /profile "Display Name" card — reused
    // here, not reinvented. Same effective-name precedence the profile
    // page's own UI already applies: display_name, else first+last,
    // else the existing `name` column (never touched by this route).
    if (row && touchedFields.some(f => NAME_AFFECTING_FIELDS.has(f))) {
      const effectiveName =
        (row.display_name as string | null) ||
        [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
        (row.name as string);
      if (effectiveName) {
        await createSession(session.userId, session.organisationId, session.role, effectiveName);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[account/profile PUT]', err);
    return NextResponse.json({ error: String((err as Error).message ?? 'Save failed') }, { status: 500 });
  }
}
