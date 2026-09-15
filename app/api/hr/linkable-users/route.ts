import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { isPersonInOrganisation } from '@/lib/hr/validation';

// HR-2 Step 1D1 — the ONLY candidate-account source for explicit HR
// person<->BrainBase-user linking. Deliberately NOT a reuse of
// GET /api/admin/users: that endpoint is `requireRole('super_admin')`
// (wrong gate — HR Administrator is a separate, narrower, per-
// organisation grant that must never require platform super_admin),
// queries `users` with NO organisation_id scoping at all (every
// organisation's users, platform-wide), and returns `role`/
// `email_verified`/`org_name` — exactly the admin/security metadata
// and cross-org exposure this endpoint must never carry. This route
// is purpose-built, narrow, and HR-admin-only.
//
// Gated identically to every other HR-admin-only route in this
// codebase (app/api/hr/teams/route.ts's POST, app/api/hr/people/
// route.ts's POST, etc.) — requireSession -> requireHrCapability
// (HR-2 Step 1A's own super_admin People-module bypass applies here
// unchanged, no route-local exception) -> resolveHrAccessContext ->
// ctx.isHrAdministrator. super_admin already receives
// isHrAdministrator: true through that same, unmodified central
// resolution — no separate branch is added here for it.
//
// Response fields are the documented, deliberately narrow allowlist:
// id, name (users.name — the one guaranteed-present display field on
// the real `users` table, confirmed against prisma/schema.prisma's
// User model; `first_name`/`last_name`/`display_name` appear in
// app/api/me/route.ts's own query but that call site defensively
// wraps them in a try/catch specifically because those columns are
// NOT confirmed to exist in every environment — this route does not
// depend on them), email (approved for this HR-admin-only picker only
// — HR admins already see hr_people.work_email, a comparably
// sensitive field, so this is not a new exposure category),
// already_linked/linked_person_id (computed via a same-organisation
// LEFT JOIN against hr_people, never a second round trip), and
// selectable (see below). Never role, status, password/password_hash,
// email_verified, last_login_at, preferences, or any other
// organisation's rows.
//
// HR-2 Step 1D1 (corrective pass) — optional `?person_id=<uuid>` query
// param, for the edit-person case only. Without it (create-person
// mode), behavior is unchanged: ACTIVE same-org users only. With it,
// the response ALSO includes the one user currently linked to that
// person, even if that user is now INACTIVE/INVITED — otherwise an
// HR admin editing a person whose linked account went inactive would
// lose all visibility into which account is linked, and the "unlink"
// action would have no legible label to show. This does NOT make
// inactive users generally enumerable: only the specific account
// already linked to the requested person can appear this way, never
// any other inactive/invited account. person_id is verified against
// the ACTIVE organisation via isPersonInOrganisation() before use —
// a cross-org person_id gets the same 404 this codebase's other
// person-scoped routes use (see app/api/hr/people/[id]/route.ts),
// never a distinguishable error that would confirm the id exists
// elsewhere.
//
// `selectable` is a server-computed boolean (ACTIVE AND (not linked
// to anyone, OR linked to exactly this person_id)) rather than
// exposing the raw `status` enum to the client — deliberately less
// platform metadata for the same UX outcome. `already_linked`/
// `linked_person_id` remain in the response for existing UX labeling
// ("already linked" text), but `selectable` is the authoritative
// disabling signal a caller should actually gate on.
export async function GET(req: NextRequest) {
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  if (!ctx.isHrAdministrator) return forbidden();

  const personId = new URL(req.url).searchParams.get('person_id');
  if (personId && !(await isPersonInOrganisation(personId, session.organisationId))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // organisation_id is part of the WHERE clause, not applied after the
  // fact — no other organisation's users are ever fetched, let alone
  // returned. status = 'ACTIVE' matches prisma/schema.prisma's
  // UserStatus enum's own declared member name exactly (no @@map
  // override exists on that enum, unlike the unrelated
  // SourceRecordObservationOutcome case elsewhere in this schema —
  // confirmed by direct inspection immediately before writing this
  // query). The `OR hp.id = personId::uuid` branch is the sole
  // widening for the current-link case: when personId is null this
  // condition is simply always false/unknown in SQL, so the WHERE
  // clause naturally degrades to "ACTIVE only" with no branching query
  // construction needed.
  const rows = await sql`
    SELECT
      u.id,
      u.name,
      u.email,
      u.status,
      hp.id AS linked_person_id
    FROM users u
    LEFT JOIN hr_people hp ON hp.linked_user_id = u.id AND hp.organisation_id = u.organisation_id
    WHERE u.organisation_id = ${session.organisationId}
      AND (u.status = 'ACTIVE' OR hp.id = ${personId}::uuid)
    ORDER BY u.name
  `;

  const users = rows.map(row => {
    const linkedPersonId = (row.linked_person_id as string | null) ?? null;
    const status = row.status as string;
    return {
      id: row.id as string,
      name: row.name as string,
      email: (row.email as string | null) ?? null,
      already_linked: linkedPersonId !== null,
      linked_person_id: linkedPersonId,
      selectable: status === 'ACTIVE' && (linkedPersonId === null || linkedPersonId === personId),
    };
  });

  return NextResponse.json({ users });
}
