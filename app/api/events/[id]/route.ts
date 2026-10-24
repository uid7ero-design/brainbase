import { NextRequest, NextResponse } from 'next/server';
import sql from '@/lib/db';
import { authorizeEventsRequest } from '@/lib/events/authorize';
import { validateEventInput, toIsoString, mergeField, type EventInput } from '@/lib/events/validation';
import { getOrganisationEvent } from '@/lib/events/organiserReads';
import { logEventUpdated, logEventPublished, logEventUnpublished, logEventCancelled } from '@/lib/events/auditLog';
import {
  scheduleEventCancelledNotifications, EVENT_CANCELLED_INLINE_SEND_LIMIT,
  scheduleEventUpdatedNotifications, EVENT_UPDATED_INLINE_SEND_LIMIT,
} from '@/lib/events/notifications';
import { attemptNotificationDelivery } from '@/lib/events/notificationDelivery';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('viewer');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const detail = await getOrganisationEvent(session.organisationId, id);
  if (!detail) return NextResponse.json({ error: 'Not found.' }, { status: 404 });

  return NextResponse.json(detail);
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const auth = await authorizeEventsRequest('manager');
  if (!auth.ok) return auth.response;
  const { session } = auth;
  const { id } = await params;

  const existingRows = await sql`
    SELECT * FROM events WHERE id = ${id} AND organisation_id = ${session.organisationId} LIMIT 1
  `;
  if (!existingRows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
  const existing = existingRows[0];

  let body: Partial<EventInput>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body.' }, { status: 400 });
  }

  // Validate the merged (existing + patch) shape — a partial PATCH must
  // never be able to leave the row in a state a POST couldn't have
  // created (e.g. ends_at before starts_at via a one-field patch).
  //
  // Merged by property presence (mergeField), not `??` — an omitted key
  // preserves the existing value, but an explicit `null` for an optional
  // field (description/venue) must actually clear it rather than being
  // silently discarded. A `null` sent for a required field (name/slug/
  // timezone/status/starts_at/ends_at) is not specially rejected here;
  // it flows into validateEventInput() below, which already rejects it.
  const merged: EventInput = {
    name: mergeField(body, 'name', existing.name),
    slug: mergeField(body, 'slug', existing.slug),
    description: mergeField(body, 'description', existing.description),
    venue: mergeField(body, 'venue', existing.venue),
    artwork_url: mergeField(body, 'artwork_url', existing.artwork_url),
    status: mergeField(body, 'status', existing.status),
    starts_at: mergeField(body, 'starts_at', toIsoString(existing.starts_at)),
    ends_at: mergeField(body, 'ends_at', toIsoString(existing.ends_at)),
    timezone: mergeField(body, 'timezone', existing.timezone),
    reminder_enabled: mergeField(body, 'reminder_enabled', existing.reminder_enabled === true),
  };
  const error = validateEventInput(merged);
  if (error) return NextResponse.json({ error }, { status: 400 });
  // Phase 5B — never anything but a real boolean reaches the column.
  const reminderEnabled = merged.reminder_enabled === true;

  try {
    // One statement: the pre-update material values are read under a row lock
    // (FOR UPDATE) and the row is updated against that SAME locked read, so the
    // before/after pair is exact even under concurrent edits (they serialise on
    // the lock). updated_at is the committed change version: strictly greater
    // than the previous one (GREATEST with prev + 1 microsecond) so two edits
    // can never share a version, and exposed as epoch microseconds.
    const rows = await sql`
      WITH prev AS (
        SELECT id, starts_at, ends_at, venue, status, updated_at
        FROM events
        WHERE id = ${id} AND organisation_id = ${session.organisationId}
        FOR UPDATE
      )
      UPDATE events e SET
        name = ${merged.name as string}, slug = ${merged.slug as string},
        description = ${(merged.description as string | null) ?? null},
        venue = ${(merged.venue as string | null) ?? null},
        artwork_url = ${(merged.artwork_url as string | null) || null},
        status = ${merged.status as string},
        starts_at = ${merged.starts_at as string}, ends_at = ${merged.ends_at as string},
        timezone = ${merged.timezone as string}, reminder_enabled = ${reminderEnabled},
        -- Registration-answer retention (ADR 0013 §4b): when the event was
        -- cancelled. Set on the transition into CANCELLED, cleared if it
        -- leaves CANCELLED, otherwise kept.
        cancelled_at = CASE
          WHEN ${merged.status as string} = 'CANCELLED' AND prev.status <> 'CANCELLED' THEN clock_timestamp()
          WHEN ${merged.status as string} <> 'CANCELLED' THEN NULL
          ELSE e.cancelled_at
        END,
        updated_at = GREATEST(clock_timestamp(), prev.updated_at + interval '1 microsecond')
      FROM prev
      WHERE e.id = prev.id AND e.organisation_id = ${session.organisationId}
      RETURNING e.*,
        prev.starts_at AS __prev_starts_at, prev.ends_at AS __prev_ends_at, prev.venue AS __prev_venue, prev.status AS __prev_status,
        floor(extract(epoch FROM e.updated_at) * 1000000)::bigint::text AS __change_version,
        e.updated_at::text AS __changed_at
    `;
    if (!rows.length) return NextResponse.json({ error: 'Not found.' }, { status: 404 });
    const { __prev_starts_at, __prev_ends_at, __prev_venue, __prev_status, __change_version, __changed_at, ...updated } = rows[0] as Record<string, unknown>;

    // Phase 8 — publish/unpublish must be clearly distinguishable from
    // an ordinary edit (task's own explicit requirement), so the status
    // transition is classified here, at the route, before choosing which
    // logger to call — the logger functions themselves stay dumb/generic.
    // "Unpublish" is deliberately narrow — PUBLISHED -> DRAFT only,
    // matching the real-world "Unpublish" action (revert to an editable
    // draft that could be republished later). PUBLISHED -> CANCELLED is
    // a different, more final lifecycle transition (see event_orders'
    // own CANCELLED handling elsewhere in this module) and is NOT
    // relabelled as "unpublished" — it still falls through to the
    // ordinary event.updated path below, alongside every other field
    // edit, correctly carrying the status change in its own diff.
    const becamePublished = existing.status !== updated.status && updated.status === 'PUBLISHED';
    const leftPublished = existing.status === 'PUBLISHED' && updated.status === 'DRAFT';
    // Phase 5B — any non-cancelled -> CANCELLED transition (from DRAFT or
    // PUBLISHED) is the event-cancellation lifecycle action: audited as
    // event.cancelled and the trigger for purchaser communications below.
    // A PATCH that leaves an already-CANCELLED event CANCELLED is an
    // ordinary edit — it schedules nothing (and the UNIQUE idempotency key
    // would make it a no-op even if it did).
    const becameCancelled = existing.status !== 'CANCELLED' && updated.status === 'CANCELLED';
    const auditParams = { organisationId: session.organisationId, userId: session.userId, eventId: id, before: existing as never, after: updated as never };
    if (becamePublished) await logEventPublished(auditParams);
    else if (leftPublished) await logEventUnpublished(auditParams);
    else if (becameCancelled) await logEventCancelled(auditParams);
    else await logEventUpdated(auditParams);

    // Phase 5B — event cancellation communications. What cancelling an
    // event does to ORDERS is unchanged by this phase: nothing. Order and
    // payment rows keep their state (tickets already resolve as
    // EVENT_CANCELLED via lib/events/ticketValidity.ts), and no refund is
    // issued automatically — each paid order is still refunded one by one
    // through the refund route. The EVENT_CANCELLED email therefore tells
    // each purchaser the TRUE refund state of their order at send time.
    // Scheduling is one idempotent statement (see
    // scheduleEventCancelledNotifications); a bounded number of the rows
    // it scheduled are sent inline, the rest by the hourly recovery run.
    // Best-effort after the event UPDATE has committed: an email problem
    // can never fail or roll back the cancellation itself.
    let notificationsScheduled: number | undefined;
    if (becameCancelled) {
      try {
        const scheduledIds = await scheduleEventCancelledNotifications({
          organisationId: session.organisationId, eventId: id, actorUserId: session.userId,
        });
        notificationsScheduled = scheduledIds.length;
        for (const notificationId of scheduledIds.slice(0, EVENT_CANCELLED_INLINE_SEND_LIMIT)) {
          await attemptNotificationDelivery(notificationId);
        }
      } catch (err) {
        console.error('[events] event-cancelled notifications failed after the event was cancelled', err, { eventId: id });
      }
    }

    // Material event-change notice (date, time or venue). Compared as instants
    // and trimmed venue text, so a description/artwork/branding/name/reminder
    // edit — or a same-value PATCH — is NOT material. Only a PUBLISHED event
    // that stays PUBLISHED notifies (cancelling has its own notice; publishing
    // from draft is not a change to something buyers were told). The version
    // keying the idempotency is the committed change version above.
    if (__prev_status === 'PUBLISHED' && updated.status === 'PUBLISHED') {
      const beforeSnap = { starts_at: toIsoString(__prev_starts_at as never), ends_at: toIsoString(__prev_ends_at as never), venue: ((__prev_venue as string | null) ?? '').trim() || null };
      const afterSnap = { starts_at: toIsoString(updated.starts_at as never), ends_at: toIsoString(updated.ends_at as never), venue: ((updated.venue as string | null) ?? '').trim() || null };
      const material = beforeSnap.starts_at !== afterSnap.starts_at || beforeSnap.ends_at !== afterSnap.ends_at || beforeSnap.venue !== afterSnap.venue;
      if (material) {
        try {
          const scheduledIds = await scheduleEventUpdatedNotifications({
            organisationId: session.organisationId, eventId: id, actorUserId: session.userId,
            payload: { before: beforeSnap, after: afterSnap, change_version: String(__change_version) },
            changedAt: String(__changed_at),
          });
          notificationsScheduled = scheduledIds.length;
          for (const notificationId of scheduledIds.slice(0, EVENT_UPDATED_INLINE_SEND_LIMIT)) {
            await attemptNotificationDelivery(notificationId);
          }
        } catch (err) {
          console.error('[events] event-updated notifications failed after the event was updated', err, { eventId: id });
        }
      }
    }

    return NextResponse.json(notificationsScheduled === undefined ? { event: updated } : { event: updated, notifications_scheduled: notificationsScheduled });
  } catch (err) {
    if (err instanceof Error && /organisation_id_slug_key/i.test(err.message)) {
      return NextResponse.json({ error: 'An event with this slug already exists.' }, { status: 409 });
    }
    throw err;
  }
}
