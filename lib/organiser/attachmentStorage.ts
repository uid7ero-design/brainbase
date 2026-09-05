import 'server-only';
import { randomUUID } from 'crypto';
import { put, del } from '@vercel/blob';

// Organiser item-file attachment storage — Vercel Blob.
//
// Mirrors the platform's existing convention in lib/events/blobStorage.ts
// (same put()/del() shape, same hostname-based managed-URL check). This is
// NOT a new storage pattern for BrainBase — see that module's own header
// comment and docs/architecture/decisions/0001-data-hub-ingestion-foundation.md
// §9 for the platform-wide "Vercel Blob is the selected direction" context.
//
// access: 'public' (not the ADR's 'private' default) is a deliberate,
// scope-limited choice for this hotfix: the existing Organiser UI
// (app/organiser/page.tsx) renders file_url as a plain <a href> the browser
// fetches directly, with no server-side proxy/signed-access layer anywhere
// in the Organiser file routes. Building that proxy would be a genuine
// attachment-security redesign, out of scope for this fix. Consequently,
// protection against an unauthenticated fetch of an attachment currently
// rests on the generated pathname's UUID segment being unguessable, not on
// session/tenant authorization — a real, intentional narrowing of Organiser's
// otherwise strictly tenant-gated reads, worth revisiting in a future phase.

export function isManagedOrganiserAttachmentUrl(url: string): boolean {
  try {
    return new URL(url).hostname.endsWith('.public.blob.vercel-storage.com');
  } catch {
    return false;
  }
}

export type UploadOrganiserAttachmentResult =
  | { ok: true; url: string }
  | { ok: false; error: string };

// Never used as part of the storage key/pathname trust boundary — only as a
// short human-readable suffix. The pathname's actual uniqueness/opacity comes
// from the randomUUID() segment, never from this sanitized fragment.
function sanitiseFilenameSegment(name: string): string {
  // put()'s pathname is an opaque object key, not resolved through a real
  // filesystem, so a literal ".." segment carries no traversal risk to the
  // Blob API itself — this still collapses repeated dots defensively, since
  // the resulting pathname is also stored as the visible tail of a public
  // URL (see the "access: 'public'" note at the top of this file).
  const cleaned = name.replace(/[^\w.\- ]/g, '_').replace(/\.{2,}/g, '_').trim();
  return (cleaned || 'file').slice(0, 150);
}

export async function uploadOrganiserAttachment(
  organisationId: string,
  itemId: string,
  buffer: Buffer,
  originalFileName: string,
  contentType?: string,
): Promise<UploadOrganiserAttachmentResult> {
  const pathname = `organiser-attachments/${organisationId}/${itemId}/${randomUUID()}-${sanitiseFilenameSegment(originalFileName)}`;
  try {
    const blob = await put(pathname, buffer, {
      access: 'public',
      contentType,
      addRandomSuffix: false, // the uuid segment already guarantees uniqueness
    });
    return { ok: true, url: blob.url };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Upload failed.' };
  }
}

// Deletes a Blob object only if it is actually BrainBase-managed (see
// isManagedOrganiserAttachmentUrl) — never attempts to delete a third-party
// or legacy local-path URL (e.g. a pre-hotfix "/organiser-attachments/..."
// value, if one ever existed). Failures are caught and logged, never thrown:
// callers use this both as post-delete best-effort disk cleanup (DB row is
// already gone) and as upload-failure compensation (DB insert never
// happened) — in neither case should a Blob cleanup failure change the
// caller's own response.
export async function deleteOrganiserAttachmentIfManaged(url: string): Promise<void> {
  if (!isManagedOrganiserAttachmentUrl(url)) return;
  try {
    await del(url);
  } catch (err) {
    console.error('[organiser attachments] failed to delete Blob object (ignored)', err);
  }
}
