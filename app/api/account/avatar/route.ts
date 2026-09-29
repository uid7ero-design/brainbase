import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/org';
import sql from '@/lib/db';
import { MAX_AVATAR_BYTES, isAllowedAvatarMimeType } from '@/lib/account/avatarConstants';
import { sniffAvatarMimeType, uploadUserAvatar, deleteUserAvatarIfManaged } from '@/lib/account/avatarStorage';

// POST — upload (or replace) the authenticated user's own profile
// avatar. multipart/form-data with a single "file" field.
//
// Durable Blob storage, replacing the previous local-filesystem
// implementation (public/avatars via fs writeFile) — Vercel's
// deployed/serverless filesystem is not durable across deploys or
// separate function instances, so a previously "saved" avatar could
// silently vanish. Modeled directly on
// app/api/organisations/branding/logo/route.ts's own proven ordering:
// validate -> upload new Blob -> write the DB link -> ONLY THEN delete
// the old managed avatar. If the DB write itself fails after a
// successful upload, the newly-uploaded (now orphaned) Blob object is
// cleaned up best-effort and a FAILURE response is returned — the
// previous route's fallback that could report success even when the
// DB write failed is removed entirely; this endpoint must never claim
// success when the database was not actually updated.
export async function POST(req: NextRequest) {
  // SEC-1B3: was raw getSession() — the JWT-only claim, never
  // revalidated against the DB. requireSession() (lib/org.ts) re-reads
  // the caller's current role/organisation/status from the database on
  // every call, so a since-deactivated, since-reassigned, or deleted
  // user's still-valid JWT can no longer upload an avatar under their
  // old identity. userId is sourced EXCLUSIVELY from this authoritative
  // session — never from a query param, form field, filename, or any
  // client-supplied JSON.
  let session;
  try { session = await requireSession(); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
  const { userId } = session;

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid upload.' }, { status: 400 });
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
  if (file.size === 0) return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
  if (file.size > MAX_AVATAR_BYTES) {
    return NextResponse.json({ error: `File too large — max ${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB.` }, { status: 400 });
  }
  if (!isAllowedAvatarMimeType(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed.' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Never trust the declared Content-Type (or filename/extension) alone
  // — inspect the actual bytes, and reject outright (not "silently
  // correct") a declared-vs-sniffed mismatch, matching organisation
  // logos' and event artwork's own identical discipline.
  const sniffed = sniffAvatarMimeType(buffer);
  if (!sniffed) {
    return NextResponse.json({ error: 'File content does not match an allowed image type.' }, { status: 400 });
  }
  if (sniffed !== file.type) {
    return NextResponse.json({ error: 'File content does not match its declared type.' }, { status: 400 });
  }

  // Read the CURRENT avatar first — needed to know what old (if any)
  // BrainBase-managed avatar to clean up afterward, once the new one is
  // safely linked.
  const [before] = await sql`SELECT avatar_url FROM users WHERE id = ${userId} LIMIT 1`;
  if (!before) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  const previousAvatarUrl = before.avatar_url as string | null;

  const uploadResult = await uploadUserAvatar(userId, buffer, sniffed);
  if (!uploadResult.ok) {
    console.error('[account avatar] upload failed', uploadResult.error);
    return NextResponse.json({ error: 'Upload failed. Please try again.' }, { status: 502 });
  }

  // The new object is durably stored BEFORE avatar_url is touched — a
  // DB failure past this point leaves the PREVIOUS avatar fully intact;
  // only the new (as-yet-unreferenced) upload becomes an orphan, which
  // is exactly what the cleanup below removes. Never report success if
  // this write does not actually happen.
  try {
    await sql`UPDATE users SET avatar_url = ${uploadResult.url}, updated_at = NOW() WHERE id = ${userId}`;
  } catch (err) {
    console.error('[account avatar] DB link failed after a successful upload — cleaning up the orphaned object', uploadResult.url, err);
    await deleteUserAvatarIfManaged(uploadResult.url, userId);
    return NextResponse.json({ error: 'Upload succeeded but could not be saved. Please try again.' }, { status: 500 });
  }

  // Only now — after the new avatar is safely stored AND avatar_url
  // points at it — remove whatever it replaced, and only if that was
  // itself a BrainBase-managed object (never a third-party URL this app
  // never owned).
  if (previousAvatarUrl && previousAvatarUrl !== uploadResult.url) {
    await deleteUserAvatarIfManaged(previousAvatarUrl, userId);
  }

  return NextResponse.json({ success: true, avatarUrl: uploadResult.url });
}
