-- Events & Ticketing — Eve launch compliance: EVENT_UPDATED lifecycle
-- notification (material date, time or venue change).
-- Run once, manually, against the target database, AFTER
-- scripts/create-events-notifications.sql (it only touches event_notifications).
-- NOT run automatically. NOT applied to Production by the phase that adds it:
-- the Production migration is a separate, explicitly approved gate, and is
-- applied BEFORE the application code that schedules EVENT_UPDATED is deployed.
--
-- ── What this adds, and why ─────────────────────────────────────────────
--
-- 1. 'EVENT_UPDATED' joins the notification-type vocabulary (the existing
--    four are unchanged): ORDER_CANCELLED, ORDER_REFUNDED, EVENT_CANCELLED,
--    EVENT_REMINDER, EVENT_UPDATED.
-- 2. payload JSONB NULL, a JSON OBJECT or NULL. For EVENT_UPDATED it holds ONLY
--    the buyer-safe material-change snapshot the email needs:
--      { "before": {starts_at, ends_at, venue},
--        "after":  {starts_at, ends_at, venue},
--        "change_version": "<committed event version>" }
--    Never purchaser data, tokens, secrets or internal configuration. Every
--    existing row keeps payload NULL.
--
-- Idempotency is unchanged in mechanism: the UNIQUE idempotency_key. For
-- EVENT_UPDATED the key is
--   event-notification:EVENT_UPDATED:<order_id>:<committed event version>
-- where the version is the events row's own updated_at (microseconds) written
-- by the very UPDATE that made the change. A replay of the same committed
-- change is a no-op; a later distinct change — including reverting to an
-- earlier date, time or venue — has a new version and so a new notification.
--
-- Table-scoped and idempotent: the old type CHECK is replaced only when its
-- definition does not already list EVENT_UPDATED; the replacement is added
-- NOT VALID then VALIDATEd (existing rows all use the four old values).
-- Re-running changes nothing.
--
-- ── Rollback (manual) ───────────────────────────────────────────────────
--   DELETE FROM event_notifications WHERE notification_type = 'EVENT_UPDATED';
--   ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_type_check;
--   ALTER TABLE event_notifications ADD CONSTRAINT event_notifications_type_check
--     CHECK (notification_type IN ('ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER'));
--   ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_payload_object_check;
--   ALTER TABLE event_notifications DROP COLUMN IF EXISTS payload;
-- Roll the application back first. Deleting EVENT_UPDATED rows discards only
-- the delivery records of those notices.

ALTER TABLE event_notifications
  ADD COLUMN IF NOT EXISTS payload JSONB NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_notifications_payload_object_check'
      AND conrelid = 'event_notifications'::regclass
  ) THEN
    ALTER TABLE event_notifications
      ADD CONSTRAINT event_notifications_payload_object_check
      CHECK (payload IS NULL OR jsonb_typeof(payload) = 'object') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'event_notifications_type_check'
      AND conrelid = 'event_notifications'::regclass
      AND pg_get_constraintdef(oid) LIKE '%EVENT_UPDATED%'
  ) THEN
    ALTER TABLE event_notifications DROP CONSTRAINT IF EXISTS event_notifications_type_check;
    ALTER TABLE event_notifications
      ADD CONSTRAINT event_notifications_type_check
      CHECK (notification_type IN ('ORDER_CANCELLED', 'ORDER_REFUNDED', 'EVENT_CANCELLED', 'EVENT_REMINDER', 'EVENT_UPDATED')) NOT VALID;
  END IF;
END $$;

ALTER TABLE event_notifications VALIDATE CONSTRAINT event_notifications_payload_object_check;
ALTER TABLE event_notifications VALIDATE CONSTRAINT event_notifications_type_check;
