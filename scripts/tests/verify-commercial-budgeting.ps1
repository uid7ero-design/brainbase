$ErrorActionPreference = 'Stop'

$repo = (git rev-parse --show-toplevel).Trim()
$migration = Join-Path $repo 'scripts\create-commercial-budgeting.sql'
$container = "brainbase-c77b-budgeting-$PID"
$port = 55439
$pass = 0
$fail = 0
$failures = @()

function Invoke-PsqlText([string]$Sql) {
  $Sql | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d testdb
  if ($LASTEXITCODE -ne 0) { throw "psql failed with exit $LASTEXITCODE" }
}
function Mark([string]$Name, [scriptblock]$Action) {
  try {
    & $Action
    Write-Host "  PASS: $Name"
    $script:pass++
  } catch {
    Write-Host "  FAIL: $Name -- $($_.Exception.Message)"
    $script:fail++
    $script:failures += $Name
  }
}

try {
  Write-Host '=== C7.7B disposable PostgreSQL Budgeting validation ==='
  docker run --name $container -e POSTGRES_PASSWORD=test -e POSTGRES_DB=testdb -p ($port.ToString() + ':5432') -d postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'docker run failed' }

  $ready = $false
  for ($i=0; $i -lt 30; $i++) {
    docker exec $container pg_isready -U postgres -d testdb *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'disposable PostgreSQL did not become ready' }

  Mark 'prerequisite schema' {
    Invoke-PsqlText @'
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organisations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE users (id TEXT PRIMARY KEY, organisation_id TEXT REFERENCES organisations(id));
CREATE TABLE commercial_financial_years (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  UNIQUE (id, organisation_id)
);
CREATE TABLE commercial_financial_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_id UUID NOT NULL,
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  name TEXT NOT NULL,
  starts_on DATE NOT NULL,
  ends_on DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  UNIQUE (id, organisation_id),
  FOREIGN KEY (financial_year_id, organisation_id)
    REFERENCES commercial_financial_years(id, organisation_id)
);
CREATE TABLE commercial_cost_centres (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id TEXT NOT NULL REFERENCES organisations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL
);
INSERT INTO organisations(id,name) VALUES ('org-a','Org A'),('org-b','Org B');
INSERT INTO users(id,organisation_id) VALUES ('user-a','org-a'),('user-b','org-b');
'@
  }

  Mark 'fresh migration apply' {
    Get-Content $migration -Raw | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d testdb
    if ($LASTEXITCODE -ne 0) { throw "fresh migration exit $LASTEXITCODE" }
  }

  Mark 'idempotent second apply' {
    Get-Content $migration -Raw | docker exec -i $container psql -v ON_ERROR_STOP=1 -U postgres -d testdb
    if ($LASTEXITCODE -ne 0) { throw "second migration exit $LASTEXITCODE" }
  }

  Mark 'fixtures' {
    Invoke-PsqlText @'
INSERT INTO commercial_financial_years(organisation_id,name,starts_on,ends_on,status)
VALUES
 ('org-a','FY A','2026-07-01','2027-06-30','OPEN'),
 ('org-b','FY B','2026-07-01','2027-06-30','OPEN');

INSERT INTO commercial_financial_periods(financial_year_id,organisation_id,name,starts_on,ends_on,status)
SELECT id,organisation_id,'P1','2026-07-01','2026-07-31','OPEN'
FROM commercial_financial_years;

INSERT INTO commercial_cost_centres(organisation_id,code,name)
VALUES ('org-a','CCA','Cost Centre A'),('org-b','CCB','Cost Centre B');

INSERT INTO commercial_budget_accounts(organisation_id,code,name,created_by)
VALUES ('org-a','ACC-A','Account A','user-a'),('org-b','ACC-B','Account B','user-b');

INSERT INTO commercial_budgets(organisation_id,financial_year_id,name,currency,tax_basis,periodisation_mode,created_by)
SELECT organisation_id,id,'Budget '||organisation_id,'AUD','INCLUSIVE','PERIODISED',
       CASE WHEN organisation_id='org-a' THEN 'user-a' ELSE 'user-b' END
FROM commercial_financial_years;

INSERT INTO commercial_budget_versions(organisation_id,budget_id,version_number,status,created_by)
SELECT organisation_id,id,1,'DRAFT',
       CASE WHEN organisation_id='org-a' THEN 'user-a' ELSE 'user-b' END
FROM commercial_budgets;
'@
  }

  Mark 'cross-tenant Budget line rejected' {
    Invoke-PsqlText @'
DO $$
DECLARE
  v_version_a uuid;
  v_account_b uuid;
  v_cc_a uuid;
BEGIN
  SELECT id INTO v_version_a FROM commercial_budget_versions WHERE organisation_id='org-a' LIMIT 1;
  SELECT id INTO v_account_b FROM commercial_budget_accounts WHERE organisation_id='org-b' LIMIT 1;
  SELECT id INTO v_cc_a FROM commercial_cost_centres WHERE organisation_id='org-a' LIMIT 1;

  BEGIN
    INSERT INTO commercial_budget_lines(
      organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents
    ) VALUES ('org-a',v_version_a,v_account_b,v_cc_a,10000);
    RAISE EXCEPTION 'cross-tenant account FK unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;
'@
  }

  Mark 'cross-tenant mapping rejected' {
    Invoke-PsqlText @'
DO $$
DECLARE
  v_version_a uuid;
  v_account_a uuid;
  v_cc_b uuid;
BEGIN
  SELECT id INTO v_version_a FROM commercial_budget_versions WHERE organisation_id='org-a' LIMIT 1;
  SELECT id INTO v_account_a FROM commercial_budget_accounts WHERE organisation_id='org-a' LIMIT 1;
  SELECT id INTO v_cc_b FROM commercial_cost_centres WHERE organisation_id='org-b' LIMIT 1;

  BEGIN
    INSERT INTO commercial_budget_commitment_mappings(
      organisation_id,budget_version_id,cost_centre_id,budget_account_id,created_by
    ) VALUES ('org-a',v_version_a,v_cc_b,v_account_a,'user-a');
    RAISE EXCEPTION 'cross-tenant mapping unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;
'@
  }

  Mark 'second ACTIVE version rejected' {
    Invoke-PsqlText @'
DO $$
DECLARE
  v_budget uuid;
BEGIN
  SELECT id INTO v_budget FROM commercial_budgets WHERE organisation_id='org-a';

  UPDATE commercial_budget_versions
  SET status='ACTIVE', activated_at=now()
  WHERE budget_id=v_budget AND version_number=1;

  INSERT INTO commercial_budget_versions(
    organisation_id,budget_id,version_number,status,created_by
  ) VALUES ('org-a',v_budget,2,'DRAFT','user-a');

  BEGIN
    UPDATE commercial_budget_versions
    SET status='ACTIVE', activated_at=now()
    WHERE budget_id=v_budget AND version_number=2;
    RAISE EXCEPTION 'second ACTIVE version unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;
END $$;
'@
  }

  Mark 'active pointer belongs to same Budget and tenant' {
    Invoke-PsqlText @'
DO $$
DECLARE
  v_budget_a uuid;
  v_budget_b uuid;
  v_version_a uuid;
  v_version_b uuid;
BEGIN
  SELECT id INTO v_budget_a FROM commercial_budgets WHERE organisation_id='org-a';
  SELECT id INTO v_budget_b FROM commercial_budgets WHERE organisation_id='org-b';
  SELECT id INTO v_version_a FROM commercial_budget_versions WHERE budget_id=v_budget_a AND version_number=1;
  SELECT id INTO v_version_b FROM commercial_budget_versions WHERE budget_id=v_budget_b AND version_number=1;

  UPDATE commercial_budgets SET active_version_id=v_version_a WHERE id=v_budget_a;

  BEGIN
    UPDATE commercial_budgets SET active_version_id=v_version_b WHERE id=v_budget_a;
    RAISE EXCEPTION 'cross-Budget active_version pointer unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  IF (SELECT active_version_id FROM commercial_budgets WHERE id=v_budget_a) <> v_version_a THEN
    RAISE EXCEPTION 'valid active_version pointer was not preserved';
  END IF;
END $$;
'@
  }

  Mark 'cross-tenant period allocation rejected' {
    Invoke-PsqlText @'
DO $$
DECLARE
  v_version_a uuid;
  v_account_a uuid;
  v_cc_a uuid;
  v_line_a uuid;
  v_period_b uuid;
BEGIN
  SELECT id INTO v_version_a FROM commercial_budget_versions WHERE organisation_id='org-a' AND version_number=1;
  SELECT id INTO v_account_a FROM commercial_budget_accounts WHERE organisation_id='org-a';
  SELECT id INTO v_cc_a FROM commercial_cost_centres WHERE organisation_id='org-a';

  INSERT INTO commercial_budget_lines(
    organisation_id,budget_version_id,budget_account_id,cost_centre_id,annual_budget_cents
  ) VALUES ('org-a',v_version_a,v_account_a,v_cc_a,10000)
  RETURNING id INTO v_line_a;

  SELECT id INTO v_period_b FROM commercial_financial_periods WHERE organisation_id='org-b';

  BEGIN
    INSERT INTO commercial_budget_period_allocations(
      organisation_id,budget_line_id,financial_period_id,amount_cents
    ) VALUES ('org-a',v_line_a,v_period_b,10000);
    RAISE EXCEPTION 'cross-tenant period allocation unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END $$;
'@
  }

  Write-Host ''
  Write-Host "=== C7.7B RESULT: PASS=$pass FAIL=$fail ==="
  if ($fail -ne 0) {
    foreach ($failure in $failures) { Write-Host "  - $failure" }
    exit 1
  }
}
finally {
  docker rm -f $container *> $null
}
