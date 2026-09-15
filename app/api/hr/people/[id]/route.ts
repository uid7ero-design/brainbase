import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { requireSession, unauthorized, forbidden } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { resolveHrAccessContext } from '@/lib/hr/context';
import { canViewPerson, canEditPerson, canManageEmployment } from '@/lib/hr/access';
import { projectPersonRow, type HrPersonRow } from '@/lib/hr/projectPerson';
import { logHrEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { toDateStr } from '@/lib/date';
import {
  isValidWorkerType, isValidEmploymentStatus, isValidHrDate,
  isTeamInOrganisation, isTeamActive, isPersonInOrganisation, isUserInOrganisation,
  isLinkedUserUniqueViolation,
} from '@/lib/hr/validation';
import { wouldCreateManagerCycle } from '@/lib/hr/reportingLines';

// HR-2 Step 1C — empirically confirmed (by directly invoking
// @neondatabase/serverless's own registered OID-1082 type parser; see
// this phase's own report) that this repo's `sql` client returns a
// Postgres DATE column as a native JS Date object, not the 'YYYY-MM-DD'
// string HrPersonRow's own type declares — the SAME, already-documented
// behavior lib/commercial/dates.ts's own Phase C3-EMAIL-FIX comment
// describes for the identical driver/column type. Left un-normalized,
// this breaks two things: (1) PR #212's changedFields diff, since
// `existing.start_date` (a Date) is never `===`-equal to
// `updates.start_date` (always a raw request-body string), so any
// resubmission of an unchanged date is misdetected as a real change;
// (2) API/audit output, since a raw Date serializes via
// `Date.prototype.toJSON()`/`toISOString()` into a full timestamp
// instead of a plain date. Normalizing immediately after every raw SQL
// read — using this repo's own existing, already-proven
// lib/date.ts#toDateStr() (local-getter based, matching how the driver
// itself constructs the Date from local components) — fixes both at
// the one point every downstream comparison/response already flows
// through, without touching lib/hr/access.ts, lib/hr/context.ts, or any
// same-org validation semantics.
function normalizePersonDates(row: HrPersonRow): HrPersonRow {
  const start = row.start_date as unknown;
  const end = row.end_date as unknown;
  return {
    ...row,
    start_date: start instanceof Date ? toDateStr(start) : (start as string | null),
    end_date: end instanceof Date ? toDateStr(end) : (end as string | null),
  };
}

async function loadPerson(id: string, organisationId: string): Promise<HrPersonRow | null> {
  // organisation_id is part of the WHERE clause, not applied after the
  // fact — a valid person id from a DIFFERENT organisation returns zero
  // rows here, indistinguishable from a non-existent id. Cross-tenant
  // access fails even when the id itself is a real, guessed row from
  // another organisation.
  const rows = await sql`
    SELECT
      p.*,
      t.name AS team_name,
      m.first_name AS manager_first_name,
      m.last_name AS manager_last_name
    FROM hr_people p
    LEFT JOIN hr_teams t ON t.id = p.team_id
    LEFT JOIN hr_people m ON m.id = p.manager_person_id
    WHERE p.id = ${id}::uuid AND p.organisation_id = ${organisationId}
    LIMIT 1
  ` as HrPersonRow[];
  const row = rows[0];
  return row ? normalizePersonDates(row) : null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const person = await loadPerson(id, session.organisationId);
  if (!person) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  const target = { organisationId: person.organisation_id, personId: person.id, managerPersonId: person.manager_person_id };
  if (!canViewPerson(ctx, target)) return forbidden();

  return NextResponse.json({ person: projectPersonRow(ctx, target, person) });
}

// HR-1 — field-group-aware PATCH: identity/personal fields follow
// canEditPerson() (self or HR administrator); employment fields
// (job_title, worker_type, employment_status, team_id,
// manager_person_id, start_date, end_date) follow canManageEmployment()
// (HR administrator only, never self-service, matching the brief's own
// "employment-status/manager/team changes — HR-administrator only");
// linked_user_id changes require ctx.isHrAdministrator directly (no
// dedicated access.ts function exists for it — linking must always be
// an explicit, deliberate HR-administrator action per HR-0's Critical
// Domain Rule, never inferred and never self-service). If the caller
// supplies ANY field they are not permitted to change, the WHOLE
// request is rejected (403) rather than silently dropping fields — a
// partially-applied PATCH would be a confusing, hard-to-audit outcome.
const IDENTITY_FIELDS = ['first_name', 'last_name', 'preferred_name', 'work_email', 'work_phone'] as const;
const EMPLOYMENT_FIELDS = ['job_title', 'worker_type', 'employment_status', 'team_id', 'manager_person_id', 'start_date', 'end_date'] as const;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let session;
  try { session = await requireSession(); } catch { return unauthorized(); }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) return NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 });
    return forbidden();
  }

  const existing = await loadPerson(id, session.organisationId);
  if (!existing) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  const ctx = await resolveHrAccessContext({ organisationId: session.organisationId, userId: session.userId, role: session.role });
  const target = { organisationId: existing.organisation_id, personId: existing.id, managerPersonId: existing.manager_person_id };

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const providedFields = Object.keys(body);

  // These three ("wants...Change") reflect fields REQUESTED by the
  // caller (key presence in the body) — they exist purely to decide
  // authorization/validation below and must never be used to decide
  // audit content (see changedFields further down, computed from actual
  // DB-value differences once `updates` is built and validated).
  const wantsIdentityChange = providedFields.some(f => (IDENTITY_FIELDS as readonly string[]).includes(f));
  const wantsEmploymentChange = providedFields.some(f => (EMPLOYMENT_FIELDS as readonly string[]).includes(f));
  const wantsLinkChange = providedFields.includes('linked_user_id');

  if (wantsIdentityChange && !canEditPerson(ctx, target)) return forbidden();
  if (wantsEmploymentChange && !canManageEmployment(ctx, target)) return forbidden();
  if (wantsLinkChange && !ctx.isHrAdministrator) return forbidden();

  const unknownField = providedFields.find(f =>
    !(IDENTITY_FIELDS as readonly string[]).includes(f) && !(EMPLOYMENT_FIELDS as readonly string[]).includes(f) && f !== 'linked_user_id',
  );
  if (unknownField) return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });

  const updates: Record<string, unknown> = {};

  if ('first_name' in body) {
    const v = typeof body.first_name === 'string' ? body.first_name.trim() : '';
    if (!v) return NextResponse.json({ error: 'first_name cannot be empty.' }, { status: 400 });
    updates.first_name = v;
  }
  if ('last_name' in body) {
    const v = typeof body.last_name === 'string' ? body.last_name.trim() : '';
    if (!v) return NextResponse.json({ error: 'last_name cannot be empty.' }, { status: 400 });
    updates.last_name = v;
  }
  if ('preferred_name' in body) updates.preferred_name = typeof body.preferred_name === 'string' ? body.preferred_name.trim() || null : null;
  if ('work_email' in body) updates.work_email = typeof body.work_email === 'string' ? body.work_email.trim() || null : null;
  if ('work_phone' in body) updates.work_phone = typeof body.work_phone === 'string' ? body.work_phone.trim() || null : null;
  if ('job_title' in body) updates.job_title = typeof body.job_title === 'string' ? body.job_title.trim() || null : null;

  if ('worker_type' in body) {
    if (!isValidWorkerType(body.worker_type)) return NextResponse.json({ error: 'Invalid worker_type.' }, { status: 400 });
    updates.worker_type = body.worker_type;
  }
  if ('employment_status' in body) {
    if (!isValidEmploymentStatus(body.employment_status)) return NextResponse.json({ error: 'Invalid employment_status.' }, { status: 400 });
    updates.employment_status = body.employment_status;
  }

  if ('team_id' in body) {
    const teamId = typeof body.team_id === 'string' && body.team_id ? body.team_id : null;
    if (teamId && !(await isTeamInOrganisation(teamId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid team.' }, { status: 400 });
    }
    // HR-2 Step 1B — only an ACTUAL team_id change is checked against
    // archive state. A person may keep an existing (even archived) team
    // assignment untouched (this PATCH resubmitting the same team_id
    // alongside an unrelated field change must not suddenly fail), and
    // may always be cleared off a team (teamId === null here always
    // passes this check) — only a genuine move ONTO a specific,
    // different, archived team is rejected.
    if (teamId && teamId !== existing.team_id && !(await isTeamActive(teamId, session.organisationId))) {
      return NextResponse.json({ error: 'Cannot assign to an archived team.', code: 'team_archived' }, { status: 400 });
    }
    updates.team_id = teamId;
  }

  if ('manager_person_id' in body) {
    const managerPersonId = typeof body.manager_person_id === 'string' && body.manager_person_id ? body.manager_person_id : null;
    if (managerPersonId === existing.id) {
      return NextResponse.json({ error: 'A person cannot manage themselves.' }, { status: 400 });
    }
    if (managerPersonId && !(await isPersonInOrganisation(managerPersonId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid manager.' }, { status: 400 });
    }
    // HR-2 Step 1C — only an ACTUAL manager_person_id change is checked
    // against cycle formation, mirroring team_id's own already-proven
    // `teamId !== existing.team_id` gate (HR-2 Step 1B) exactly, one
    // field over. Resubmitting the person's current, unchanged manager
    // (alongside any other real edit) must never trigger a cycle query,
    // and clearing the manager (managerPersonId === null) is always
    // allowed without any traversal — both preserved by this same `&&`
    // short-circuit.
    if (managerPersonId && managerPersonId !== existing.manager_person_id) {
      const wouldCycle = await wouldCreateManagerCycle({
        organisationId: session.organisationId,
        personId: existing.id,
        proposedManagerPersonId: managerPersonId,
      });
      if (wouldCycle) {
        return NextResponse.json({ error: 'This assignment would create a manager cycle.', code: 'manager_cycle' }, { status: 400 });
      }
    }
    updates.manager_person_id = managerPersonId;
  }

  // HR-2 Step 1C — strict format/calendar validation first (each field
  // independently), then an EFFECTIVE-resulting-state ordering check
  // below — using the RESULTING start/end pair (this request's
  // validated value where provided, otherwise the person's existing,
  // already-normalized value), not merely the fields present in THIS
  // request. This is what correctly catches e.g. a PATCH that only
  // sends a new start_date landing after the person's existing,
  // untouched end_date.
  if ('start_date' in body) {
    const v = typeof body.start_date === 'string' ? body.start_date : null;
    if (v !== null && !isValidHrDate(v)) {
      return NextResponse.json({ error: 'Invalid start_date.', code: 'invalid_start_date' }, { status: 400 });
    }
    updates.start_date = v;
  }
  if ('end_date' in body) {
    const v = typeof body.end_date === 'string' ? body.end_date : null;
    if (v !== null && !isValidHrDate(v)) {
      return NextResponse.json({ error: 'Invalid end_date.', code: 'invalid_end_date' }, { status: 400 });
    }
    updates.end_date = v;
  }
  {
    const effectiveStart = ('start_date' in updates ? updates.start_date : existing.start_date) as string | null;
    const effectiveEnd = ('end_date' in updates ? updates.end_date : existing.end_date) as string | null;
    if (effectiveStart !== null && effectiveEnd !== null && effectiveEnd < effectiveStart) {
      return NextResponse.json({ error: 'end_date cannot be before start_date.', code: 'invalid_employment_dates' }, { status: 400 });
    }
  }

  if ('linked_user_id' in body) {
    const linkedUserId = typeof body.linked_user_id === 'string' && body.linked_user_id ? body.linked_user_id : null;
    if (linkedUserId && !(await isUserInOrganisation(linkedUserId, session.organisationId))) {
      return NextResponse.json({ error: 'Invalid linked user.' }, { status: 400 });
    }
    updates.linked_user_id = linkedUserId;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields provided.' }, { status: 400 });
  }

  // Actual-change detection — computed AFTER every validation/permission
  // check above has already run against the REQUESTED fields
  // (providedFields/wantsIdentityChange/wantsEmploymentChange/
  // wantsLinkChange), so an unauthorized caller cannot bypass a
  // permission gate merely by resubmitting a restricted field's current,
  // unchanged value — that request is still rejected before this point,
  // exactly as before. changedFields is used ONLY downstream, for audit
  // action-naming/payload construction and true-no-op detection — never
  // for authorization. `updates` (validated above) is compared directly
  // against `existing`'s real DB values, not against `providedFields`
  // (which only reflects request-body key presence — see this route's
  // history: the real PersonForm client always submits all 10 editable
  // fields on every save, so `providedFields` alone was never a reliable
  // signal for what actually changed).
  const changedFields = Object.keys(updates).filter(
    key => (existing as unknown as Record<string, unknown>)[key] !== (updates as Record<string, unknown>)[key],
  );

  // True no-op — every submitted, permitted value already matches the
  // existing row. Return success without writing anything: no SQL
  // UPDATE (so updated_at is never bumped for a request that changed
  // nothing), and no audit event (an unchanged-value resubmission is not
  // a real event worth auditing). Response shape matches the normal
  // success path exactly (`{ person: ... }`), just built from `existing`
  // instead of a fresh UPDATE ... RETURNING row.
  if (changedFields.length === 0) {
    return NextResponse.json({ person: projectPersonRow(ctx, target, existing) });
  }

  let rows;
  try {
    rows = await sql`
      UPDATE hr_people SET
        first_name         = COALESCE(${(updates.first_name as string) ?? null}, first_name),
        last_name          = COALESCE(${(updates.last_name as string) ?? null}, last_name),
        preferred_name     = CASE WHEN ${'preferred_name' in updates} THEN ${(updates.preferred_name as string | null) ?? null} ELSE preferred_name END,
        work_email         = CASE WHEN ${'work_email' in updates} THEN ${(updates.work_email as string | null) ?? null} ELSE work_email END,
        work_phone         = CASE WHEN ${'work_phone' in updates} THEN ${(updates.work_phone as string | null) ?? null} ELSE work_phone END,
        job_title          = CASE WHEN ${'job_title' in updates} THEN ${(updates.job_title as string | null) ?? null} ELSE job_title END,
        worker_type        = COALESCE(${(updates.worker_type as string) ?? null}, worker_type),
        employment_status  = COALESCE(${(updates.employment_status as string) ?? null}, employment_status),
        team_id            = CASE WHEN ${'team_id' in updates} THEN ${(updates.team_id as string | null) ?? null}::uuid ELSE team_id END,
        manager_person_id  = CASE WHEN ${'manager_person_id' in updates} THEN ${(updates.manager_person_id as string | null) ?? null}::uuid ELSE manager_person_id END,
        start_date         = CASE WHEN ${'start_date' in updates} THEN ${(updates.start_date as string | null) ?? null}::date ELSE start_date END,
        end_date           = CASE WHEN ${'end_date' in updates} THEN ${(updates.end_date as string | null) ?? null}::date ELSE end_date END,
        linked_user_id     = CASE WHEN ${'linked_user_id' in updates} THEN ${(updates.linked_user_id as string | null) ?? null} ELSE linked_user_id END,
        updated_at         = NOW()
      WHERE id = ${existing.id}::uuid AND organisation_id = ${session.organisationId}
      RETURNING *
    `;
  } catch (err) {
    // HR-2 Step 1D1 (corrective pass) — a race-time duplicate link. The
    // DB's own UNIQUE(organisation_id, linked_user_id) constraint is
    // the actual concurrency-safe source of truth here, not merely a
    // UX pre-check: two concurrent PATCHes could both pass
    // isUserInOrganisation() before either commits, so only the
    // database itself can correctly reject the second write. See
    // isLinkedUserUniqueViolation() in lib/hr/validation.ts for the
    // exact matching logic (shared with POST /api/hr/people, which
    // has the identical race). An unrelated 23505 (a different
    // constraint entirely) or any other error falls through to the
    // unchanged, generic 500 below, exactly as it always has.
    if (isLinkedUserUniqueViolation(err)) {
      return NextResponse.json(
        { error: 'That BrainBase account is already linked to another person.', code: 'linked_user_already_linked' },
        { status: 409 },
      );
    }
    console.error('[hr/people PATCH] update failed', err);
    return NextResponse.json({ error: 'Could not update person.' }, { status: 500 });
  }

  const updated = normalizePersonDates(rows[0] as HrPersonRow);
  const updatedTarget = { organisationId: updated.organisation_id, personId: updated.id, managerPersonId: updated.manager_person_id };

  {
    const { ipAddress, userAgent } = extractRequestMeta(req);
    const beforeState: Record<string, unknown> = {};
    const afterState: Record<string, unknown> = {};
    for (const key of changedFields) {
      beforeState[key] = (existing as unknown as Record<string, unknown>)[key];
      afterState[key] = (updated as unknown as Record<string, unknown>)[key];
    }
    // Action naming — one action per audit row, so a PATCH that touches
    // several field groups at once must pick the single most useful
    // label rather than default to the generic 'updated'. Precedence
    // (most to least specific): linked_user_id > employment_status >
    // everything else. linked_user_id wins outright regardless of what
    // else actually changed alongside it, since linking/unlinking is
    // always a deliberate, explicit HR-administrator action (see this
    // file's own header comment) worth surfacing on its own.
    // employment_status wins over ordinary identity/contact/other-
    // employment fields next, since it's the more operationally
    // significant change — a mixed PATCH (e.g. employment_status +
    // preferred_name, both ACTUALLY changed) is still fully captured in
    // beforeState/afterState either way; only the action LABEL changes,
    // so labeling it employment_status_changed doesn't hide the
    // identity-field change, it just names the row after its more
    // significant component.
    //
    // Uses changedFields (actual value differences), NOT providedFields/
    // wantsEmploymentChange (request-body key presence) — the real
    // PersonForm client always submits all 10 editable fields on every
    // save (see EDITABLE_FIELDS in app/people/_components/PersonForm.tsx),
    // so an unchanged employment_status value being merely PRESENT in
    // the body must never by itself select employment_status_changed,
    // and an unchanged job_title/worker_type/team_id/manager_person_id/
    // start_date/end_date value must never appear in the audit payload
    // just because it was resubmitted unedited alongside a real change
    // elsewhere.
    const action = changedFields.includes('linked_user_id')
      ? 'hr_person.linked_user_changed'
      : changedFields.includes('employment_status')
        ? 'hr_person.employment_status_changed'
        : 'hr_person.updated';

    await logHrEvent(
      { organisationId: session.organisationId, userId: session.userId, ipAddress, userAgent },
      { action, resourceType: 'hr_person', resourceId: updated.id, beforeState, afterState },
    );
  }

  return NextResponse.json({ person: projectPersonRow(ctx, updatedTarget, updated) });
}
