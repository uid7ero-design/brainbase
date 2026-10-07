param(
  [ValidateSet('supplierPaymentsMigration', 'supplierPaymentsConcurrency', 'supplierApOverview', 'supplierApHistory', 'supplierApReadiness')]
  [string[]]$Suites = @('supplierPaymentsMigration', 'supplierPaymentsConcurrency', 'supplierApOverview', 'supplierApHistory', 'supplierApReadiness')
)
$ErrorActionPreference = 'Stop'
$taskContainer = "brainbase-ap-readiness-$PID"
$taskPort = 55449
$taskPreviousDatabaseUrl = $env:DATABASE_URL
try {
  docker run --name $taskContainer -e POSTGRES_PASSWORD=test -p "127.0.0.1:${taskPort}:5432" -d postgres:16-alpine | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Disposable PostgreSQL startup failed' }
  $taskReady = $false
  for ($taskAttempt = 0; $taskAttempt -lt 30; $taskAttempt++) {
    docker exec $taskContainer pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { $taskReady = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $taskReady) { throw 'Disposable PostgreSQL did not become ready' }
  foreach ($taskSuite in $Suites) {
    $taskDatabase = $taskSuite.ToLowerInvariant()
    docker exec $taskContainer createdb -U postgres $taskDatabase
    if ($LASTEXITCODE -ne 0) { throw 'Disposable database creation failed' }
    $env:DATABASE_URL = "postgresql://postgres:test@127.0.0.1:$taskPort/$taskDatabase"
    npx vitest run --config vitest.integration.config.ts "scripts/tests/$taskSuite.integration.test.ts"
    if ($LASTEXITCODE -ne 0) { throw "$taskSuite failed" }
  }
} finally {
  $env:DATABASE_URL = $taskPreviousDatabaseUrl
  docker rm -f $taskContainer | Out-Null
}
