import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { forbidden, requireSession, unauthorized } from '@/lib/org';
import { CapabilityDatabaseError } from '@/lib/capabilities/requireCapability';
import { requireHrCapability } from '@/lib/hr/capability';
import { logRestrictedHrReadEvent } from '@/lib/hr/auditLog';
import { extractRequestMeta } from '@/lib/hr/requestMeta';
import { restrictedActorFromSession } from '@/lib/hr/restrictedAccess';
import { requireRestrictedCase } from '@/lib/hr/restrictedRoute';
import { createRestrictedCaseNote } from '@/lib/hr/restrictedCaseContentMutations';

const CREATE_FIELDS = new Set(['body']);

type NoteRow = {
  id: string;
  case_id: string;
  author_id: string;
  body: string;
  created_at: Date | string;
};

async function entrySession() {
  let session;
  try {
    session = await requireSession();
  } catch {
    return { ok: false as const, response: unauthorized() };
  }
  try {
    await requireHrCapability(session.organisationId, session.role);
  } catch (err) {
    if (err instanceof CapabilityDatabaseError) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: 'Unable to verify People access.' }, { status: 503 }),
      };
    }
    return { ok: false as const, response: forbidden() };
  }
  return { ok: true as const, session };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;

  const rows = await sql`
    SELECT id, case_id, author_id, body, created_at
    FROM hr_restricted_case_notes
    WHERE organisation_id = ${entry.session.organisationId}
      AND case_id = ${caseId}::uuid
    ORDER BY created_at ASC, id ASC
  ` as NoteRow[];

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    await Promise.all(rows.map(row => logRestrictedHrReadEvent(
      { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      {
        action: 'hr_restricted_case_note.read',
        resourceType: 'hr_restricted_case_note',
        resourceId: row.id,
        afterState: { case_id: row.case_id, author_id: row.author_id, body: row.body },
      },
    )));
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/notes GET] read audit failed', err);
    return NextResponse.json({ error: 'Unable to record restricted HR access.' }, { status: 503 });
  }

  return NextResponse.json({
    notes: rows.map(row => ({ id: row.id, author_id: row.author_id, body: row.body, created_at: row.created_at })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: caseId } = await params;
  const entry = await entrySession();
  if (!entry.ok) return entry.response;

  const access = await requireRestrictedCase(entry.session, caseId);
  if (!access.ok) return access.response;

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const unknownField = Object.keys(body).find(key => !CREATE_FIELDS.has(key));
  if (unknownField) {
    return NextResponse.json({ error: `Unknown or unsupported field: ${unknownField}` }, { status: 400 });
  }
  const noteBody = typeof body.body === 'string' ? body.body.trim() : '';
  if (!noteBody) return NextResponse.json({ error: 'body is required.' }, { status: 400 });

  const actor = restrictedActorFromSession(entry.session);
  const { ipAddress, userAgent } = extractRequestMeta(req);
  try {
    const created = await createRestrictedCaseNote({
      actor: { organisationId: actor.organisationId, userId: actor.userId, ipAddress, userAgent },
      caseId,
      body: noteBody,
    });
    return NextResponse.json({
      note: {
        id: created.noteId,
        author_id: actor.userId,
        body: noteBody,
        created_at: created.createdAt,
      },
    }, { status: 201 });
  } catch (err) {
    console.error('[hr/restricted-cases/[id]/notes POST] mutation failed', err);
    return NextResponse.json({ error: 'Could not create restricted HR note.' }, { status: 500 });
  }
}
