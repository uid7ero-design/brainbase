CREATE TABLE IF NOT EXISTS tennis_receipt_expenses (
  organisation_id text NOT NULL REFERENCES organisations(id),
  id uuid NOT NULL,
  recorded_by text NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  purchase_date date NOT NULL,
  merchant text NOT NULL CHECK (length(trim(merchant)) BETWEEN 1 AND 160),
  description text NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 300),
  receipt_reference text CHECK (length(trim(receipt_reference)) BETWEEN 1 AND 100),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'AUD' CHECK (currency = 'AUD'),
  PRIMARY KEY (organisation_id, id)
);
CREATE INDEX IF NOT EXISTS tennis_receipt_expenses_by_date
  ON tennis_receipt_expenses (organisation_id, purchase_date DESC, recorded_at DESC);
