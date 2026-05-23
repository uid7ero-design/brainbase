-- Run once against the production database

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS is_recurring boolean DEFAULT false NOT NULL;
