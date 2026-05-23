-- Add price_per_session to sessions table
-- Run once against the production database

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS price_per_session numeric DEFAULT 0 NOT NULL;

UPDATE sessions SET price_per_session = 0 WHERE price_per_session IS NULL;

-- Backfill from existing session_type mapping
UPDATE sessions SET price_per_session = CASE session_type
  WHEN 'PRIVATE_60'        THEN 70
  WHEN 'PRIVATE_30'        THEN 35
  WHEN 'SEMI_PRIVATE'      THEN 50
  WHEN 'GROUP_TERM_JUNIOR' THEN 20
  WHEN 'MATCHPLAY'         THEN 20
  WHEN 'GROUP_TERM_ADULT'  THEN 20
  WHEN 'CARDIO_SESSION'    THEN 15
  WHEN 'CARDIO_TERM'       THEN 15
  WHEN 'CLINIC'            THEN 25
  WHEN 'ASSESSMENT'        THEN 0
  WHEN 'PRIVATE'           THEN 55
  WHEN 'GROUP'             THEN 20
  WHEN 'GROUP_CASUAL'      THEN 20
  WHEN 'ACADEMY'           THEN 25
  ELSE 0
END
WHERE price_per_session = 0;
