-- Phase C7.5C — widen Supplier Bill line quantity from INTEGER to
-- NUMERIC(14,4). Existing integer values cast losslessly to x.0000.
--
-- Production rollout note: ALTER COLUMN TYPE can take a table lock.
-- Inspect live row count/table size/activity before applying.
--
-- Rollback: once any fractional quantity exists, do NOT cast back to
-- INTEGER. Application rollback should leave the widened column in place.

DO $do$
DECLARE
  current_type text;
  current_precision integer;
  current_scale integer;
BEGIN
  SELECT data_type, numeric_precision, numeric_scale
    INTO current_type, current_precision, current_scale
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'commercial_supplier_bill_lines'
    AND column_name = 'quantity';

  IF current_type IS NULL THEN
    RAISE EXCEPTION 'commercial_supplier_bill_lines.quantity does not exist';
  END IF;

  IF current_type = 'integer' THEN
    ALTER TABLE commercial_supplier_bill_lines
      ALTER COLUMN quantity TYPE NUMERIC(14,4)
      USING quantity::NUMERIC(14,4);
  ELSIF current_type = 'numeric'
    AND current_precision = 14
    AND current_scale = 4 THEN
    NULL; -- already migrated
  ELSE
    RAISE EXCEPTION
      'Unexpected commercial_supplier_bill_lines.quantity type: %, precision %, scale %',
      current_type, current_precision, current_scale;
  END IF;
END
$do$;

-- Pre-rollback guard (read-only): rollback to INTEGER is safe only if
-- this returns zero.
-- SELECT COUNT(*) AS fractional_quantity_rows
-- FROM commercial_supplier_bill_lines
-- WHERE quantity <> trunc(quantity);
