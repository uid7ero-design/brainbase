-- Apply to existing AP installations before deploying request-key aware code.
ALTER TABLE commercial_supplier_payments ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE commercial_supplier_payments ADD COLUMN IF NOT EXISTS request_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_payment_request_key
  ON commercial_supplier_payments(organisation_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
