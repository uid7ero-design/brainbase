import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { MAX_ARTWORK_BYTES, isAllowedArtworkMimeType } from '@/lib/events/artworkConstants';
import { sniffImageMimeType, uploadEventArtwork, deleteEventArtworkIfManaged } from '@/lib/events/blobStorage';

type Ctx = { params: Promise<{ id: string }> };

// See app/api/events/[id]/sessions/route.ts's loadOwnedEvent for why
// this check exists on every child-resource route — never trusts a
// client-supplied organisation id, always the caller's own session.
async function loadOwnedEvent(eventId: string, organisationId: string) {
  const rows = await sql`
    SELECT id, artwork_url FROM events WHERE id = ${eventId} AND organisation_id = ${organisationId} LIMIT 1
  `;
  return rows[0] as { id: string; artwork_url: string | null } | undefined;
}

// POST — upload (or replace) this event's artwork. manager+ only (same
// gate as every other Events mutation). multipart/form-data with a
// single "file" field.
export async function POST(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_ARTWORK_BYTES) {
    return NextResponse.json({ error: `File too large — max ${Math.round(MAX_ARTWORK_BYTES / (1024 * 1024))}MB.` }, { status: 400 });
  }
  if (!isAllowedArtworkMimeType(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Never trust the declared Content-Type (or filename/extension) alone
  // — inspect the actual bytes. The sniffed type is what actually gets
  // stored/served; a mismatch between what the client claimed and what
  // the bytes really are is rejected outright rather than silently
  // "corrected", since that mismatch itself is a signal something is
  // wrong with the request.
  const sniffed = sniffImageMimeType(buffer);
  if (!sniffed) {
    return NextResponse.json({ error: 'File content does not match an allowed image type.' }, { status: 400 });
  }
  if (sniffed !== file.type) {
    return NextResponse.json({ error: 'File content does not match its declared type.' }, { status: 400 });
  }

  const uploadResult = await uploadEventArtwork(session.organisationId, id, buffer, sniffed);
  if (!uploadResult.ok) {
    console.error('[events artwork] upload failed', uploadResult.error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 502 });
  }

  // The new object is now durably stored BEFORE the Event record is
  // touched — a failure past this point leaves any PREVIOUS artwork
  // fully intact (the new upload becomes an orphan object rather than
  // the event losing its artwork or being left pointing at nothing).
  let updatedRows: { artwork_url: string | null }[];
  try {
    updatedRows = await sql`
      UPDATE events SET artwork_url = ${uploadResult.url}, updated_at = now()
      WHERE id = ${id} AND organisation_id = ${session.organisationId}
      RETURNING artwork_url
    ` as { artwork_url: string | null }[];
  } catch (err) {
    console.error(
      '[events artwork] event update failed after a successful upload — orphaned object left in Blob storage:',
      uploadResult.url, err,
    );
    return NextResponse.json({ error: 'Upload succeeded but could not be saved. Please try again.' }, { status: 500 });
  }
  if (!updatedRows.length) {
    // Event vanished between the ownership check and this UPDATE (e.g.
    // deleted concurrently) — same orphan situation as above; nothing
    // left to link the new upload to.
    console.error('[events artwork] event disappeared before the update could apply — orphaned object left in Blob storage:', uploadResult.url);
    return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  }

  // Only now — after the new artwork is safely stored AND the Event
  // record points at it — remove whatever it replaced, and only if
  // that was itself a BrainBase-managed object (never an arbitrary
  // external URL pasted under the prior interim architecture).
  if (event.artwork_url && event.artwork_url !== uploadResult.url) {
    await deleteEventArtworkIfManaged(event.artwork_url);
  }

  return NextResponse.json({ artwork_url: updatedRows[0].artwork_url }, { status: 200 });
}

// DELETE — clear this event's artwork. manager+ only. Clears
// events.artwork_url unconditionally, then best-effort deletes the
// underlying Blob object ONLY if it was BrainBase-managed — an
// externally-pasted URL from the prior interim architecture is simply
// forgotten, never "deleted" (this app never owned that content).
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const event = await loadOwnedEvent(id, session.organisationId);
  if (!event) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  if (!event.artwork_url) {
    return NextResponse.json({ artwork_url: null }, { status: 200 });
  }

  await sql`
    UPDATE events SET artwork_url = NULL, updated_at = now()
    WHERE id = ${id} AND organisation_id = ${session.organisationId}
  `;

  // Clear the DB reference first, delete the object second — never the
  // reverse, so a delete failure can never leave the Event pointing at
  // a now-gone object.
  await deleteEventArtworkIfManaged(event.artwork_url);

  return NextResponse.json({ artwork_url: null }, { status: 200 });
}
